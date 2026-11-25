"use client";

import { formatPercent, formatDec1 } from "@/lib/utils";
import { perUnit, type Agg, type BudgetNode, type BudgetParams } from "@/lib/budget-calc";
import { money, qty, share } from "../ui";
import { TileCarousel } from "@/components/tile-carousel";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../../dashboard/tile";
import { ZERO } from "./parts";

/** Плитки итогов бюджета (Прогноз, Мех, Подкладка, Работа, Надбавка). */
export function TotalTiles({ fullTotal, fullCalc, furs, kindAgg, params }: { fullTotal: Agg; fullCalc: Map<string, Agg>; furs: BudgetNode[]; kindAgg: { cloth: Agg; acc: Agg }; params: BudgetParams }) {
  const perKind = (f: (a: Agg) => number | null, fmt: (v: number | null) => string = money): { k: string; v: string }[] =>
    ([["Одежда, 1 изд.", kindAgg.cloth], ["Аксессуары, 1 изд.", kindAgg.acc]] as const).filter(([, a]) => a.pcs > 0).map(([k, a]) => ({ k, v: fmt(f(a)) }));
  // ---- Плитки (как на Главной: TILE_BOX + Tile*, у всех по три строки — строки соседних плиток на одной горизонтали)
  const tile = (key: string, head: string, value: string, caption: string, items: { k: string; v: string }[]) => (
    <div key={key} className={TILE_BOX + " shadow-sm print:shadow-none"}>
      <TileHead>{head}</TileHead><TileValue>{value}</TileValue><TileCaption>{caption}</TileCaption>
      <TileList items={items} />
    </div>
  );
  // Плитка «Мех»: первым слайдом «Тотал», далее каждый тип меха.
  const furSlides = [
    { id: "mex", name: "Все виды меха", a: fullTotal },
    ...furs.map((f) => ({ id: f.id, name: f.name, a: fullCalc.get(f.id) ?? ZERO })),
  ].map((sl) => {
    const isMex = sl.id === "mex";
    const items = [
      { k: "Цена шкуры, ср.", v: money(sl.a.hides ? sl.a.mex / sl.a.hides : null) },
            { k: "Доля", v: share(isMex ? sl.a.mex : sl.a.total, fullTotal.total) },
    ];
    return {
      key: sl.id, label: sl.name,
      body: <><TileValue>{money(isMex ? sl.a.mex : sl.a.total)}</TileValue><TileCaption>{isMex ? `${formatDec1(sl.a.hides)} шкур` : `${qty(sl.a.pcs, 0)} изд. · ${qty(sl.a.hides, 0)} шкур`}</TileCaption><TileList items={items} /></>,
    };
  });
  const furTile = (
    <TileCarousel key="fur" title="Мех" hintLabel="Что показывает плитка «Мех»" hint={<p>Первый слайд — стоимость всего меха, далее каждый тип сырья: сколько изделий и шкур, средняя цена шкуры и доля в бюджете.</p>}
      slides={furSlides} slidesLabel="слайды: все виды меха и по типам" dotsLabel="Тип меха" />
  );

  return (
    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 print:grid-cols-5">
      {tile("t", "Прогноз бюджета", money(fullTotal.total), `${qty(fullTotal.pcs, 0)} изд.`, perKind(perUnit))}
      {furTile}
      {tile("l", "Подкладка", money(fullTotal.lining), `${formatDec1(fullTotal.meters)} м`, [{ k: "Цена за м, ср.", v: money(fullTotal.meters ? fullTotal.lining / fullTotal.meters : null) }, ...perKind((a) => (a.pcs ? a.meters / a.pcs : null), (v) => `${qty(v, 1)} м`), { k: "Доля", v: share(fullTotal.lining, fullTotal.total) }])}
      {tile("w", "Работа", money(fullTotal.work), "пошив", [...perKind((a) => (a.pcs ? a.work / a.pcs : null)), { k: "Доля", v: share(fullTotal.work, fullTotal.total) }])}
      {tile("c", `Надбавка ${formatPercent(params.c4)}`, money(fullTotal.c4), "на мех и подкладку", [...perKind((a) => (a.pcs ? a.c4 / a.pcs : null)), { k: "Доля", v: share(fullTotal.c4, fullTotal.total) }])}
    </div>
  );
}
