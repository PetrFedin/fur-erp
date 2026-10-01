"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { checkOrgRefs } from "@/lib/org-guard";
import { zNum, zMoney, parseDateInput } from "@/lib/input";
import { Decimal } from "@prisma/client/runtime/library";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readDocumentFiles, writeDocumentFiles, type ReadDoc } from "@/lib/purchase-files";
import { loadAuctionSummaries, lockAuction, PAY_EPS, CLOSING_NOTE } from "@/lib/auction-payments";
import { formatMoney } from "@/lib/utils";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER", "ACCOUNTANT"] as const;

const schema = z.object({
  supplierId: z.string().min(1, "Выберите поставщика"),
  amount: zMoney("Сумма"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"], { message: "Выберите способ оплаты" }),
  paidAt: z
    .string()
    .min(1, "Укажите дату оплаты")
    .refine((s) => parseDateInput(s) !== null, "Некорректная дата оплаты"),
  notes: z.string().trim().max(1000, "Заметка слишком длинная (до 1000 символов)").optional(),
});

function parseAdvance(formData: FormData) {
  return schema.safeParse({
    supplierId: formData.get("supplierId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
}

/** Аванс без аукциона и закупки: purchaseId и auctionSession пусты. */
export async function createAdvancePayment(formData: FormData): Promise<PayState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parseAdvance(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const badRef = await checkOrgRefs(session.user.organizationId, { supplier: parsed.data.supplierId });
  if (badRef) return { error: badRef };

  await prisma.payment.create({
    data: {
      organizationId: session.user.organizationId,
      supplierId: parsed.data.supplierId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      status: "COMPLETED",
      kind: "ADVANCE",
      paidAt: new Date(parsed.data.paidAt),
      notes: parsed.data.notes,
    },
  });

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateAdvancePayment(paymentId: string, formData: FormData): Promise<PayState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const parsed = parseAdvance(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const badRef = await checkOrgRefs(orgId, { supplier: parsed.data.supplierId });
  if (badRef) return { error: badRef };
  const res = await prisma.payment.updateMany({
    where: { id: paymentId, organizationId: orgId, purchaseId: null, auctionSession: null },
    data: {
      supplierId: parsed.data.supplierId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      paidAt: new Date(parsed.data.paidAt),
      notes: parsed.data.notes ?? null,
    },
  });
  if (res.count === 0) return { error: "Аванс не найден (возможно, уже удалён)" };
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteAdvancePayment(paymentId: string): Promise<PayState> {
  const session = await requireRole(...EDIT_ROLES);
  const res = await prisma.payment.deleteMany({
    where: { id: paymentId, organizationId: session.user.organizationId, purchaseId: null, auctionSession: null },
  });
  if (res.count === 0) return { error: "Аванс не найден (возможно, уже удалён)" };
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------- Оплаты аукциона (вся партия закупок) ----------

export type PayState = { error?: string; ok?: boolean; confirm?: string };

const KIND_LABELS: Record<string, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательный расчёт", OTHER: "Другое" };

const auctionPaySchema = z.object({
  kind: z.enum(["ADVANCE", "PARTIAL", "FINAL", "OTHER"], { message: "Выберите тип оплаты" }),
  status: z.enum(["COMPLETED", "PENDING"], { message: "Выберите статус: оплачено или запланировано" }),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"], { message: "Выберите способ оплаты" }),
  paidAt: z
    .string()
    .min(1, "Укажите дату оплаты")
    .refine((s) => parseDateInput(s) !== null, "Некорректная дата оплаты"),
  notes: z.string().trim().max(1000, "Заметка слишком длинная (до 1000 символов)").optional(),
});

function revalidateAll() {
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/lots");
  revalidatePath("/purchases/[id]", "page");
}

/**
 * Сумма из формы. Сохранённая сумма — источник истины: при правке режим "keep" (или та же сумма)
 * оставляет сумму и справочный процент как есть. Режим «%» считается от полной стоимости аукциона
 * только когда пользователь явно изменил поле «%»; режим «сумма» — как введена (процент сбрасывается).
 */
function resolveAmount(
  formData: FormData,
  total: Decimal,
  keep?: { amount: Decimal; percent: Decimal | null },
): { error: string } | { amount: Decimal; percent: Decimal | null; unchanged: boolean } {
  const rawMode = formData.get("mode");
  if (rawMode === "keep" && keep) return { amount: keep.amount, percent: keep.percent, unchanged: true };
  const mode = rawMode === "percent" ? "percent" : "amount";
  if (mode === "percent") {
    const p = zNum("Процент", { positive: true, max: 1000 }).safeParse(formData.get("percent"));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Процент: некорректное значение" };
    if (!total.greaterThan(0)) return { error: "У аукциона нет стоимости — введите сумму в рублях" };
    const amount = total.mul(p.data as number).div(100).toDecimalPlaces(2);
    if (amount.lessThan("0.01")) return { error: "Сумма по этому проценту меньше 1 копейки" };
    return { amount, percent: new Decimal(p.data as number).toDecimalPlaces(3), unchanged: Boolean(keep && amount.equals(keep.amount)) };
  }
  const a = zMoney("Сумма").safeParse(formData.get("amount"));
  if (!a.success) return { error: a.error.issues[0]?.message ?? "Сумма: некорректное значение" };
  const amount = new Decimal(a.data as number).toDecimalPlaces(2);
  if (keep && amount.equals(keep.amount)) return { amount: keep.amount, percent: keep.percent, unchanged: true };
  return { amount, percent: null, unchanged: false };
}

function overpayText(after: Decimal, total: Decimal, status: string) {
  const over = after.sub(total);
  return status === "COMPLETED"
    ? `Оплачено станет ${formatMoney(after.toString())} при стоимости аукциона ${formatMoney(total.toString())} — переплата ${formatMoney(over.toString())}. Всё равно записать?`
    : `Оплачено и запланировано станет ${formatMoney(after.toString())} при стоимости аукциона ${formatMoney(total.toString())} — больше на ${formatMoney(over.toString())}. Всё равно записать?`;
}

async function readOptionalProof(formData: FormData): Promise<{ error: string } | { file: ReadDoc | null }> {
  // Браузер без выбранного файла шлёт File с пустым именем и размером 0 — это «файла нет».
  // Файл с именем, но 0 байт — настоящий пустой файл: сообщаем, а не игнорируем молча.
  const entries = formData.getAll("file").filter(
    (e): e is File => typeof e !== "string" && (e.size > 0 || (typeof e.name === "string" && e.name !== "")),
  );
  if (entries.length === 0) return { file: null };
  const empty = entries.find((e) => e.size === 0);
  if (empty) return { error: `Файл «${empty.name}» пустой (0 байт) — выберите другой файл` };
  if (entries.length > 1) return { error: "Прикрепите один файл платёжки" };
  const read = await readDocumentFiles(entries);
  if ("error" in read) return read;
  return { file: read.files[0] };
}

async function dropUnusedDocument(doc: { id: string; storagePath: string } | null) {
  if (!doc) return;
  const left = await prisma.payment.count({ where: { documentId: doc.id } });
  if (left > 0) return;
  await prisma.purchaseDocument.deleteMany({ where: { id: doc.id } });
  const stillUsed = await prisma.purchaseDocument.count({ where: { storagePath: doc.storagePath } });
  if (stillUsed === 0) await removeStoredFiles([doc.storagePath]);
}

export async function createAuctionPayment(auction: string, formData: FormData): Promise<PayState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const parsed = auctionPaySchema.safeParse({
    kind: formData.get("kind"),
    status: formData.get("status"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const supplierWanted = String(formData.get("supplierId") ?? "");
  const confirmed = formData.get("confirmOverpay") === "1";

  const proof = await readOptionalProof(formData);
  if ("error" in proof) return { error: proof.error };
  const stored = proof.file ? await writeDocumentFiles(orgId, "payments", [proof.file]) : [];

  let result: PayState;
  try {
    result = await prisma.$transaction(async (tx): Promise<PayState> => {
      await lockAuction(tx, orgId, auction);
      const [s] = await loadAuctionSummaries(tx, orgId, [auction]);
      if (!s || s.purchases === 0) return { error: "Аукцион не найден или в нём нет действующих закупок" };
      const supplierId = supplierWanted || s.suppliers[0].id;
      if (!s.suppliers.some((x) => x.id === supplierId)) return { error: "Поставщик не относится к этому аукциону" };
      const amt = resolveAmount(formData, s.total);
      if ("error" in amt) return { error: amt.error };
      const after = parsed.data.status === "COMPLETED" ? s.paid.add(amt.amount) : s.paid.add(s.planned).add(amt.amount);
      if (after.sub(s.total).greaterThan(PAY_EPS) && !confirmed) return { confirm: overpayText(after, s.total, parsed.data.status) };

      let documentId: string | null = null;
      if (stored[0]) {
        const doc = await tx.purchaseDocument.create({
          data: {
            organizationId: orgId,
            batch: auction,
            kind: "PAYMENT_PROOF",
            title: `Платёжка: ${KIND_LABELS[parsed.data.kind]} ${parsed.data.paidAt}`,
            ...stored[0],
          },
        });
        documentId = doc.id;
      }
      await tx.payment.create({
        data: {
          organizationId: orgId,
          supplierId,
          auctionSession: auction,
          kind: parsed.data.kind,
          status: parsed.data.status,
          amount: amt.amount,
          percent: amt.percent,
          currency: "RUB",
          method: parsed.data.method,
          paidAt: new Date(parsed.data.paidAt),
          notes: parsed.data.notes,
          documentId,
        },
      });
      return { ok: true };
    });
  } catch (e) {
    await removeStoredFiles(stored.map((x) => x.storagePath));
    throw e;
  }
  if (!result.ok) await removeStoredFiles(stored.map((x) => x.storagePath));
  else revalidateAll();
  return result;
}

export async function updateAuctionPayment(paymentId: string, formData: FormData): Promise<PayState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const existing = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: orgId, purchaseId: null, auctionSession: { not: null } },
    include: { document: { select: { id: true, storagePath: true } } },
  });
  if (!existing || !existing.auctionSession) return { error: "Оплата не найдена" };
  const auction = existing.auctionSession;
  const parsed = auctionPaySchema.safeParse({
    kind: formData.get("kind"),
    status: formData.get("status"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const confirmed = formData.get("confirmOverpay") === "1";
  const removeDoc = formData.get("removeDocument") === "1";

  const proof = await readOptionalProof(formData);
  if ("error" in proof) return { error: proof.error };
  const stored = proof.file ? await writeDocumentFiles(orgId, "payments", [proof.file]) : [];

  let result: PayState;
  try {
    result = await prisma.$transaction(async (tx): Promise<PayState> => {
      await lockAuction(tx, orgId, auction);
      const cur = await tx.payment.findFirst({ where: { id: paymentId, organizationId: orgId } });
      if (!cur) return { error: "Оплата уже удалена" };
      const [s] = await loadAuctionSummaries(tx, orgId, [auction]);
      if (!s) return { error: "Аукцион не найден" };
      // Без самой правимой оплаты.
      const paid = cur.status === "COMPLETED" ? s.paid.sub(cur.amount) : s.paid;
      const planned = cur.status === "PENDING" ? s.planned.sub(cur.amount) : s.planned;
      const amt = resolveAmount(formData, s.total, { amount: cur.amount, percent: cur.percent });
      if ("error" in amt) return { error: amt.error };
      const after = parsed.data.status === "COMPLETED" ? paid.add(amt.amount) : paid.add(planned).add(amt.amount);
      // Правка только заметки/даты (сумма и статус те же) переплату не пересматривает.
      const moneyUnchanged = amt.unchanged && parsed.data.status === cur.status;
      if (!moneyUnchanged && after.sub(s.total).greaterThan(PAY_EPS) && !confirmed) return { confirm: overpayText(after, s.total, parsed.data.status) };

      let documentId = cur.documentId;
      if (stored[0]) {
        const doc = await tx.purchaseDocument.create({
          data: {
            organizationId: orgId,
            batch: auction,
            kind: "PAYMENT_PROOF",
            title: `Платёжка: ${KIND_LABELS[parsed.data.kind]} ${parsed.data.paidAt}`,
            ...stored[0],
          },
        });
        documentId = doc.id;
      } else if (removeDoc) {
        documentId = null;
      }
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          kind: parsed.data.kind,
          status: parsed.data.status,
          amount: amt.amount,
          percent: amt.percent,
          method: parsed.data.method,
          paidAt: new Date(parsed.data.paidAt),
          notes: parsed.data.notes ?? null,
          documentId,
        },
      });
      return { ok: true };
    });
  } catch (e) {
    await removeStoredFiles(stored.map((x) => x.storagePath));
    throw e;
  }
  if (!result.ok) {
    await removeStoredFiles(stored.map((x) => x.storagePath));
    return result;
  }
  // Старую платёжку убираем, только когда она заменена/снята и на неё больше никто не ссылается.
  if (existing.document && (stored[0] || removeDoc)) await dropUnusedDocument(existing.document);
  revalidateAll();
  return result;
}

export async function deleteAuctionPayment(paymentId: string): Promise<PayState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const existing = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: orgId, purchaseId: null, auctionSession: { not: null } },
    include: { document: { select: { id: true, storagePath: true, kind: true } } },
  });
  if (!existing || !existing.auctionSession) return { error: "Оплата не найдена (возможно, уже удалена)" };
  await prisma.$transaction(async (tx) => {
    await lockAuction(tx, orgId, existing.auctionSession as string);
    await tx.payment.deleteMany({ where: { id: paymentId, organizationId: orgId } });
  });
  if (existing.document && existing.document.kind === "PAYMENT_PROOF") await dropUnusedDocument(existing.document);
  revalidateAll();
  return { ok: true };
}

const closeSchema = z.object({
  paidAt: z
    .string()
    .min(1, "Укажите дату")
    .refine((s) => parseDateInput(s) !== null, "Некорректная дата")
    .refine((s) => {
      const y = Number(s.trim().slice(0, 4));
      return y >= 2020 && y <= 2100;
    }, "Дата вне допустимого диапазона (2020–2100)"),
});

/**
 * Явное действие пользователя: закрывает весь текущий остаток аукциона оплатой COMPLETED
 * (kind OTHER, заметка CLOSING_NOTE) — для старых аукционов, оплаченных до начала учёта.
 * Откат — обычное удаление этой оплаты.
 */
export async function closeAuctionRemainder(auction: string, paidAtRaw: string, confirmFuture = false): Promise<PayState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const parsed = closeSchema.safeParse({ paidAt: paidAtRaw });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Некорректная дата" };
  // Дата в будущем для «оплачено до начала учёта» почти наверняка опечатка — нужно явное подтверждение.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dateIso = parsed.data.paidAt.trim().slice(0, 10);
  if (dateIso > todayIso && !confirmFuture) {
    return { confirm: `Дата оплаты (${dateIso}) в будущем. Всё равно закрыть остаток как «Оплачено»?` };
  }
  const result = await prisma.$transaction(async (tx): Promise<PayState> => {
    await lockAuction(tx, orgId, auction);
    const [s] = await loadAuctionSummaries(tx, orgId, [auction]);
    if (!s || s.purchases === 0) return { error: "Аукцион не найден или в нём нет действующих закупок" };
    if (!s.remaining.greaterThan(PAY_EPS)) return { error: "Остатка к оплате нет — закрывать нечего" };
    await tx.payment.create({
      data: {
        organizationId: orgId,
        supplierId: s.suppliers[0].id,
        auctionSession: auction,
        kind: "OTHER",
        status: "COMPLETED",
        amount: s.remaining.toDecimalPlaces(2),
        currency: "RUB",
        method: "OTHER",
        paidAt: new Date(parsed.data.paidAt),
        notes: CLOSING_NOTE,
      },
    });
    return { ok: true };
  });
  if (result.ok) revalidateAll();
  return result;
}
