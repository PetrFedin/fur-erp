import "server-only";
import { storedFileExists } from "@/lib/stored-file-check";
import { Decimal } from "@prisma/client/runtime/library";
import { auctionName } from "@/lib/auction-payments";
import { MANUAL_PREFIX } from "@/lib/doc-panel";
import { formatDate } from "@/lib/utils";
import { payNoteOf } from "@/lib/verify-remark";
import { APPROX_RE, fmtRub, isCountedPayment, iso, PROOF_DOC_TYPES, ppNoOf, refEvidence, registryFactFor, stampOf } from "./evidence";
import type { Blocker, ModelCtx } from "./types";

// Шаги loadVerifyModel: строки оплат поставщику и оплат производства (вынесено из verification.ts без изменений).

// ----------------------------------------------------------------------------------- платежи поставщику
export async function addPaymentRows({ db, orgId, only, reg0, userId, names, rows, extra }: ModelCtx): Promise<void> {
  const pays = await db.payment.findMany({
    where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(only ? { id: only.id } : {}) },
    select: {
      id: true, amount: true, paidAt: true, status: true, kind: true, docRef: true, confirmed: true, confirmedAt: true, confirmedBy: true,
      documentId: true, purchaseId: true, auctionSession: true, notes: true,
      purchase: { select: { number: true } },
      supplier: { select: { name: true } },
      driveDocuments: { select: { docType: true, storagePath: true } },
    },
    orderBy: { paidAt: "asc" },
  });
  const sumByPp = new Map<string, number>();
  for (const p of pays) {
    const pp = ppNoOf(p.docRef);
    if (pp && p.status === "COMPLETED") sumByPp.set(pp, (sumByPp.get(pp) ?? 0) + Number(p.amount));
  }
  for (const p of pays) {
    const blockers: Blocker[] = [];
    const href = p.purchaseId ? `/purchases/${p.purchaseId}` : "/payments";
    const hasFile = !!p.documentId || p.driveDocuments.some((d) => (PROOF_DOC_TYPES as readonly string[]).includes(d.docType) && storedFileExists(d.storagePath));
    const ev = refEvidence(p.docRef);
    const ppNo = ppNoOf(p.docRef);
    const amount = Number(p.amount);
    if (p.status !== "COMPLETED") blockers.push({ text: "оплата только запланирована — деньги ещё не ушли", href });
    if (!(amount > 0)) blockers.push({ text: "сумма не задана", href });
    if (!hasFile && !ev)
      blockers.push({
        text: p.docRef?.toLowerCase().startsWith(MANUAL_PREFIX) ? "оплата отмечена вручную, платёжки и п/п нет" : "нет основания: файла платёжки, п/п с номером или письма «оплачено» с датой",
        href,
        upload: { action: "paymentProof", target: "supplier", paymentId: p.id, label: "Приложить платёжку" },
      });
    if (APPROX_RE.test(`${p.docRef ?? ""} ${p.notes ?? ""}`)) blockers.push({ text: "дата оплаты взята по письму или расчёту, а не из платёжки — уточнить по выписке", href });
    if (!p.purchaseId && !p.auctionSession) blockers.push({ text: "оплата не привязана к закупке или аукциону", href: "/payments" });
    const paidIso = iso(p.paidAt);
    const reg = registryFactFor({ amount, paidIso, ppNo }, sumByPp, reg0);
    const st = stampOf(p.confirmedAt, p.confirmedBy, userId, names);
    const verified = p.confirmed && !!p.confirmedAt;
    const target = p.purchase?.number ? `закупка ${p.purchase.number}` : p.auctionSession ? `аукцион ${auctionName(p.auctionSession)}` : "без привязки";
    rows.push({
      key: `payment:${p.id}`, kind: "payment", id: p.id,
      title: `${formatDate(p.paidAt)} · ${fmtRub(p.amount)}`, sub: `${p.supplier.name} · ${target}${p.docRef ? ` · ${p.docRef.slice(0, 80)}` : ""}`,
      href, group: auctionName(p.auctionSession) ?? p.purchase?.number ?? null, year: p.paidAt.getUTCFullYear(), amountText: fmtRub(p.amount),
      verified, auto: verified && st.auto, stampText: verified ? st.text : null, note: payNoteOf(p.notes), letter: !hasFile && ev === "letter",
      ready: blockers.length === 0, blockers,
      edit: { date: paidIso, amount: new Decimal(p.amount).toFixed(2), ref: p.docRef ?? "" },
      registryFact: reg, members: [], zero: !isCountedPayment(amount),
    });
    extra.paymentPp.set(`payment:${p.id}`, { ppNo, amount, paidIso });
  }
}

// ------------------------------------------------------------------------------------ оплаты производства
export async function addProdPaymentRows({ db, orgId, only, reg0, userId, names, rows, extra }: ModelCtx): Promise<void> {
  const pays = await db.productionPayment.findMany({
    where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(only ? { id: only.id } : {}) },
    select: {
      id: true, amount: true, paidAt: true, status: true, paymentType: true, docRef: true, confirmed: true, confirmedAt: true, confirmedBy: true, notes: true,
      client: { select: { name: true } },
      driveDocuments: { select: { docType: true, storagePath: true } },
      orders: { select: { productionOrder: { select: { id: true, batch: { select: { number: true } } } } } },
    },
    orderBy: { paidAt: "asc" },
  });
  const sumByPp = new Map<string, number>();
  for (const p of pays) {
    const pp = ppNoOf(p.docRef);
    if (pp && p.status === "COMPLETED") sumByPp.set(pp, (sumByPp.get(pp) ?? 0) + Number(p.amount));
  }
  for (const p of pays) {
    const blockers: Blocker[] = [];
    const batches = [...new Set(p.orders.map((o) => o.productionOrder.batch?.number).filter((x): x is number => x != null))].sort((a, b) => a - b);
    const href = batches.length === 1 ? `/production/batches/${batches[0]}` : "/payments";
    const hasFile = p.driveDocuments.some((d) => (PROOF_DOC_TYPES as readonly string[]).includes(d.docType) && storedFileExists(d.storagePath));
    const ev = refEvidence(p.docRef);
    const ppNo = ppNoOf(p.docRef);
    const amount = Number(p.amount);
    if (p.status !== "COMPLETED") blockers.push({ text: "оплата только запланирована — деньги ещё не пришли", href });
    if (!(amount > 0)) blockers.push({ text: "сумма не задана", href });
    if (!hasFile && !ev)
      blockers.push({
        text: p.docRef?.toLowerCase().startsWith(MANUAL_PREFIX) ? "оплата отмечена вручную, платёжки и п/п нет" : `в основании только ${p.docRef ? `«${p.docRef.slice(0, 40)}»` : "пусто"}: нужна платёжка, п/п или письмо «оплачено» с датой`,
        href,
        upload: { action: "paymentProof", target: "production", paymentId: p.id, label: "Приложить платёжку" },
      });
    if (APPROX_RE.test(`${p.docRef ?? ""} ${p.notes ?? ""}`)) blockers.push({ text: "дата оплаты взята по письму или расчёту, а не из платёжки — уточнить по выписке", href });
    if (p.orders.length === 0) blockers.push({ text: "оплата не привязана к ТЗ и партии (аванс без разнесения)", href: "/payments" });
    const paidIso = iso(p.paidAt);
    const reg = registryFactFor({ amount, paidIso, ppNo }, sumByPp, reg0);
    const st = stampOf(p.confirmedAt, p.confirmedBy, userId, names);
    const verified = p.confirmed && !!p.confirmedAt;
    rows.push({
      key: `prodPayment:${p.id}`, kind: "prodPayment", id: p.id,
      title: `${formatDate(p.paidAt)} · ${fmtRub(p.amount)}`,
      sub: `${p.client?.name ?? "заказчик не указан"} · ${batches.length ? `партия ${batches.join(", ")}` : "вне партий"}${p.docRef ? ` · ${p.docRef.slice(0, 80)}` : ""}`,
      href, group: batches.length === 1 ? `Партия ${batches[0]}` : null, year: p.paidAt.getUTCFullYear(), amountText: fmtRub(p.amount),
      verified, auto: verified && st.auto, stampText: verified ? st.text : null, note: payNoteOf(p.notes), letter: !hasFile && ev === "letter",
      ready: blockers.length === 0, blockers,
      edit: { date: paidIso, amount: new Decimal(p.amount).toFixed(2), ref: p.docRef ?? "" },
      registryFact: reg, members: [], zero: !isCountedPayment(amount),
    });
    extra.paymentPp.set(`prodPayment:${p.id}`, { ppNo, amount, paidIso });
  }
}
