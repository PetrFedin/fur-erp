// Шаг расчёта Сводки: мех по источнику (аукционы / поставщик) и по источнику × типу меха (вынесено из loadDashboardImpl без изменений).
import { flowOf, type C4Kind, type FlowFigures, type FurLot } from "@/lib/fur-table";
import { classifyLotSource } from "@/lib/purchase-source";
import { figuresPair, type Pair } from "@/lib/dashboard-calc";
import { addHidesFig, BOUGHT_ORDERED, bumpFigures } from "./cells";
import type { Ordered } from "./types";
import type { Unreceived } from "./unreceived";

type Hides = { incl: number; excl: number };

export function rawSourcesOf(furLots: FurLot[], c4k: C4Kind, orderedBought: Ordered, hidesTotal: Hides) {
  const pairOf = (src: "auction" | "supplier") => figuresPair(flowOf(furLots.filter((l) => classifyLotSource(l) === src)), c4k);
  const a0 = pairOf("auction"), s = pairOf("supplier");
  const a = { incl: bumpFigures(a0.incl, orderedBought.qty, orderedBought.incl), excl: bumpFigures(a0.excl, orderedBought.qty, orderedBought.excl) };
  return {
    auction: { incl: a.incl, excl: a.excl },
    supplier: { incl: addHidesFig(s.incl, hidesTotal.incl), excl: addHidesFig(s.excl, hidesTotal.excl) },
  };
}

export function rawFurBySourceOf(furLots: FurLot[], c4k: C4Kind, orderedBought: Ordered, hidesTotal: Hides, unreceived: Unreceived, furPairAll: Pair<FlowFigures>) {
  // Источник × тип меха: те же flowOf/figuresPair, что у raw.fur / rawSources; заказанное, но не полученное (по виду) — к аукционам, шкуры подрядчика (вид «Свакара») — к поставщику.
  const hasHides = Math.abs(hidesTotal.incl) > 0 || Math.abs(hidesTotal.excl) > 0;
  const names = Array.from(new Set([...furLots.map((l) => l.item), ...unreceived.byFur.map((g) => g.label), ...(hasHides ? ["Свакара"] : [])])).sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  const build = (src: "all" | "auction" | "supplier", total: Pair<FlowFigures>) => {
    const ls = src === "all" ? furLots : furLots.filter((l) => classifyLotSource(l) === src);
    const types = names.flatMap((t) => {
      let p = figuresPair(flowOf(ls.filter((l) => l.item === t)), c4k);
      // Заказанное, но не принятое, входит в «Куплено» по всем мехам (BOUGHT_ORDERED, решение владельца 21.10; раньше — только рысь).
      if (BOUGHT_ORDERED.has(t) && src !== "supplier") { const o = unreceived.byFur.find((g) => g.label === t)?.ordered; if (o) p = { incl: bumpFigures(p.incl, o.qty, o.incl), excl: bumpFigures(p.excl, o.qty, o.excl) }; }
      if (hasHides && t === "Свакара" && src !== "auction") p = { incl: addHidesFig(p.incl, hidesTotal.incl), excl: addHidesFig(p.excl, hidesTotal.excl) };
      const f = p.incl;
      return Math.abs(f.recvQty) + Math.abs(f.recvValue) + Math.abs(f.usedQty) + Math.abs(f.remQty) > 0 ? [{ name: t, pair: p }] : [];
    });
    // Слайды видов — от самых больших объёмов к малым (по количеству «Куплено»), затем по названию.
    types.sort((x, y) => y.pair.incl.recvQty - x.pair.incl.recvQty || x.name.localeCompare(y.name, "ru"));
    return { total, types };
  };
  const a1 = figuresPair(flowOf(furLots.filter((l) => classifyLotSource(l) === "auction")), c4k);
  const a = { incl: bumpFigures(a1.incl, orderedBought.qty, orderedBought.incl), excl: bumpFigures(a1.excl, orderedBought.qty, orderedBought.excl) };
  const s = figuresPair(flowOf(furLots.filter((l) => classifyLotSource(l) === "supplier")), c4k);
  return {
    all: build("all", furPairAll),
    auction: build("auction", { incl: a.incl, excl: a.excl }),
    supplier: build("supplier", { incl: addHidesFig(s.incl, hidesTotal.incl), excl: addHidesFig(s.excl, hidesTotal.excl) }),
  };
}
