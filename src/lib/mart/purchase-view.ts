import "server-only";
import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { loadRawInfo } from "@/lib/raw-stage-server";
import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { formatDate } from "@/lib/utils";
import { purchaseTotalInclVat, purchaseTotalExclVat, itemTotalInclVat, expenseInclVat } from "@/lib/purchase-totals";
import { loadAuctionSummaries, auctionName, purchasePaidShare } from "@/lib/auction-payments";
import { classifyPurchaseSource } from "@/lib/purchase-source";
import { getFurIndex } from "@/lib/fur-ref-server";
import { NOT_SET, type FurLot } from "@/lib/fur-table";
import { furLotsOrLive } from "@/lib/mart/snapshots";
import type { PurchaseStatus, TreePurchase } from "@/app/(app)/purchases/purchases-agg";

/**
 * Строки раздела «Закупки» («Сырьё → Все»): одна запись на закупку — итог, оплата, лоты, позиции, расходы, оплаты и НДС по позициям.
 * Считается ОДИН раз при сборке витрины (снимок «purchases:tree»); страница только читает и фильтрует. Витрина устарела — тот же расчёт вживую.
 */
export type PurchaseViewRow = { p: TreePurchase; itemVat: Record<string, [string, number]> };
export type PurchaseViewData = { rows: PurchaseViewRow[]; auctionPays: Awaited<ReturnType<typeof loadAuctionSummaries>> };

const num = (d: Decimal) => d.toNumber();
function firstLine(v: string | null) {
  return (v ?? "").split(/\r?\n/)[0].trim();
}

export async function computePurchaseView(orgId: string): Promise<PurchaseViewData> {
  const furIdx = await getFurIndex(orgId);
  const [found, furLots, liningLots] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId: orgId },
      include: { supplier: true, auction: true, items: { include: { rawMaterial: true } }, expenses: { include: { category: true } }, payments: true },
      orderBy: { number: "desc" },
    }),
    furLotsOrLive(orgId, "fur", "all", furIdx),
    furLotsOrLive(orgId, "lining", "all", furIdx),
  ]);
  const lotsOf = new Map<string, FurLot[]>();
  const lotById = new Map<string, FurLot>();
  for (const l of [...furLots, ...liningLots]) {
    lotById.set(l.id, l);
    if (l.purchaseId) lotsOf.set(l.purchaseId, [...(lotsOf.get(l.purchaseId) ?? []), l]);
  }
  const rawInfo = await loadRawInfo(orgId, found.map((p) => p.id));

  // Оплаты по закупкам с аукционом ведутся по аукциону целиком — «оплачено» берём оттуда.
  const auctionNames = [...new Set(found.map((p) => auctionName(p.auctionSession)).filter((n): n is string => !!n))];
  const auctionPays = new Map((auctionNames.length ? await loadAuctionSummaries(prisma, orgId, auctionNames) : []).map((a) => [a.name, a]));

  // УПД из поля закупки; если поле пустое, но УПД приложен как документ — номер и дата берутся из него (данные документа, не расчёт).
  const updFromDocs = new Map<string, string>();
  const noUpd = found.filter((p) => !p.transferDocument?.trim()).map((p) => p.id);
  if (noUpd.length > 0) {
    for (const d of await prisma.driveDocument.findMany({ where: { organizationId: orgId, docType: "UPD", purchaseId: { in: noUpd }, docNumber: { not: null } }, select: { purchaseId: true, docNumber: true, docDate: true }, orderBy: { docDate: "asc" } })) {
      if (d.purchaseId && !updFromDocs.has(d.purchaseId)) updFromDocs.set(d.purchaseId, `№ ${d.docNumber}${d.docDate ? ` от ${formatDate(d.docDate)}` : ""}`);
    }
  }
  // Строки закупок: один расчёт для дерева, списка и плиток (одинаковые итоги).
  const all: TreePurchase[] = found.map((p) => {
    const total = purchaseTotalInclVat(p);
    const own = p.payments.filter((x) => x.status === "COMPLETED");
    const ownSum = own.reduce((a, x) => a.add(x.amount), new Decimal(0));
    const cancelled = p.status === "CANCELLED";
    const an = auctionName(p.auctionSession);
    const ap = auctionPays.get(an ?? "");
    const paidShare = cancelled ? new Decimal(0) : purchasePaidShare(ap, p.id, ownSum);
    const ls = lotsOf.get(p.id) ?? [];
    const status: PurchaseStatus = cancelled ? "CANCELLED" : p.status === "RECEIVED" ? "RECEIVED" : "DRAFT";
    const items = p.items.map((i) => {
      const lot = i.lotId ? lotById.get(i.lotId) : undefined;
      const q = num(i.quantity);
      const sum = num(itemTotalInclVat(i, p.exchangeRate));
      const unit = i.rawMaterial.unit === "M" ? ("м" as const) : ("шт." as const);
      return {
        id: i.id, lotId: i.lotId, material: i.rawMaterial.name, unit, qty: q, lot: i.lotNumber,
        color: lot && lot.color !== NOT_SET ? lot.color : null, size: lot && lot.size !== NOT_SET ? lot.size : null, grade: lot?.grade || null,
        sum, priceRub: q > 0 ? sum / q : null, priceUsd: lot?.usdPrice ?? null,
        recv: lot ? lot.recv : null, used: lot?.used ?? 0, rem: lot?.rem ?? 0,
        usages: (lot?.usages ?? []).map((u) => ({ orderId: u.orderId, number: u.label, qty: u.qty, sum: u.incl })),
      };
    });
    const unitIsM = (i: (typeof items)[number]) => i.unit === "м";
    return {
      id: p.id, number: p.number, date: formatDate(p.orderDate), year: p.orderDate.getUTCFullYear(),
      src: p.isContractorRaw ? ("supplier" as const) : classifyPurchaseSource(p.auction),
      batchKey: an ?? "none", batchLabel: an ? shortAuctionName(firstLine(p.auctionSession)) : "Без аукциона", auction: an,
      supplier: p.supplier.name, invoice: p.invoiceNumber && !isServiceAuction(p.invoiceNumber) ? p.invoiceNumber : null, upd: p.transferDocument?.trim() || updFromDocs.get(p.id) || null, status,
      total: num(total), totalExcl: num(purchaseTotalExclVat(p)), paid: num(paidShare), rest: cancelled ? 0 : num(total.sub(paidShare)),
      paidBatch: num(paidShare.sub(own.length > 0 ? ownSum : 0)),
      lots: p.items.length, fur: items.filter((i) => !unitIsM(i)).reduce((a, i) => a + i.qty, 0), lining: items.filter(unitIsM).reduce((a, i) => a + i.qty, 0),
      usedValue: ls.reduce((a, l) => a + l.usedIncl, 0), recvValue: ls.reduce((a, l) => a + l.recvIncl, 0), hasLots: ls.length > 0,
      // Остаток: по лотам; у принятой закупки без лотов нет; у заказанной, но не полученной (лотов ещё нет) — всё заказанное количество, как «Остаток» на Главной.
      remFur: ls.length > 0 ? ls.filter((l) => l.kind === "fur").reduce((a, l) => a + l.rem, 0) : status === "DRAFT" ? items.filter((i) => !unitIsM(i)).reduce((a, i) => a + i.qty, 0) : 0,
      remLining: ls.length > 0 ? ls.filter((l) => l.kind === "lining").reduce((a, l) => a + l.rem, 0) : status === "DRAFT" ? items.filter(unitIsM).reduce((a, i) => a + i.qty, 0) : 0,
      items,
      raw: rawInfo.get(p.id) ?? null,
      expenses: p.expenses.map((e) => ({ id: e.id, label: e.category.name + (e.description ? ` · ${e.description}` : ""), sum: num(expenseInclVat(e)) })),
      pays: own.map((x) => ({ id: x.id, date: formatDate(x.paidAt), amount: num(x.amount), doc: x.docRef?.trim() || null })),
    };
  });

  const itemVatOf = (p: (typeof found)[number]) => {
    const m: Record<string, [string, number]> = {};
    for (const i of p.items) { const r = i.vatRate.toNumber(); if (r > 0) m[i.id] = [String(r), num(itemTotalInclVat(i, p.exchangeRate)) * r / (100 + r)]; }
    return m;
  };
  const byId = new Map(found.map((p) => [p.id, p]));
  return { rows: all.map((p) => ({ p, itemVat: itemVatOf(byId.get(p.id)!) })), auctionPays: [...auctionPays.values()] };
}
