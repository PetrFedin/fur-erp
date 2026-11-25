"use client";

import { Fragment, type ReactNode } from "react";
import { formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { SortMark } from "@/components/table-head";
import { useClientSort } from "@/lib/use-client-sort";
import type { FlowFigures, FurKind, FurLot } from "@/lib/fur-table";
import { A, Q, R, U } from "./helpers";
import { Num, Th } from "./cells";

/** Колонки таблицы по показателям и ячейки строк (шапка, НДС, оплата, числа). Состояние — в FurSelectionTotal, сюда передаются значения. */
export function makeTableCells(ctx: { kind: FurKind; unit: string; showQty: boolean; showMoney: boolean; c4: "on" | "off"; group: "item" | "year" | "auction" | "lots"; cs: ReturnType<typeof useClientSort<{ figures: FlowFigures; label: string }>> }) {
  const { kind, unit, showQty, showMoney, c4, group, cs } = ctx;
  // Колонки по показателям: Куплено (шт., ₽, ср. цена) → Использовано (…) → Остаток (…); режим шт./₽/Все прячет лишнее.
  const GROUPS = [
    { key: "recv", title: "Куплено", what: "закупки", extra: "4 % к закупке не применяется.", qty: (f: FlowFigures) => f.recvQty, val: (f: FlowFigures) => f.recvValue, avg: (f: FlowFigures) => f.recvAvg, usd: (f: FlowFigures) => f.usdAvg },
    { key: "used", title: "Использовано", what: "использования", extra: "4 % начисляется только на строки списания, где оно разрешено.", qty: (f: FlowFigures) => f.usedQty, val: (f: FlowFigures) => f.usedValue, avg: (f: FlowFigures) => f.usedAvg, usd: (f: FlowFigures) => f.usdUsedAvg },
    { key: "rem", title: "Остаток", what: "остатка", extra: "4 % к остатку не применяется (оно начисляется при списании в ТЗ).", qty: (f: FlowFigures) => f.remQty, val: (f: FlowFigures) => f.remValue, avg: (f: FlowFigures) => f.remAvg, usd: (f: FlowFigures) => f.usdRemAvg },
  ] as const;
  // Средневзвешенные цены: ₽ — всегда; $ — только по лотам, у которых цена в $ записана в расчёте лота (lotUsdPrice); нет ни у одного — «—» (курс не придумываем).
  const showUsd = kind !== "lining"; // у подкладки цены в $ нет — колонок $ нет
  // Молоток, ₽/шт. — отдельная колонка в блоке «Куплено» (цена шкуры на аукционе до сборов, выделки, транспорта, брокера и комиссий; lotHammer).
  const showHam = false; // колонка «Молоток» убрана из таблиц; молоток и «итого цена лота» — только в карточке лота
  const colsOf = (key: string) => (showQty ? 1 : 0) + (showMoney ? 1 : 0) + 1 + (showUsd ? 1 : 0) + (showHam && key === "recv" ? 1 : 0);
  // Мех и подкладка: четвёртый блок «НДС» (ставка · НДС, ₽ · НДС в ТЗ) сразу после «Остаток».
  const showVat = false; // блок «НДС» в таблице убран: НДС показан в «Использовании по ТЗ» и в плитках
  const showPay = kind === "lining"; // подкладка: блок «Оплата» (оплачено · долг) — доли оплат партии по стоимости лота, как в плитках
  const totalCols = GROUPS.reduce((a, g) => a + colsOf(g.key), 0) + (showVat ? 2 : 0) + (showPay ? 2 : 0);
  const priceUnit = kind === "lining" ? "м" : "шт.";
  const groupHead = (
    <tr>
      <th rowSpan={2} className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left align-middle font-medium">
        <button type="button" onClick={cs.th("name").onSort} aria-sort={cs.th("name").sort === "asc" ? "ascending" : cs.th("name").sort === "desc" ? "descending" : "none"} className="inline-flex items-center gap-1 hover:underline max-md:min-h-11">
          <span>{group === "lots" ? "Лот" : group === "year" ? "Год закупки" : group === "auction" ? "Аукцион / закупка" : kind === "lining" ? "Подкладка" : "Мех"}</span>
          <SortMark dir={cs.th("name").sort} />
        </button>
      </th>
      {GROUPS.map((g) => (
        <THGroup key={g.key} colSpan={colsOf(g.key)}>{g.title}</THGroup>
      ))}
      {showPay && <THGroup colSpan={2}>Оплата</THGroup>}
      {showVat && <th colSpan={2} className="border-b border-l border-neutral-200 px-3 pb-1 pt-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-600">НДС</th>}
    </tr>
  );
  const colsHead = (
    <>
      {GROUPS.map((g) => (
        <Fragment key={g.key}>
          {showQty && <TH sep label="Кол-во" unit={unit} {...cs.th(`${g.key}.qty`)} />}
          {showMoney && <TH sep={!showQty} label="Сумма" unit={UNIT.rub} {...cs.th(`${g.key}.val`)} />}
          <TH label="Ср. цена" unit={`₽/${priceUnit}`} {...cs.th(`${g.key}.avg`)} />
          {showHam && g.key === "recv" && <Th>Молоток, ₽/{priceUnit}<InfoHint label="Что такое молоток" align="right">Цена шкуры на аукционе до сборов, выделки, транспорта, брокера и комиссий (в режиме «С НДС / Без НДС» шапки). Берётся из расчёта лота; средневзвешенная считается только по лотам, у которых молоток в расчёте есть. Лот без молотка — «—».</InfoHint></Th>}
          {showUsd && <TH label="Ср. цена" unit={`$/${priceUnit}`} {...cs.th(`${g.key}.usd`)} after={<InfoHint label="Почему цена в $ не у всех" align="right">Цена в $ записана в расчёте не у всех лотов; закупки в рублях (КФХ, прочее) и подкладка без цены в $. Средневзвешенная $ считается только по лотам с ценой в $ (Σ $ × кол-во ÷ кол-во этих лотов); курс на сегодня не применяется.</InfoHint>} />}
        </Fragment>
      ))}
      {showPay && (
        <>
          <TH sep label="Оплачено" unit={UNIT.rub} />
          <TH label="Долг" unit={UNIT.rub} />
        </>
      )}
      {showVat && (
        <>
          <TH sep label="Ставка" />
          <TH label="НДС" unit={UNIT.rub} />
        </>
      )}
    </>
  );
  /** Колонки блока «НДС» по набору лотов: ставки лотов, НДС купленного (с НДС − без НДС), «НДС в ТЗ» у ткани. */
  const vatCells = (ls: FurLot[], o: { strong?: boolean; small?: boolean; tz?: ReactNode; single?: boolean } = {}) => {
    const byRate = new Map<number, number>();
    for (const l of ls) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + (l.recvIncl - l.recvExcl));
    const rates = [...byRate.keys()].sort((a, b) => a - b);
    const sum = [...byRate.values()].reduce((a, v) => a + v, 0);
    const detail = rates.map((r) => `${r} %: ${formatMoney(byRate.get(r) ?? 0)}`).join(" · ");
    const l0 = ls[0];
    return (
      <>
        <Num first strong={o.strong} small={o.small}>
          {rates.length ? rates.map((r) => `${r} %`).join(" · ") : <span className="text-neutral-500">–</span>}
          {o.single && l0 ? <div className="text-[11px] font-normal leading-tight text-neutral-500">{l0.year < 2026 ? "куплено до 2026" : "с 2026"}</div> : null}
        </Num>
        <Num strong={o.strong} small={o.small} title={detail ? `в т.ч. ${detail}` : undefined}>
          {R(sum)}
          {rates.length > 1 ? <div className="text-[11px] font-normal leading-tight text-neutral-500">{detail}</div> : null}
        </Num>
      </>
    );
  };
  /** Оплачено и долг по набору лотов (поля лота paid/due — те же, что питают плитки оплат). */
  const payCells = (ls: FurLot[], o: { strong?: boolean; small?: boolean } = {}) => {
    if (!showPay) return null;
    const paid = ls.reduce((a, l) => a + (l.paid ?? 0), 0);
    const due = ls.reduce((a, l) => a + (l.due ?? 0), 0);
    return (
      <>
        <Num first strong={o.strong} small={o.small}>{R(paid)}</Num>
        <Num strong={o.strong} small={o.small}><span className={due > 0.5 ? "text-amber-700" : undefined}>{R(due)}</span></Num>
      </>
    );
  };
  const cells = (f: FlowFigures, o: { strong?: boolean; altUsed?: boolean; small?: boolean; usedBar?: number; plan?: number | null; lot?: FurLot } = {}) => (
    <>
      {GROUPS.map((g) => (
        <Fragment key={g.key}>
          {showQty && (
            <Num first strong={o.strong} small={o.small}>
              {Q(g.qty(f))}
              {g.key === "used" && o.usedBar != null ? (
                <div className="mt-0.5 flex items-center justify-end gap-1" title={`Использовано ${formatPercent(o.usedBar)} от купленного`}>
                  <span role="img" aria-label={`Использовано ${formatPercent(o.usedBar)}`} className="h-1.5 w-full max-w-16 overflow-hidden rounded-full" style={{ background: "#e7e5e4" }}>
                    <span className="block h-full" style={{ width: `${o.usedBar}%`, background: "var(--ui-accent)" }} />
                  </span>
                  <span className="text-[11px] font-normal text-neutral-500">{formatPercent(o.usedBar)}</span>
                </div>
              ) : null}
            </Num>
          )}
          {showMoney && (
            g.key === "used" ? (
              <Num first={!showQty} strong={o.strong} small={o.small} title={c4 === "on" ? `без 4 %: ${formatMoney(f.usedValueOther)}` : undefined}>
                <div>{R(f.usedValue)}</div>
                
              </Num>
            ) : (
              <Num first={!showQty} strong={o.strong} small={o.small}>{R(g.val(f))}</Num>
            )
          )}
          <Num strong={o.strong} small={o.small}>{A(g.avg(f))}</Num>
          {showHam && g.key === "recv" && (
            <Num strong={o.strong} small={o.small}>
              {A(f.hammerAvg)}
              {o.lot ? (
                <InfoHint label="Источник молотка" align="right">{o.lot.hammerSource ? `Молоток: ${o.lot.hammerSource}.` : "Нет цены в $/молотка в расчёте лота."}</InfoHint>
              ) : f.hammerAvg != null && f.hammerQty > 0 && f.recvQty - f.hammerQty > 0.0005 ? (
                <div className="text-[11px] font-normal leading-tight text-neutral-500" title={`Цена в $ есть у ${f.hammerLots} из ${f.lots} лотов`}>{f.hammerLots} / {f.lots} лот.</div>
              ) : null}
            </Num>
          )}
          {showUsd && <Num strong={o.strong} small={o.small}>{U(g.key !== "used" && o.plan != null && g.usd(f) == null ? o.plan : g.usd(f))}{o.plan != null && g.usd(f) == null ? null : usdNote(g.key, f)}</Num>}
        </Fragment>
      ))}
    </>
  );
  // Охват цены в $: «по N из M» — когда $ есть не у всех шкур (метров) строки.
  const usdNote = (key: string, f: FlowFigures) => {
    const have = key === "recv" ? f.usdQty : key === "used" ? f.usdUsedQty : f.usdRemQty;
    const all = key === "recv" ? f.recvQty : key === "used" ? f.usedQty : f.remQty;
    if (all <= 0.0005) return null;
    const u = kind === "lining" ? "м" : "шт.";
    return <div className="text-[11px] font-normal leading-tight text-neutral-500" title={`Средняя цена в $ посчитана по ${formatQty(have)} из ${formatQty(all)} ${u}: у остальных в расчёте лота нет цены в $`}>по {formatQty(have)} из {formatQty(all)} {u}</div>;
  };
  const nCols = 1 + totalCols;
  // Ширины колонок рассчитаны под Inter (он шире Arial): сумма до 9 знаков + ₽ влезает без слипания с соседней колонкой.
  const widthClass = kind === "lining" ? "min-w-[1300px]" : "min-w-[1500px]";

  return { GROUPS, showUsd, showHam, colsOf, showVat, showPay, totalCols, priceUnit, groupHead, colsHead, vatCells, payCells, cells, nCols, widthClass };
}

export type TableCells = ReturnType<typeof makeTableCells>;
