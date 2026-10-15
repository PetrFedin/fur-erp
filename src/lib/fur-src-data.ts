// Мех по источникам и видам для раздела «Сырьё»: те же flowOf/figures по лотам, что дают плитки, и то же выравнивание рублей (alignRaw),
// что на Главной: «На аукционах» + «У поставщика» = «Вся закупка», сумма видов = «Все типы» источника. Без React — вызывается из таблицы и из scripts/test-source-scope.ts.
import { figures, flowOf, type FlowFigures, type FurLot } from "@/lib/fur-table";
import { classifyLotSource } from "@/lib/purchase-source";
import { FUR_SRC_KEYS, type FurSrc } from "@/lib/fur-src";
import { alignRaw, type FurSrcData } from "@/lib/raw-display";

type Pair = { incl: FlowFigures; excl: FlowFigures };

/** Лот относится к источнику (аукцион / поставщик) или любому («all»). */
export const lotInSrc = (s: FurSrc, l: Pick<FurLot, "source">) => s === "all" || classifyLotSource(l) === s;

export const pairOfLots = (ls: FurLot[], c4: "on" | "off"): Pair => {
  const fl = flowOf(ls);
  return { incl: figures(fl, { vat: "incl", c4 }), excl: figures(fl, { vat: "excl", c4 }) };
};

/**
 * @param lots лоты (в том числе «заказано, не получено» и шкуры подрядчика) всех источников после фильтров таблицы
 * @param typesBySrc виды меха внутри каждого источника (слайды); у «all» могут быть виды без лотов
 * @param top плитки Главной без фильтров (мех и подкладка — «Всего» выравнивается по ним); с фильтрами — null
 */
export function alignFurBySource(lots: FurLot[], typesBySrc: Partial<Record<FurSrc, string[]>>, c4: "on" | "off", top: { fur: Pair; lining: Pair } | null) {
  const data = {} as FurSrcData;
  for (const sr of FUR_SRC_KEYS) {
    data[sr] = {
      total: pairOfLots(lots.filter((l) => lotInSrc(sr, l)), c4),
      types: (typesBySrc[sr] ?? []).map((name) => ({ name, pair: pairOfLots(lots.filter((l) => lotInSrc(sr, l) && l.item === name), c4) })),
    };
  }
  return alignRaw(top ? top.fur : data.all.total, top ? top.lining : pairOfLots([], c4), data, c4);
}
