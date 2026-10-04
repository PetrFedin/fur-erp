"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { parseDateInput, zMoney, zNum } from "@/lib/input";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readDocumentFiles, writeDocumentFiles, type ReadDoc } from "@/lib/purchase-files";
import { loadAuctionSummaries, lockAuction, PAY_EPS } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { MANUAL_PREFIX } from "@/lib/doc-panel";
import { formatMoney } from "@/lib/utils";
import { resetVerification } from "@/lib/verification";

/**
 * «Отметить оплату» из панели «Документы и оплата» (аукцион, закупка).
 * Создаёт обычную оплату (Payment) со статусом COMPLETED; без файла платёжки — confirmed = false и docRef «отмечено вручную …»
 * (в «Покрытии документами» и на /attention она остаётся пробелом «платёжки нет», пока файл не приложат).
 * Откат — удаление оплаты (кнопка «Откатить» в панели, либо раздел «Оплаты»).
 */

const ROLES = ACCESS.supplierPayments;

export type MarkState = { error?: string; ok?: boolean; confirm?: string };

const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

type Parsed = { mode: "full" | "amount" | "percent"; amountIn: number | null; percentIn: number | null; paidAt: Date; paidIso: string; basis: string; confirmFuture: boolean };

function parseMark(formData: FormData): { error: string } | Parsed {
  const rawMode = String(formData.get("mode") ?? "full");
  const mode = rawMode === "amount" ? "amount" : rawMode === "percent" ? "percent" : "full";
  const paidRaw = String(formData.get("paidAt") ?? "").trim();
  if (!paidRaw) return { error: "Укажите дату оплаты" };
  const paidAt = parseDateInput(paidRaw);
  if (!paidAt) return { error: "Некорректная дата оплаты" };
  const year = paidAt.getUTCFullYear();
  if (year < 2020 || year > 2100) return { error: "Дата вне допустимого диапазона (2020–2100)" };
  let amountIn: number | null = null;
  let percentIn: number | null = null;
  if (mode === "amount") {
    const a = zMoney("Сумма").safeParse(formData.get("amount"));
    if (!a.success) return { error: a.error.issues[0]?.message ?? "Сумма: некорректное значение" };
    amountIn = a.data as number;
  } else if (mode === "percent") {
    const p = zNum("Процент", { positive: true, max: 100 }).safeParse(formData.get("percent"));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Процент: некорректное значение" };
    percentIn = p.data as number;
  }
  const basis = String(formData.get("basis") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
  return { mode, amountIn, percentIn, paidAt, paidIso: paidAt.toISOString().slice(0, 10), basis, confirmFuture: formData.get("confirmFuture") === "1" };
}

/** Файл-основание (необязательный), как у платёжки аукциона. */
async function readProof(formData: FormData): Promise<{ error: string } | { file: ReadDoc | null }> {
  const entries = formData.getAll("file").filter((e): e is File => typeof e !== "string" && (e.size > 0 || e.name !== ""));
  if (entries.length === 0) return { file: null };
  if (entries.length > 1) return { error: "Прикрепите один файл платёжки" };
  const read = await readDocumentFiles(entries);
  if ("error" in read) return read;
  return { file: read.files[0] };
}

function resolveAmount(p: Parsed, total: Decimal, remaining: Decimal): { error: string } | { amount: Decimal; percent: Decimal | null } {
  if (!remaining.greaterThan(PAY_EPS)) return { error: "Остатка к оплате нет — отмечать нечего" };
  let amount: Decimal;
  let percent: Decimal | null = null;
  if (p.mode === "full") amount = remaining.toDecimalPlaces(2);
  else if (p.mode === "percent") {
    if (!total.greaterThan(0)) return { error: "Нет суммы, от которой считать процент — введите сумму в рублях" };
    amount = total.mul(p.percentIn as number).div(100).toDecimalPlaces(2);
    percent = new Decimal(p.percentIn as number).toDecimalPlaces(3);
  } else amount = new Decimal(p.amountIn as number).toDecimalPlaces(2);
  if (amount.lessThan("0.01")) return { error: "Сумма меньше 1 копейки" };
  if (amount.sub(remaining).greaterThan(PAY_EPS)) {
    return { error: `Сумма ${formatMoney(amount.toString())} больше остатка ${formatMoney(remaining.toString())}. Для переплаты используйте раздел «Оплаты».` };
  }
  return { amount, percent };
}

function revalidateAll(purchaseId?: string | null) {
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/lots");
  revalidatePath("/documents");
  revalidatePath("/reconciliation");
  revalidatePath("/attention");
  revalidatePath("/purchases/[id]", "page");
  if (purchaseId) revalidatePath(`/purchases/${purchaseId}`);
}

type Target = { kind: "auction"; name: string } | { kind: "purchase"; id: string };

async function mark(target: Target, formData: FormData): Promise<MarkState> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const parsed = parseMark(formData);
  if ("error" in parsed) return { error: parsed.error };
  const file = await readProof(formData);
  if ("error" in file) return { error: file.error };
  if (!file.file && !parsed.basis) return { error: "Укажите основание: № платёжки или название письма/документа — либо приложите файл платёжки" };
  if (parsed.paidIso > todayIso() && !parsed.confirmFuture) return { confirm: `Дата оплаты (${parsed.paidIso}) в будущем. Всё равно отметить?` };

  const stored = file.file ? await writeDocumentFiles(orgId, "payments", [file.file]) : [];
  let result: MarkState;
  try {
    result = await prisma.$transaction(async (tx): Promise<MarkState> => {
      let supplierId: string;
      let purchaseId: string | null = null;
      let auction: string | null = null;
      let total: Decimal;
      let paid: Decimal;
      if (target.kind === "auction") {
        auction = target.name;
        await lockAuction(tx, orgId, auction);
        const [s] = await loadAuctionSummaries(tx, orgId, [auction]);
        if (!s || s.purchases === 0) return { error: "Аукцион не найден или в нём нет действующих закупок" };
        supplierId = s.suppliers[0].id;
        total = s.total;
        paid = s.paid;
      } else {
        await lockAuction(tx, orgId, "purchase:" + target.id);
        const p = await tx.purchase.findFirst({
          where: { id: target.id, organizationId: orgId },
          include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
        });
        if (!p) return { error: "Закупка не найдена" };
        if (p.status === "CANCELLED") return { error: "Закупка отменена — оплату отмечать нельзя" };
        supplierId = p.supplierId;
        purchaseId = p.id;
        total = purchaseTotalInclVat(p);
        paid = p.payments.reduce((s, x) => s.add(x.amount), new Decimal(0));
      }
      const amt = resolveAmount(parsed, total, total.sub(paid));
      if ("error" in amt) return { error: amt.error };

      let documentId: string | null = null;
      if (stored[0]) {
        const doc = await tx.purchaseDocument.create({
          data: {
            organizationId: orgId,
            purchaseId,
            batch: auction,
            kind: "PAYMENT_PROOF",
            title: `Платёжка: оплата ${parsed.paidIso}`,
            ...stored[0],
          },
        });
        documentId = doc.id;
      }
      const how = parsed.mode === "full" ? "оплачено полностью" : parsed.mode === "percent" ? `оплачено ${parsed.percentIn}%` : "оплачено частично";
      await tx.payment.create({
        data: {
          organizationId: orgId,
          supplierId,
          purchaseId,
          auctionSession: auction,
          kind: parsed.mode === "full" ? "FINAL" : "PARTIAL",
          status: "COMPLETED",
          amount: amt.amount,
          percent: amt.percent,
          currency: "RUB",
          method: "BANK_TRANSFER",
          paidAt: parsed.paidAt,
          notes: `Отмечено вручную (${how}) ${todayIso()}${parsed.basis ? `: ${parsed.basis}` : ""}`.slice(0, 1000),
          documentId,
          docRef: `${MANUAL_PREFIX}${parsed.basis ? `: ${parsed.basis}` : ""}`.slice(0, 300),
          confirmed: Boolean(documentId),
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
  await resetVerification(prisma, orgId, target.kind === "auction" ? { auctions: [target.name] } : { purchaseIds: [target.id] });
  revalidateAll(target.kind === "purchase" ? target.id : null);
  return result;
}

/** Отметить оплату аукциона целиком: «оплачено полностью» (сумма = остаток) или частично (сумма / %). */
export async function markAuctionPayment(auction: string, formData: FormData): Promise<MarkState> {
  return mark({ kind: "auction", name: auction }, formData);
}

/** То же для закупки вне аукциона. */
export async function markPurchasePayment(purchaseId: string, formData: FormData): Promise<MarkState> {
  return mark({ kind: "purchase", id: purchaseId }, formData);
}

/** Приложить платёжку к существующей оплате: файл сохраняется, оплата становится «подтверждена». */
export async function attachSupplierPaymentProof(paymentId: string, formData: FormData): Promise<MarkState> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const pay = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    select: { id: true, purchaseId: true, auctionSession: true, paidAt: true, documentId: true, status: true },
  });
  if (!pay) return { error: "Оплата не найдена" };
  if (pay.status === "CANCELLED") return { error: "Оплата отменена" };
  const file = await readProof(formData);
  if ("error" in file) return { error: file.error };
  if (!file.file) return { error: "Выберите файл платёжки" };
  const stored = await writeDocumentFiles(orgId, "payments", [file.file]);
  try {
    await prisma.$transaction(async (tx) => {
      const doc = await tx.purchaseDocument.create({
        data: {
          organizationId: orgId,
          purchaseId: pay.purchaseId,
          batch: pay.purchaseId ? null : pay.auctionSession?.split(/\r?\n/)[0].trim() || null,
          kind: "PAYMENT_PROOF",
          title: `Платёжка: оплата ${pay.paidAt.toISOString().slice(0, 10)}`,
          ...stored[0],
        },
      });
      await tx.payment.update({ where: { id: pay.id }, data: { documentId: doc.id, confirmed: true } });
    });
  } catch (e) {
    await removeStoredFiles(stored.map((x) => x.storagePath));
    throw e;
  }
  await resetVerification(prisma, orgId, { paymentIds: [pay.id], purchaseIds: [pay.purchaseId], auctions: [pay.auctionSession] });
  revalidateAll(pay.purchaseId);
  return { ok: true };
}
