"use server";

import { randomUUID } from "node:crypto";
import { revalidateAll } from "@/lib/revalidate-all";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { parseDateInput } from "@/lib/input";
import { removeStoredFiles } from "@/lib/fitting-files";
import { isPickedFile, readDocumentFiles, writeDocumentFiles, type ReadDoc } from "@/lib/purchase-files";
import { writeDriveFile } from "@/lib/drive-files";
import { loadAuctionSummaries, lockAuction, PAY_EPS, auctionName } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { batchOrderInclude, batchTotals } from "@/lib/batch-stats";
import { resetVerification } from "@/lib/verification";
import { autoAllocatePayment } from "@/lib/payment-alloc";
import { formatMoney } from "@/lib/utils";
import { PAY_KINDS, SAVED_LATER_NOTE, canConfirm, docRefOf, kindNote, type DocRole, type PayKind } from "@/lib/payment-form-core";

/**
 * ЕДИНАЯ форма оплаты (PaymentForm): поставщику (аукцион / закупка / аванс) и по работе (партия / ТЗ).
 * Один серверный вход savePayment: вид, сумма (рубли / % / остаток), п/п, документы пачкой с типом, «подтверждено», пересчёт.
 * Пересчёты — прежние функции (loadAuctionSummaries, loadSupplierDebt, batchTotals); новых формул нет.
 */

const SUPPLIER_ROLES = ACCESS.supplierPayments as readonly string[];
const WORK_ROLES = PRODUCTION_EDIT_ROLES as readonly string[];

export type Spec = { side: "supplier" | "work"; auction?: string; purchaseId?: string; supplierId?: string; batchId?: string; orderIds?: string[] };

export type TargetList = {
  error?: string;
  canSupplier: boolean;
  canWork: boolean;
  auctions: { name: string; total: number; paid: number; remaining: number; suppliers: { id: string; name: string }[] }[];
  purchases: { id: string; label: string; supplierId: string; supplier: string; total: number; paid: number; remaining: number; auction: string | null }[];
  suppliers: { id: string; name: string }[];
  batches: { id: string; number: number; name: string | null; orders: number }[];
  orders: { id: string; label: string; batch: number | null; client: string | null }[];
};

const n = (d: Decimal) => Number(d.toFixed(2));

export async function getPaymentTargets(): Promise<TargetList> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canSupplier = hasRole(session.user.role, SUPPLIER_ROLES);
  const canWork = hasRole(session.user.role, WORK_ROLES);
  const out: TargetList = { canSupplier, canWork, auctions: [], purchases: [], suppliers: [], batches: [], orders: [] };
  if (canSupplier) {
    const [sums, purchases, suppliers] = await Promise.all([
      loadAuctionSummaries(prisma, orgId),
      prisma.purchase.findMany({
        where: { organizationId: orgId, status: { not: "CANCELLED" } },
        include: { items: true, expenses: true, supplier: { select: { name: true } }, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
        orderBy: { orderDate: "desc" },
      }),
      prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    out.auctions = sums
      .filter((s) => s.purchases > 0)
      .sort((a, b) => (b.lastPurchaseAt?.getTime() ?? 0) - (a.lastPurchaseAt?.getTime() ?? 0))
      .map((s) => ({ name: s.name, total: n(s.total), paid: n(s.paid), remaining: n(s.remaining), suppliers: s.suppliers }));
    out.purchases = purchases
      .filter((p) => !auctionName(p.auctionSession))
      .map((p) => {
        const total = purchaseTotalInclVat(p);
        const paid = p.payments.reduce((x, y) => x.add(y.amount), new Decimal(0));
        return { id: p.id, label: p.number, supplierId: p.supplierId, supplier: p.supplier.name, total: n(total), paid: n(paid), remaining: n(total.sub(paid)), auction: null };
      });
    out.suppliers = suppliers;
  }
  if (canWork) {
    const [batches, orders] = await Promise.all([
      prisma.productionBatch.findMany({ where: { organizationId: orgId }, select: { id: true, number: true, name: true, _count: { select: { orders: true } } }, orderBy: { number: "desc" } }),
      prisma.productionOrder.findMany({
        where: { organizationId: orgId, status: { not: "CANCELLED" } },
        select: { id: true, number: true, workOrderNumber: true, batch: { select: { number: true } }, client: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    out.batches = batches.map((b) => ({ id: b.id, number: b.number, name: b.name, orders: b._count.orders }));
    out.orders = orders.map((o) => ({ id: o.id, label: `ТЗ ${o.workOrderNumber || o.number}`, batch: o.batch?.number ?? null, client: o.client?.name ?? null }));
  }
  return out;
}

export type Quote = {
  error?: string;
  label?: string;
  total?: number;
  paid?: number;
  planned?: number;
  remaining?: number;
  suppliers?: { id: string; name: string }[];
  orderCount?: number;
  noPrice?: boolean;
};

async function loadWorkOrders(db: Prisma.TransactionClient | typeof prisma, orgId: string, spec: Spec) {
  const where: Prisma.ProductionOrderWhereInput = { organizationId: orgId, status: { not: "CANCELLED" } };
  if (spec.batchId) where.batchId = spec.batchId;
  else where.id = { in: spec.orderIds ?? [] };
  return db.productionOrder.findMany({ where, include: batchOrderInclude });
}

/** Сумма / оплачено / остаток для выбранной цели (показывается на шаге 1). */
export async function quotePaymentTarget(spec: Spec): Promise<Quote> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  if (spec.side === "supplier") {
    if (!hasRole(session.user.role, SUPPLIER_ROLES)) return { error: "Недостаточно прав" };
    if (spec.auction) {
      const [s] = await loadAuctionSummaries(prisma, orgId, [spec.auction]);
      if (!s || s.purchases === 0) return { error: "Аукцион не найден или в нём нет действующих закупок" };
      return { label: `Аукцион «${s.name}»`, total: n(s.total), paid: n(s.paid), planned: n(s.planned), remaining: n(s.remaining), suppliers: s.suppliers };
    }
    if (spec.purchaseId) {
      const p = await prisma.purchase.findFirst({
        where: { id: spec.purchaseId, organizationId: orgId },
        include: { items: true, expenses: true, supplier: { select: { id: true, name: true } }, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
      });
      if (!p) return { error: "Закупка не найдена" };
      const au = auctionName(p.auctionSession);
      if (au) {
        const [s] = await loadAuctionSummaries(prisma, orgId, [au]);
        if (s) return { label: `Закупка ${p.number} (аукцион «${au}»)`, total: n(s.total), paid: n(s.paid), planned: n(s.planned), remaining: n(s.remaining), suppliers: [p.supplier] };
      }
      const total = purchaseTotalInclVat(p);
      const paid = p.payments.reduce((x, y) => x.add(y.amount), new Decimal(0));
      return { label: `Закупка ${p.number}`, total: n(total), paid: n(paid), remaining: n(total.sub(paid)), suppliers: [p.supplier] };
    }
    return { label: "Аванс без привязки", suppliers: undefined };
  }
  if (!hasRole(session.user.role, WORK_ROLES)) return { error: "Недостаточно прав" };
  if (!spec.batchId && !(spec.orderIds?.length)) return { error: "Выберите партию или ТЗ" };
  const orders = await loadWorkOrders(prisma, orgId, spec);
  if (orders.length === 0) return { error: "ТЗ не найдены" };
  const t = batchTotals(orders);
  return { label: spec.batchId ? `Партия, ТЗ в ней: ${orders.length}` : `Выбрано ТЗ: ${orders.length}`, total: n(t.work), paid: n(t.paid), remaining: n(t.remaining), orderCount: orders.length, noPrice: !t.work.greaterThan(0) };
}

export type Recalc = {
  title: string;
  /** Остаток по цели до/после (аукцион, закупка, партия/ТЗ). */
  remainingBefore: number | null;
  remainingAfter: number | null;
  paidBefore: number | null;
  paidAfter: number | null;
  total: number | null;
  /** Долг поставщику до/после (только для оплат поставщику). */
  debtBefore: number | null;
  debtAfter: number | null;
  confirmation: string;
  affects: string[];
  tasks: string[];
};

export type SaveResult = { error?: string; confirm?: string; ok?: boolean; paymentId?: string; recalc?: Recalc };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const parseMoney = (s: unknown): number => {
  const t = String(s ?? "").replace(/[\s  ]/g, "").replace(",", ".");
  return t !== "" && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
};

type PickedDoc = { read: ReadDoc; role: DocRole };

export async function savePayment(formData: FormData): Promise<SaveResult> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const userId = session.user.id as string;
  const side = formData.get("side") === "work" ? "work" : "supplier";
  if (!hasRole(session.user.role, side === "supplier" ? SUPPLIER_ROLES : WORK_ROLES)) return { error: "Недостаточно прав для внесения такой оплаты" };

  const kind = String(formData.get("kind") ?? "") as PayKind;
  const kindDef = PAY_KINDS.find((k) => k.v === kind);
  if (!kindDef) return { error: "Выберите вид оплаты" };
  if (side === "work" && kindDef.supplierOnly) return { error: "Возврат / зачёт в оплатах по работе не поддерживается" };
  const paidAtRaw = String(formData.get("paidAt") ?? "").trim();
  const paidAt = parseDateInput(paidAtRaw);
  if (!paidAt) return { error: "Укажите дату оплаты" };
  const yr = paidAt.getUTCFullYear();
  if (yr < 2020 || yr > 2100) return { error: "Дата вне допустимого диапазона (2020–2100)" };
  const paidIso = paidAt.toISOString().slice(0, 10);
  const mode = ["percent", "rest"].includes(String(formData.get("mode"))) ? String(formData.get("mode")) : "amount";
  const ppNo = String(formData.get("ppNo") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40);
  const noteIn = String(formData.get("note") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 600);
  const methodRaw = String(formData.get("method") ?? "BANK_TRANSFER");
  const method = (["CASH", "BANK_TRANSFER", "CARD", "OTHER"].includes(methodRaw) ? methodRaw : "BANK_TRANSFER") as "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER";
  const allocateLater = formData.get("allocateLater") === "1";
  const markConfirmed = formData.get("markConfirmed") === "1";
  const warnOk = formData.get("confirmOverpay") === "1";
  if ((kind === "OTHER" || kind === "REFUND") && noteIn.length < 3) return { error: "Для вида «Другое» и «Возврат / зачёт» напишите пометку — что это за платёж" };
  // Предупреждения (дата в будущем, переплата, повтор) собираются вместе и подтверждаются ОДНИМ вопросом: иначе «ОК» на одно из них пропускало бы остальные.
  const warns: string[] = [];
  if (paidIso > todayIso()) warns.push(`Дата оплаты (${paidIso}) в будущем.`);

  // ---- файлы пачкой: тип (платёжка / счёт / письмо / другое) выбран на форме, по умолчанию определён по имени
  const entries = formData.getAll("files").filter(isPickedFile);
  const roles = formData.getAll("fileRoles").map(String);
  const docs: PickedDoc[] = [];
  if (entries.length > 0) {
    if (entries.length > 10) return { error: "За один раз можно приложить не больше 10 файлов" };
    for (let i = 0; i < entries.length; i++) {
      const r = await readDocumentFiles([entries[i]]);
      if ("error" in r) return { error: r.error };
      const role = (["PAYMENT_PROOF", "PAYMENT_INVOICE", "APPROVAL_EMAIL", "OTHER"].includes(roles[i]) ? roles[i] : "OTHER") as DocRole;
      docs.push({ read: r.files[0], role });
    }
  }
  const hasProofFile = docs.some((d) => d.read && d.role === "PAYMENT_PROOF");

  // ---- сумма
  const amountIn = parseMoney(formData.get("amount"));
  const percentIn = parseMoney(formData.get("percent"));
  if (mode === "amount" && (!Number.isFinite(amountIn) || amountIn === 0 || (kind !== "REFUND" && amountIn < 0.01))) return { error: "Сумма: укажите положительное число" };
  if (mode === "percent" && !(percentIn > 0 && percentIn <= 100)) return { error: "Процент: от 0 до 100" };
  if (markConfirmed && !canConfirm({ hasProofFile, ppNo, paidAt: paidIso, amount: mode === "amount" ? amountIn : 1 })) {
    return { error: "«Подтверждено» можно отметить, только если указан № п/п (с датой и суммой). Письмо-согласование оплатой не считается." };
  }

  const spec: Spec = {
    side,
    auction: String(formData.get("auction") ?? "") || undefined,
    purchaseId: String(formData.get("purchaseId") ?? "") || undefined,
    supplierId: String(formData.get("supplierId") ?? "") || undefined,
    batchId: String(formData.get("batchId") ?? "") || undefined,
    orderIds: formData.getAll("orderIds").map(String).filter(Boolean),
  };
  const lockKey = side === "supplier" ? (spec.auction ?? (spec.purchaseId ? "purchase:" + spec.purchaseId : "advance:" + (spec.supplierId ?? ""))) : spec.batchId ? "prod-batch:" + spec.batchId : "prod-order:" + [...(spec.orderIds ?? [])].sort().join(",");

  const debtBefore = side === "supplier" ? (await loadSupplierDebt(prisma, orgId)).debt : null;
  const storedPurchaseDocs: string[] = [];
  const storedDriveFiles: string[] = [];
  let result: SaveResult;
  try {
    result = await prisma.$transaction(
      async (tx): Promise<SaveResult> => {
        await lockAuction(tx, orgId, lockKey);
        let amount: Decimal;
        let percent: Decimal | null = null;
        let touched: { auctions?: string[]; purchaseIds?: string[]; orderIds?: string[]; batchIds?: string[] } = {};
        let paymentId: string;
        let remBefore: Decimal | null = null;
        let paidBefore: Decimal | null = null;
        let total: Decimal | null = null;
        let title = "";
        const dupSince = new Date(Date.now() - 2 * 60 * 1000);
        const warn = [...warns];

        // 1. цель, сумма, проверки
        let supplierId = "";
        let purchaseForLink: string | null = null;
        let auctionForLink: string | null = null;
        let orders: Awaited<ReturnType<typeof loadWorkOrders>> = [];
        if (side === "supplier") {
          const au = spec.auction ? auctionName(spec.auction) : null;
          if (au) {
            const [s] = await loadAuctionSummaries(tx, orgId, [au]);
            if (!s || s.purchases === 0) return { error: "Аукцион не найден или в нём нет действующих закупок" };
            supplierId = spec.supplierId && s.suppliers.some((x) => x.id === spec.supplierId) ? spec.supplierId : s.suppliers[0].id;
            auctionForLink = au;
            total = s.total;
            paidBefore = s.paid;
            title = `Аукцион «${au}»`;
            touched = { auctions: [au] };
          } else if (spec.purchaseId) {
            const p = await tx.purchase.findFirst({
              where: { id: spec.purchaseId, organizationId: orgId },
              include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
            });
            if (!p) return { error: "Закупка не найдена" };
            if (p.status === "CANCELLED") return { error: "Закупка отменена — оплату вносить нельзя" };
            supplierId = p.supplierId;
            purchaseForLink = p.id;
            const pa = auctionName(p.auctionSession);
            if (pa) {
              await lockAuction(tx, orgId, pa);
              const [s] = await loadAuctionSummaries(tx, orgId, [pa]);
              total = s?.total ?? purchaseTotalInclVat(p);
              paidBefore = s?.paid ?? new Decimal(0);
              title = `Закупка ${p.number} · аукцион «${pa}»`;
              touched = { auctions: [pa], purchaseIds: [p.id] };
            } else {
              total = purchaseTotalInclVat(p);
              paidBefore = p.payments.reduce((x, y) => x.add(y.amount), new Decimal(0));
              title = `Закупка ${p.number}`;
              touched = { purchaseIds: [p.id] };
            }
          } else {
            if (!spec.supplierId) return { error: "Выберите аукцион, закупку или поставщика (аванс без привязки)" };
            if (!(await tx.supplier.findFirst({ where: { id: spec.supplierId, organizationId: orgId }, select: { id: true } }))) return { error: "Поставщик не найден" };
            if (kind !== "ADVANCE") return { error: "Без аукциона и закупки можно внести только аванс (с пометкой «разнести позже»). Выберите, за что платим." };
            supplierId = spec.supplierId;
            title = "Аванс поставщику без привязки";
          }
          remBefore = total && paidBefore ? total.sub(paidBefore) : null;
          if (mode === "rest") {
            if (!remBefore || !remBefore.greaterThan(PAY_EPS)) return { error: "Остатка к оплате нет" };
            amount = remBefore.toDecimalPlaces(2);
          } else if (mode === "percent") {
            if (!total || !total.greaterThan(0)) return { error: "Нет суммы, от которой считать процент — введите сумму" };
            amount = total.mul(percentIn).div(100).toDecimalPlaces(2);
            percent = new Decimal(percentIn).toDecimalPlaces(3);
          } else amount = new Decimal(amountIn).toDecimalPlaces(2);
          if (kind === "REFUND") amount = amount.abs().neg();
          if (amount.abs().lessThan("0.01")) return { error: "Сумма меньше 1 копейки" };
          if (kind !== "REFUND" && total && paidBefore && paidBefore.add(amount).sub(total).greaterThan(PAY_EPS)) {
            warn.push(`Оплачено станет ${formatMoney(paidBefore.add(amount).toString())} при стоимости ${formatMoney(total.toString())} — переплата ${formatMoney(paidBefore.add(amount).sub(total).toString())}.`);
          }
        } else {
          orders = await loadWorkOrders(tx, orgId, spec);
          if (orders.length === 0) return { error: "Выберите партию или ТЗ (действующие, не отменённые)" };
          if (!spec.batchId && (spec.orderIds ?? []).length !== orders.length) return { error: "Одно из выбранных ТЗ не найдено или отменено — обновите страницу" };
          const t = batchTotals(orders);
          total = t.work;
          paidBefore = t.paid;
          remBefore = t.remaining;
          title = spec.batchId ? `Партия ${(await tx.productionBatch.findFirst({ where: { id: spec.batchId }, select: { number: true } }))?.number ?? ""}` : `ТЗ: ${orders.map((o) => o.workOrderNumber || o.number).join(", ")}`;
          touched = { orderIds: orders.map((o) => o.id), batchIds: [...new Set(orders.map((o) => o.batchId).filter((x): x is string => !!x))] };
          if (mode === "rest") {
            if (!remBefore.greaterThan(PAY_EPS)) return { error: "Остатка к оплате нет" };
            amount = remBefore.toDecimalPlaces(2);
          } else if (mode === "percent") {
            if (!total.greaterThan(0)) return { error: "Цена работы не задана — процент считать не от чего. Введите сумму." };
            amount = total.mul(percentIn).div(100).toDecimalPlaces(2);
            percent = new Decimal(percentIn).toDecimalPlaces(3);
          } else amount = new Decimal(amountIn).toDecimalPlaces(2);
          if (amount.lessThan("0.01")) return { error: "Сумма меньше 1 копейки" };
          if (kind !== "ADVANCE" && !total.greaterThan(0)) return { error: "Цена работы не задана — оплату по ТЗ можно внести только как аванс" };
          if (total.greaterThan(0) && paidBefore.add(amount).sub(total).greaterThan(PAY_EPS)) {
            warn.push(`Оплачено станет ${formatMoney(paidBefore.add(amount).toString())} при работе ${formatMoney(total.toString())} — переплата ${formatMoney(paidBefore.add(amount).sub(total).toString())}.`);
          }
        }

        // 2. защита от двойной отправки: такая же оплата за последние 2 минуты
        const dup =
          side === "supplier"
            ? await tx.payment.count({ where: { organizationId: orgId, supplierId, amount, paidAt, purchaseId: purchaseForLink, auctionSession: auctionForLink, createdAt: { gte: dupSince } } })
            : await tx.productionPayment.count({ where: { organizationId: orgId, amount, paidAt, createdAt: { gte: dupSince }, orders: { some: { productionOrderId: { in: orders.map((o) => o.id) } } } } });
        if (dup > 0) warn.push("Такая же оплата (сумма, дата, цель) только что уже записана — возможно, это двойная отправка.");
        if (warn.length > 0 && !warnOk) return { confirm: `${warn.join(" ")} Всё равно записать?` };

        // 3. документы
        const stored: { role: DocRole; doc: ReadDoc }[] = docs.map((d) => ({ role: d.role, doc: d.read }));
        const proofs = stored.filter((s) => s.role === "PAYMENT_PROOF");
        const rest = stored.filter((s) => s !== proofs[0]);
        let documentId: string | null = null;
        const kindLabel = PAY_KINDS.find((k) => k.v === kind)!.label;
        const docRef = docRefOf(ppNo, paidIso);
        const noteParts = [kindNote(kind), noteIn, allocateLater && !spec.auction && !spec.purchaseId && side === "supplier" ? SAVED_LATER_NOTE : "", mode === "percent" ? `${percentIn}% от суммы` : ""].filter(Boolean);
        const notes = noteParts.join(" · ").slice(0, 1000) || null;
        const confirmedFlag = markConfirmed || proofs.length > 0;

        if (side === "supplier") {
          if (proofs[0]) {
            const w = await writeDocumentFiles(orgId, "payments", [proofs[0].doc]);
            storedPurchaseDocs.push(w[0].storagePath);
            const pd = await tx.purchaseDocument.create({ data: { organizationId: orgId, purchaseId: purchaseForLink, batch: auctionForLink, kind: "PAYMENT_PROOF", title: `Платёжка: ${kindLabel} ${paidIso}`, ...w[0] } });
            documentId = pd.id;
          }
          const pay = await tx.payment.create({
            data: {
              organizationId: orgId,
              supplierId,
              purchaseId: purchaseForLink,
              auctionSession: auctionForLink,
              amount,
              percent,
              currency: "RUB",
              method,
              status: "COMPLETED",
              paidAt,
              kind: kindDef.db,
              notes,
              documentId,
              docRef,
              confirmed: confirmedFlag,
              ...(markConfirmed ? { confirmedAt: new Date(), confirmedBy: userId } : {}),
            },
          });
          paymentId = pay.id;
          for (const s of rest) {
            const f = await writeDriveFile(orgId, s.doc);
            storedDriveFiles.push(f.storagePath);
            await tx.driveDocument.create({
              data: { organizationId: orgId, driveFileId: `local-${randomUUID()}`, title: `${s.role === "PAYMENT_INVOICE" ? "Счёт" : s.role === "APPROVAL_EMAIL" ? "Письмо-согласование" : s.role === "PAYMENT_PROOF" ? "Платёжка" : "Документ"}: ${s.doc.originalName}`.slice(0, 200), docType: s.role, mimeType: f.storedMime, sizeBytes: f.storedSize, ...f, storedAt: new Date(), paymentId: pay.id, purchaseId: purchaseForLink },
            });
          }
        } else {
          const pay = await tx.productionPayment.create({
            data: {
              organizationId: orgId,
              clientId: orders.find((o) => o.clientId)?.clientId ?? null,
              amount,
              paymentType: kindDef.db === "OTHER" ? "PARTIAL" : kindDef.db,
              method,
              status: "COMPLETED",
              paidAt,
              notes,
              docRef,
              confirmed: confirmedFlag,
              ...(markConfirmed ? { confirmedAt: new Date(), confirmedBy: userId } : {}),
              orders: { create: orders.map((o) => ({ productionOrderId: o.id })) },
            },
          });
          paymentId = pay.id;
          // Разнесение по ТЗ набора: пропорционально работе, в пределах остатка работы каждого ТЗ.
          await autoAllocatePayment(tx, orgId, pay.id);
          for (const s of stored) {
            const f = await writeDriveFile(orgId, s.doc);
            storedDriveFiles.push(f.storagePath);
            await tx.driveDocument.create({
              data: { organizationId: orgId, driveFileId: `local-${randomUUID()}`, title: `${s.role === "PAYMENT_PROOF" ? "Платёжка" : s.role === "PAYMENT_INVOICE" ? "Счёт" : s.role === "APPROVAL_EMAIL" ? "Письмо-согласование" : "Документ"}: ${s.doc.originalName}`.slice(0, 200), docType: s.role, mimeType: f.storedMime, sizeBytes: f.storedSize, ...f, storedAt: new Date(), productionPaymentId: pay.id },
            });
          }
        }

        // 4. сброс подтверждения связанных строк и пересчёт
        await resetVerification(tx, orgId, touched);
        let remAfter: Decimal | null = null;
        let paidAfter: Decimal | null = null;
        if (side === "supplier") {
          if (auctionForLink) {
            const [s] = await loadAuctionSummaries(tx, orgId, [auctionForLink]);
            paidAfter = s?.paid ?? null;
            remAfter = s?.remaining ?? null;
          } else if (purchaseForLink) {
            const p = await tx.purchase.findFirstOrThrow({ where: { id: purchaseForLink }, include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } } });
            const pa = auctionName(p.auctionSession);
            if (pa) {
              const [s] = await loadAuctionSummaries(tx, orgId, [pa]);
              paidAfter = s?.paid ?? null;
              remAfter = s?.remaining ?? null;
            } else {
              paidAfter = p.payments.reduce((x, y) => x.add(y.amount), new Decimal(0));
              remAfter = purchaseTotalInclVat(p).sub(paidAfter);
            }
          }
        } else {
          const t = batchTotals(await loadWorkOrders(tx, orgId, spec));
          paidAfter = t.paid;
          remAfter = t.remaining;
        }

        const affects =
          side === "supplier"
            ? ["Долг поставщику (Главная, Оплаты)", auctionForLink ? `Остаток аукциона «${auctionForLink}»` : purchaseForLink ? "Остаток к оплате по закупке" : "Аванс без привязки уменьшает общий долг", "Подтверждение оплат (Контроль → Подтвердить)"]
            : ["Остаток к оплате по партии / ТЗ", "Долг заказчика на Главной", "Подтверждение ТЗ и партии сброшено — подтвердите заново"];
        const tasks: string[] = [];
        if (!hasProofFile && !markConfirmed) tasks.push("Укажите № п/п (с датой и суммой) — оплата пока не подтверждена");
        if (docs.some((d) => d.role === "APPROVAL_EMAIL") && !hasProofFile && !ppNo) tasks.push("Есть только письмо-согласование: это «согласовано», а не «оплачено» — нужен № п/п");
        if (allocateLater && !spec.auction && !spec.purchaseId && side === "supplier") tasks.push("Разнести аванс по аукциону / закупке (раздел «Оплаты» → «Привязать»)");
        return {
          ok: true,
          paymentId,
          recalc: {
            title,
            remainingBefore: remBefore ? n(remBefore) : null,
            remainingAfter: remAfter ? n(remAfter) : null,
            paidBefore: paidBefore ? n(paidBefore) : null,
            paidAfter: paidAfter ? n(paidAfter) : null,
            total: total ? n(total) : null,
            debtBefore: null,
            debtAfter: null,
            confirmation: markConfirmed ? "Подтверждено вами" : proofs.length ? "Платёжка приложена, ждёт подтверждения" : "Не подтверждено: нет № п/п",
            affects,
            tasks,
          },
        };
      },
      { timeout: 60000, maxWait: 15000 },
    );
  } catch (e) {
    await removeStoredFiles([...storedPurchaseDocs, ...storedDriveFiles]);
    return { error: e instanceof Error ? e.message : "Не удалось сохранить оплату" };
  }
  if (!result.ok) {
    await removeStoredFiles([...storedPurchaseDocs, ...storedDriveFiles]);
    return result;
  }
  if (side === "supplier" && result.recalc) {
    const after = (await loadSupplierDebt(prisma, orgId)).debt;
    result.recalc.debtBefore = debtBefore ? n(debtBefore) : null;
    result.recalc.debtAfter = n(after);
  }
  revalidateAll(orgId);
  return result;
}

