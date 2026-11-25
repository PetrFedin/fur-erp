import { isPositive } from "@/domain/money";
import "server-only";
// ТЗ Сводки: выбор ТЗ по фильтрам, окно «Стоимость производства», доплата подрядчику (вынесено из dashboard-data.ts без изменений).
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { prisma } from "@/lib/prisma";
import { loadOrderRows, receivedByModel, receivedByModelBucket, receivedForModelsWithout } from "@/lib/analytics-orders";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { auctionLabeler, purchaseIdsByAuction } from "@/lib/filter-options";
import { allocateHides, hidesApply, hidesByPayYear } from "@/lib/contractor-hides";
import type { YearFilter } from "@/lib/year-filter";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { isDone, orderMatches, toDrillOrder, REPAIR_CATEGORY, type DashFilters } from "@/lib/dashboard-calc";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { loadSalesLines } from "@/lib/sales-server";
import { modelSeasonShares, orderSeasonShares } from "@/lib/order-seasons";

export const furNameFn = async (orgId: string) => {
  const idx = await getFurIndex(orgId);
  return (raw: string) => canonicalFur(raw, idx)?.name ?? raw;
};

/** Выбранные ТЗ (все годы либо год шапки) по фильтрам панели. */
export async function loadSelectedOrders(orgId: string, year: YearFilter, f: DashFilters, c4: Commission4Mode) {
  const [rows, furName, aucIds] = await Promise.all([
    loadOrderRows(orgId, year, c4),
    furNameFn(orgId),
    f.auction.length ? purchaseIdsByAuction(orgId, f.auction).then((a) => new Set(a)) : Promise.resolve(null),
  ]);
  return { selected: rows.filter((o) => orderMatches(o, f, aucIds, furName)), aucIds, furName };
}

/** Окно «Стоимость производства»: ТЗ выбранной группы (done — произведено, work — в работе) в режиме 4% из cookie. */
export async function loadDrillOrders(orgId: string, year: YearFilter, f: DashFilters, c4: Commission4Mode, scope: "done" | "work" | "all"): Promise<DrillOrder[]> {
  const [{ selected, furName }, label] = await Promise.all([loadSelectedOrders(orgId, year, f, c4), auctionLabeler(orgId)]);
  const short = (name: string | null) => (name ? label(name).label : "Без аукциона");
  const orders = selected.filter((o) => (scope === "all" ? true : scope === "done" ? isDone(o) : !isDone(o))).map((o) => toDrillOrder(o, c4, short, furName));
  // Шкуры подрядчика (оплачены в составе пошива, в ТЗ не списаны) — в партию и ТЗ, где использовались (см. contractor-hides.ts).
  if (scope === "all" && hidesApply(f)) {
    const ov = await loadPaymentsOverview(orgId);
    const shares = allocateHides(orders.map((o) => ({ id: o.id, number: o.number, batch: o.bk, qty: o.qty })), hidesByPayYear(ov), year);
    for (const sh of shares) { const o = orders.find((x) => x.id === sh.id); if (o) { o.hI += sh.incl; o.hE += sh.excl; } }
  }
  // Доли сезонов ТЗ (переключатель «Сезон» на Главной): по приходу модели, иначе по дате ТЗ (см. order-seasons.ts).
  {
    const [dates, salesLines] = await Promise.all([
      prisma.productionOrder.findMany({ where: { id: { in: orders.map((o) => o.id) } }, select: { id: true, endDate: true, workOrderDate: true, startDate: true } }),
      loadSalesLines(orgId),
    ]);
    const byModel = modelSeasonShares(salesLines.map((l) => ({ article: l.article, iso: l.iso, pcs: l.pcs, kind: l.kind })));
    const dateOf = new Map(dates.map((d) => [d.id, (d.endDate ?? d.workOrderDate ?? d.startDate)?.toISOString().slice(0, 10) ?? null]));
    const rowOf = new Map(selected.map((r) => [r.id, r]));
    for (const o of orders) { const r = rowOf.get(o.id); if (r) o.sw = orderSeasonShares({ model: r.modelName, date: dateOf.get(o.id) ?? null, year: r.year }, byModel); }
  }
  // «Произведено» = получено по приходу (все годы): доля ТЗ модели qf = получено ÷ объём всех ТЗ модели (кроме ремонта); тот же знаменатель, что у себестоимости единицы в loadModelCosts.
  if (scope === "all") {
    const [recv, all] = await Promise.all([receivedByModel(orgId), loadOrderRows(orgId, "all", c4)]);
    const cap = new Map<string, number>();
    for (const r of all) if (r.category !== REPAIR_CATEGORY) cap.set(r.modelId, (cap.get(r.modelId) ?? 0) + r.qty);
    const modelOf = new Map(selected.map((r) => [r.id, r.modelId]));
    for (const o of orders) {
      if (o.cat === REPAIR_CATEGORY) continue;
      const m = modelOf.get(o.id), c = m ? cap.get(m) ?? 0 : 0;
      o.qf = c > 0 && m ? (recv.get(m) ?? 0) / c : 0;
      o.qd = o.qty * o.qf;
    }
    // Сезоны «Произведено» = сезоны прихода: приход модели по сезонам раскладывается на её ТЗ по возрастанию номера, ранние сезоны — в ранние ТЗ
    // (так по сезонам получается ровно приход: FW 25/26, SS 2026, FW 26/27). Год ТЗ определяет порядок, а не долю по истории продаж.
    const byBucket = await receivedByModelBucket(orgId);
    const seasonKey = (x: string) => { const fw = /(\d{2})\/(\d{2})/.exec(x); return fw ? (2000 + Number(fw[1])) * 2 + 1 : (Number((/(20\d{2})/.exec(x) ?? [])[1]) || 0) * 2; };
    const byModel = new Map<string, DrillOrder[]>();
    for (const o of orders) { if (o.cat === REPAIR_CATEGORY) continue; const m = modelOf.get(o.id); if (m) (byModel.get(m) ?? byModel.set(m, []).get(m)!).push(o); }
    for (const [m, list] of byModel) {
      const seas = (byBucket.get(m) ?? []).filter((b) => b.pcs > 0).map((b) => ({ k: b.k, left: b.pcs }));
      if (!seas.length) continue;
      let si = 0;
      const parts: { o: DrillOrder; got: Record<string, number>; tot: number }[] = [];
      for (const o of list.sort((a, b) => a.number.localeCompare(b.number))) {
        let need = o.qd ?? 0; const got: Record<string, number> = {}; const tot = need;
        while (need > 1e-9 && si < seas.length) { const take = Math.min(need, seas[si].left); got[seas[si].k] = (got[seas[si].k] ?? 0) + take; seas[si].left -= take; need -= take; if (seas[si].left <= 1e-9) si++; }
        if (tot > 0) { const bs: Record<string, number> = {}; for (const [k, v] of Object.entries(got)) { const sn = k.split("|")[0]; bs[sn] = (bs[sn] ?? 0) + v / tot; } o.swd = bs; }
        parts.push({ o, got: { ...got }, tot });
      }
      // Заказ (объём ТЗ) по сезонам: полученное — в сезон прихода; полученное сверх объёма ТЗ модели в заказ не входит (снимаем с самых поздних сезонов и ТЗ);
      // ещё не полученное — в открытый сезон (FW 26/27).
      let excess = parts.reduce((a, x) => a + x.tot, 0) - parts.reduce((a, x) => a + x.o.qty, 0);
      for (let i = parts.length - 1; i >= 0 && excess > 1e-9; i--) {
        for (const k of Object.keys(parts[i].got).reverse()) { const t = Math.min(excess, parts[i].got[k]); parts[i].got[k] -= t; excess -= t; if (excess <= 1e-9) break; }
      }
      // Доли заказа по сезонам одинаковы у всех ТЗ модели (итог по модели: полученное по сезонам + ещё не полученное в открытом сезоне).
      const Q = parts.reduce((a, x) => a + x.o.qty, 0), M: Record<string, number> = {};
      for (const { got } of parts) for (const [k, v] of Object.entries(got)) M[k] = (M[k] ?? 0) + v;
      const unrecv = Math.max(0, Q - Object.values(M).reduce((a, v) => a + v, 0));
      if (unrecv > 1e-9) M[OPEN_SEASON + "|2026"] = (M[OPEN_SEASON + "|2026"] ?? 0) + unrecv;
      if (Q > 0) for (const { o } of parts) {
        o.swy = Object.fromEntries(Object.entries(M).filter(([, v]) => v > 1e-9).map(([k, v]) => [k, v / Q]));
        const bs: Record<string, number> = {}; for (const [k, v] of Object.entries(o.swy)) { const sn = k.split("|")[0]; bs[sn] = (bs[sn] ?? 0) + v; }
        o.sw = bs;
      }
    }
    // Модели без прихода вовсе: весь объём ТЗ ждёт прихода в открытом сезоне.
    for (const o of orders) if (o.cat !== REPAIR_CATEGORY && o.swd === undefined && o.qty > 0) { o.sw = { [OPEN_SEASON]: 1 }; o.swy = { [OPEN_SEASON + "|2026"]: 1 }; }
  }
  return orders;
}

/** Получено по моделям, у которых нет ни одного ТЗ (кроме ремонта), по группам: в «Произведено» их нечем оценить. */
export async function receivedWithoutTz(orgId: string, c4: Commission4Mode): Promise<Record<string, number>> {
  const all = await loadOrderRows(orgId, "all", c4);
  const has = new Set(all.filter((r) => r.category !== REPAIR_CATEGORY && r.qty > 0).map((r) => r.modelId));
  return receivedForModelsWithout(orgId, has);
}

/** Открытый сезон: заказ больше прихода (ещё придёт). */
const OPEN_SEASON = "FW 26/27";

/**
 * Доплата подрядчику (НДС 22 % вместо 20 % по сырью заказчика, решение 20.10.2026): остаток оплат за пошив, на который нет закупки. Относим её к тому, к чему
 * она относится: виды меха — пропорционально стоимости сырья, списанного в ТЗ этих оплат (ТЗ из строк разнесения «ТЗ N»,
 * внутри платежа — пропорционально разнесённой работе). ТЗ без списаний делят свою долю между остальными. Ключ: «fur|Вид» или «lining».
 */
export async function surchargeSplit(orgId: string, rows: Awaited<ReturnType<typeof loadPaymentsOverview>>, year: YearFilter, c4: Commission4Mode): Promise<Map<string, number>> {
  const pays = rows.filter((r) => isPositive(r.hides) && (year === "all" || r.year === Number(year)));
  const out = new Map<string, number>();
  if (pays.length === 0) return out;
  const orders = await loadDrillOrders(orgId, "all", { auction: [], fur: [], color: [], attr: [], batch: [], status: [], vat: [], catgroup: [] }, c4, "all");
  const byWo = new Map<string, DrillOrder[]>();
  for (const o of orders) { const k = String(o.wo ?? ""); byWo.set(k, [...(byWo.get(k) ?? []), o]); }
  let orphan = 0;
  for (const r of pays) {
    const parts = r.parts.filter((pt) => /^ТЗ \d+/.test(pt.label));
    const sumW = parts.reduce((a, pt) => a + pt.amount, 0);
    if (sumW <= 0) { orphan += r.hides; continue; }
    for (const pt of parts) {
      const share = (pt.amount / sumW) * r.hides;
      const lines = (byWo.get(/^ТЗ (\d+)/.exec(pt.label)![1]) ?? []).flatMap((o) => o.lines);
      const all = lines.reduce((a, l) => a + l.i, 0);
      if (all <= 0) { orphan += share; continue; }
      for (const l of lines) { const k = l.k === "l" ? "lining" : `fur|${l.fu}`; out.set(k, (out.get(k) ?? 0) + share * (l.i / all)); }
    }
  }
  const base = Array.from(out.values()).reduce((a, v) => a + v, 0);
  if (orphan > 0 && base > 0) for (const [k, v] of out) out.set(k, v + orphan * (v / base));
  // В «Оплатах» и Cash Flow доплата подрядчику вся числится в меху (payments-overview: fur = hides); доля подкладки (≈1,5 %) добавляется к видам меха пропорционально,
  // чтобы строки таблицы сходились с виджетами «Оплаты».
  const lin = out.get("lining") ?? 0;
  if (lin > 0) {
    out.delete("lining");
    const furBase = Array.from(out.values()).reduce((a, v) => a + v, 0);
    if (furBase > 0) for (const [k, v] of out) out.set(k, v + lin * (v / furBase)); else out.set("fur|Свакара", lin);
  }
  return out;
}
