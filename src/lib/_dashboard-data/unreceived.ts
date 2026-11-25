import { isZero } from "@/domain/money";
import "server-only";
// Шаг расчёта Сводки: заказанное, но не полученное (закупки без лотов) и оплаты закупок без аукциона (вынесено из loadDashboardImpl без изменений).
import { prisma } from "@/lib/prisma";
import type { FurLot } from "@/lib/fur-table";
import { lotUsdPrice } from "@/lib/lot-hammer";
import { auctionName } from "@/lib/auction-names";
import type { loadDebtInputs, SupplierDebt } from "@/lib/supplier-debt";
import { inYear, type YearFilter } from "@/lib/year-filter";
import type { DashFilters } from "@/lib/dashboard-calc";
import { addVat, BOUGHT_ORDERED } from "./cells";
import type { Ordered, VatByRate } from "./types";

export async function collectUnreceived(
  orgId: string,
  year: YearFilter,
  f: DashFilters,
  { aucMoney, aucTotalValue, allLots, lotsAllYears, debtInputs, debtRaw, furName }: {
    aucMoney: Map<string, { paid: number; due: number }>;
    aucTotalValue: Map<string, number>;
    allLots: FurLot[];
    lotsAllYears: FurLot[];
    debtInputs: Awaited<ReturnType<typeof loadDebtInputs>>;
    debtRaw: SupplierDebt;
    furName: (raw: string) => string;
  },
) {
  // Заказанное, но не полученное (нет лотов): фильтры «вид меха» и «аукцион» действуют, фильтры по цвету, признаку и НДС лотов — исключают.
  const orderedOk = (label: string, aucName: string) =>
    !(f.color.length || f.attr.length || f.vat.length) && (!f.fur.length || f.fur.includes(label)) && (!f.auction.length || f.auction.some((x) => auctionName(x) === aucName || x === aucName));
  /** Цена шкуры в $ из расчёта позиции закупки (лота ещё нет): «цена за ед., $» либо материал без НДС ÷ зафиксированный курс. */
  const planUsd = (plan: unknown, purchaseNumber: string | null, lotNumber: string | null, vatRate: number): number | null => {
    const direct = lotUsdPrice(null, [plan], { vatRate, purchaseNumber, lotNumber });
    if (direct.usd != null && direct.usd > 0) return direct.usd;
    const pl = plan as { materialExclVat?: unknown; costBreakdown?: { items?: { label?: string; value?: number }[] } } | null;
    const fix = pl?.costBreakdown?.items?.find((x) => x.label === "Курс ЦБ (фиксация)")?.value;
    const mat = Number(pl?.materialExclVat);
    return fix && fix > 0 && Number.isFinite(mat) && mat > 0 ? mat / fix : null;
  };
  const orderedYear = new Map<number, Ordered>();
  /** НДС заказанного, но не полученного меха по ставкам позиций закупки (с тем же масштабом, что и сумма). */
  const orderedVat: VatByRate = {};
  const unreceived = { paid: 0, due: 0, names: [] as string[], byFur: [] as { label: string; names: string[]; paid: number; due: number; ordered: Ordered; years: Map<number, Ordered>; usd: { q: number; s: number }; positions: number }[] };
  const matName = new Map((await prisma.rawMaterial.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  // Оплаты закупок без аукциона (З-2026-…): если у закупки есть лоты, это оплата конкретных видов меха, а не «мех не получен».
  const purchaseNo = new Map(debtInputs.allPurchases.map((p) => [p.number, p.id]));
  const purchasePaid: { id: string; paid: number }[] = [];
  for (const [name, m] of aucMoney) {
    const pid = purchaseNo.get(name);
    if (pid && allLots.some((l) => l.purchaseId === pid)) {
      const all = allLots.filter((l) => l.purchaseId === pid).reduce((a, l) => a + l.recvIncl, 0);
      const sel = lotsAllYears.filter((l) => l.purchaseId === pid).reduce((a, l) => a + l.recvIncl, 0);
      purchasePaid.push({ id: pid, paid: all > 0 ? m.paid * (sel / all) : 0 });
      aucMoney.delete(name);
      continue;
    }
    if ((aucTotalValue.get(name) ?? 0) > 0 || (isZero(m.paid) && isZero(m.due))) continue;
    unreceived.paid += m.paid; unreceived.due += m.due;
    if (!/^З-\d{4}-\d+$/.test(name)) unreceived.names.push(name);
    // Состав заказа (ещё без лотов): делим деньги по видам меха пропорционально стоимости позиций.
    const byFurVal = new Map<string, Ordered>();
    const byFurYear = new Map<string, Map<number, Ordered>>();
    const byFurUsd = new Map<string, { q: number; s: number }>();
    const byFurVat = new Map<string, VatByRate>();
    const byFurPos = new Map<string, number>();
    for (const p of debtInputs.allPurchases) {
      if (p.status === "CANCELLED" || auctionName(p.auctionSession) !== name || !inYear(p.orderDate, year)) continue;
      for (const it of p.items) {
        const nm = matName.get((it as { rawMaterialId?: string }).rawMaterialId ?? "");
        if (!nm) continue;
        const k = furName(nm);
        const q = it.quantity?.toNumber() ?? 0, incl = it.subtotal.mul(it.vatRate.div(100).add(1)).toNumber(), excl = it.subtotal.toNumber();
        const cur = byFurVal.get(k) ?? { qty: 0, incl: 0, excl: 0 };
        cur.qty += q; cur.incl += incl; cur.excl += excl;
        byFurVal.set(k, cur);
        byFurPos.set(k, (byFurPos.get(k) ?? 0) + 1);
        const bv = byFurVat.get(k) ?? {}; addVat(bv, it.vatRate.toNumber(), incl - excl); byFurVat.set(k, bv);
        // По годам закупки и цена в $ (из расчёта позиции): нужны окнам «Цена по видам сырья» для вида без лотов (рысь).
        const yr = p.orderDate ? p.orderDate.getFullYear() : 2026;
        const ym = byFurYear.get(k) ?? new Map<number, Ordered>();
        const yc = ym.get(yr) ?? { qty: 0, incl: 0, excl: 0 };
        yc.qty += q; yc.incl += incl; yc.excl += excl; ym.set(yr, yc); byFurYear.set(k, ym);
        const usd = planUsd((it as { costPlan?: unknown }).costPlan, p.number, (it as { lotNumber?: string | null }).lotNumber ?? null, it.vatRate.toNumber());
        if (usd != null && q > 0) { const u = byFurUsd.get(k) ?? { q: 0, s: 0 }; u.q += q; u.s += q * usd; byFurUsd.set(k, u); }
      }
    }
    const totV = Array.from(byFurVal.values()).reduce((a, v) => a + v.incl, 0);
    // Позиции закупки иногда внесены без цены (СП 09.26): общую сумму берём из расчёта закупки, а по видам делим по позициям.
    const aucTotal = debtRaw.byAuction.find((x) => x.name === name)?.total.toNumber() ?? totV;
    const scale = totV > 0 ? aucTotal / totV : 1;
    if (totV > 0) for (const [label, v] of byFurVal) {
      if (!orderedOk(label, name)) continue;
      const g = unreceived.byFur.find((x) => x.label === label) ?? (unreceived.byFur.push({ label, names: [], paid: 0, due: 0, ordered: { qty: 0, incl: 0, excl: 0 }, years: new Map(), usd: { q: 0, s: 0 }, positions: 0 }), unreceived.byFur[unreceived.byFur.length - 1]);
      g.paid += m.paid * (v.incl / totV); g.due += m.due * (v.incl / totV); if (!g.names.includes(name)) g.names.push(name);
      g.ordered.qty += v.qty; g.ordered.incl += v.incl * scale; g.ordered.excl += v.excl * scale;
      g.positions += byFurPos.get(label) ?? 0;
      if (BOUGHT_ORDERED.has(label)) for (const [rate, x] of Object.entries(byFurVat.get(label) ?? {})) addVat(orderedVat, rate, x * scale);
      for (const [yr, yv] of byFurYear.get(label) ?? []) {
        const yc = g.years.get(yr) ?? { qty: 0, incl: 0, excl: 0 };
        yc.qty += yv.qty; yc.incl += yv.incl * scale; yc.excl += yv.excl * scale; g.years.set(yr, yc);
      }
      const uv = byFurUsd.get(label); if (uv) { g.usd.q += uv.q; g.usd.s += uv.s; }
    }
    // По годам закупки (для «Динамики по годам»).
    for (const p of debtInputs.allPurchases) {
      if (p.status === "CANCELLED" || auctionName(p.auctionSession) !== name || !inYear(p.orderDate, year) || !p.orderDate) continue;
      const y = p.orderDate.getFullYear();
      const cur = orderedYear.get(y) ?? { qty: 0, incl: 0, excl: 0 };
      for (const it of p.items) {
        const nm = matName.get((it as { rawMaterialId?: string }).rawMaterialId ?? "");
        if (!nm || !orderedOk(furName(nm), name) || !BOUGHT_ORDERED.has(furName(nm))) continue;
        cur.qty += it.quantity?.toNumber() ?? 0; cur.incl += it.subtotal.mul(it.vatRate.div(100).add(1)).toNumber() * scale; cur.excl += it.subtotal.toNumber() * scale;
      }
      orderedYear.set(y, cur);
    }
  }
  return { orderedYear, orderedVat, unreceived, purchasePaid };
}

export type Unreceived = Awaited<ReturnType<typeof collectUnreceived>>["unreceived"];
