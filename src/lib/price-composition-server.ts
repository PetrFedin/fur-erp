import "server-only";
// Данные виджета Главной «Из чего складывается стоимость меха»: состав цены каждого купленного лота меха (расчётный лист лота),
// заказанного, но не полученного меха (расчёт позиций закупки, costPlan) и шкур подрядчика (расчёта нет — «без разбивки»).
// Лоты — те же, что дают «Куплено» меха на Главной (год и фильтры), поэтому Σ секторов + «без разбивки» + НДС = «Куплено, ₽ с НДС».
import { prisma } from "@/lib/prisma";
import { classifyLotSource } from "@/lib/purchase-source";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import type { DashboardData } from "@/lib/dashboard-data";
import { COMP_CATS, lotComposition, splitVat } from "@/lib/price-composition";

/** Одна строка виджета: лот, заказанный мех вида или шкуры подрядчика. excl — по COMP_CATS (порядок), затем «без разбивки»; всё в ₽ без НДС. */
export type PCLot = {
  id: string;
  /** Подпись: номер лота или «заказано, не получено» / «шкуры подрядчика». */
  num: string;
  fur: string;
  auction: string;
  qty: number;
  excl: number[];
  /** Часть «Прочих расходов» (без НДС), заданная строкой «Упаковка» расчёта; остальное — остаток до цены лота. */
  pack: number;
  /** НДС лота, ₽ (цена с НДС − цена без НДС). */
  vat: number;
  kind: "lot" | "planned" | "hides";
  /** Источник закупки: на аукционе или у поставщика (как «На аукционах» / «У поставщика» в плитках сырья). */
  src: "auction" | "supplier";
  /** Заказано, не получено: сколько позиций закупки в строке (лотов ещё нет). */
  positions?: number;
  /** Часть сумм вычислена (молоток из справочника Drive и т.п.). */
  approx: boolean;
};

export type PriceCompositionData = { lots: PCLot[] };

const NCAT = COMP_CATS.length;

export async function priceComposition(orgId: string, d: Pick<DashboardData, "priceLots" | "syntheticLots">): Promise<PriceCompositionData> {
  const out: PCLot[] = [];
  const ids = d.priceLots.map((l) => l.id);
  const rows = ids.length
    ? await prisma.rawMaterialLot.findMany({ where: { id: { in: ids }, organizationId: orgId }, select: { id: true, costBreakdown: true, purchaseItems: { select: { costPlan: true } } } })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const l of d.priceLots) {
    const r = byId.get(l.id);
    const comp = lotComposition({ breakdown: r?.costBreakdown, plans: (r?.purchaseItems ?? []).map((i) => i.costPlan), vatRate: l.vatRate, qty: l.recv, totalIncl: l.recvIncl, purchaseNumber: l.purchaseNumber, lotNumber: l.lotNumber });
    const excl = new Array<number>(NCAT + 1).fill(0);
    let vat = l.recvIncl - l.recvExcl;
    let approx = false;
    let pack = 0;
    if (comp) {
      const sp = splitVat(comp, l.vatRate, l.recvExcl);
      COMP_CATS.forEach((c, i) => { excl[i] = sp.excl[c.key]; });
      vat = sp.vat;
      approx = comp.approx;
      const oi = COMP_CATS.findIndex((c) => c.key === "other");
      pack = comp.incl.other > 0.005 ? excl[oi] * Math.min(1, comp.pack / comp.incl.other) : 0;
    } else excl[NCAT] = l.recvExcl;
    out.push({ id: l.id, num: l.lotNumber, fur: l.item, auction: l.auctionLabel, qty: l.recv, excl, pack, vat, kind: "lot", src: classifyLotSource(l), approx });
  }

  // Заказано, но не получено (рысь и др.): состав — по расчёту позиций закупки; доли переносятся на сумму «Куплено» этого вида (она уже масштабирована к счёту аукциона).
  const ordered = d.syntheticLots.filter((l) => l.id.startsWith("ordered:"));
  if (ordered.length > 0) {
    const furIdx = await getFurIndex(orgId);
    const items = await prisma.purchaseItem.findMany({
      where: { lotId: null, purchase: { organizationId: orgId, status: { in: ["DRAFT", "ORDERED", "IN_TRANSIT"] } } },
      select: { quantity: true, subtotal: true, vatRate: true, costPlan: true, rawMaterial: { select: { name: true } } },
    });
    for (const s of ordered) {
      const w = new Array<number>(NCAT + 1).fill(0);
      let packW = 0;
      let approx = false;
      for (const it of items) {
        if ((canonicalFur(it.rawMaterial.name, furIdx)?.name ?? it.rawMaterial.name) !== s.item) continue;
        const q = it.quantity.toNumber(), vr = it.vatRate.toNumber();
        const planTotal = Number((it.costPlan as { unitCostInclVat?: unknown } | null)?.unitCostInclVat) * q;
        const comp = Number.isFinite(planTotal) && planTotal > 0 ? lotComposition({ breakdown: null, plans: [it.costPlan], vatRate: vr, qty: q, totalIncl: planTotal }) : null;
        if (comp) {
          const sp = splitVat(comp, vr);
          COMP_CATS.forEach((c, i) => { w[i] += sp.excl[c.key]; });
          packW += comp.incl.other > 0.005 ? sp.excl.other * Math.min(1, comp.pack / comp.incl.other) : 0;
          approx = approx || comp.approx;
        } else w[NCAT] += it.subtotal.toNumber();
      }
      const tw = w.reduce((a, x) => a + x, 0);
      const excl = tw > 0 ? w.map((x) => (x / tw) * s.recvExcl) : (() => { const e = new Array<number>(NCAT + 1).fill(0); e[NCAT] = s.recvExcl; return e; })();
      out.push({ id: s.id, num: "Закупка", fur: s.item, auction: s.auctionLabel, qty: s.recv, excl, pack: tw > 0 ? (packW / tw) * s.recvExcl : 0, vat: s.recvIncl - s.recvExcl, kind: "planned", src: classifyLotSource(s), positions: s.positions, approx });
    }
  }

  // Шкуры подрядчика (оплачены в составе пошива): расчёта цены нет — вся сумма «без разбивки».
  for (const s of d.syntheticLots.filter((l) => l.id.startsWith("hides:"))) {
    const excl = new Array<number>(NCAT + 1).fill(0);
    excl[NCAT] = s.recvExcl;
    out.push({ id: s.id, num: `шкуры подрядчика ${s.year}`, fur: s.item, auction: s.auctionLabel, qty: s.recv, excl, pack: 0, vat: s.recvIncl - s.recvExcl, kind: "hides", src: classifyLotSource(s), approx: false });
  }
  return { lots: out };
}

