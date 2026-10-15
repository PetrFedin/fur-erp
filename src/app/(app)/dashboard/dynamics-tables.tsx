"use client";

import { TotalLabel } from "@/components/total-label";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { isDebtDust } from "@/lib/raw-rounding";
import { alignRawTable, alignYears, cellsWith } from "@/lib/raw-display";
import { InfoHint } from "@/components/info-hint";
import { PinSection } from "@/components/pin-section";
import { useClientSort } from "@/lib/use-client-sort";
import { sortRows } from "@/lib/table-sort";
import { useFurScope } from "@/components/fur-scope";
import { VatTriplesHint } from "./vat-line";
import { shortMaterialName } from "@/lib/material-name";
import type { Cells, CellsPair, RawTableRow, VatTriple, YearRow } from "@/lib/dashboard-data";
import type { ModeInfo } from "./mode-line";

const rub = (v: number) => formatMoney(v.toFixed(2));
const rub0 = (v: number) => formatMoney(Math.round(v));

const th = "whitespace-nowrap px-1.5 py-1.5 text-right text-xs font-medium text-neutral-500";
const td = "whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums";
/** Вертикальная граница слева от блока колонок (Куплено | Использовано | Остаток | Оплачено) — одинаковая в обеих таблицах. */
const GB = " border-l border-neutral-100";

function Chevron({ open }: { open: boolean }) {
  return <span aria-hidden className={"inline-block w-4 text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}>›</span>;
}

/**
 * Общая раскладка обеих таблиц («по годам» и «по сырью»): table-fixed, первая колонка (стрелка + название с отступом уровня) —
 * узкая и закреплена при горизонтальной прокрутке, 8 числовых колонок (Куплено шт./₽, Использовано шт./₽, Остаток шт./₽, Оплачено, Задолженность)
 * — равной ширины, поэтому колонки и вертикальные линии обеих таблиц стоят на одних и тех же местах.
 */
const NAME_W = 170;
const TABLE_CLS = "w-full table-fixed text-sm min-w-[960px]";
function TableCols() {
  return (
    <colgroup>
      <col style={{ width: NAME_W }} />
      {Array.from({ length: 8 }, (_, i) => <col key={i} />)}
    </colgroup>
  );
}
const NAME_TH = "sticky left-0 z-[2] bg-white px-2 py-1.5 text-left text-xs font-medium text-neutral-500";

/** Первая ячейка строки: стрелка раскрытия (или пустое место той же ширины) и название; уровни — отступом. Длинное название переносится на вторую строку. */
function NameCell({ arrow, indent = 0, children, title, className = "" }: { arrow?: React.ReactNode; indent?: boolean | number; children: React.ReactNode; title?: string; className?: string }) {
  const pad = indent === true ? 20 : indent || 0;
  return (
    <td className={"sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left " + className} title={title}>
      <div className="flex min-w-0 items-center" style={{ paddingLeft: pad }}>
        <span className="inline-flex w-5 shrink-0 items-center">{arrow ?? null}</span>
        <span className="min-w-0 break-words leading-tight">{children}</span>
      </div>
    </td>
  );
}

// ───────────────────────────── Динамика по годам ─────────────────────────────

const sumCellsP = (list: Cells[]): Cells => {
  const t = list.reduce((a, c) => ({ rq: a.rq + c.rq, rv: a.rv + c.rv, uq: a.uq + c.uq, uv: a.uv + c.uv, mq: a.mq + c.mq, mv: a.mv + c.mv, uo: a.uo + c.uo }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0, uo: 0 });
  return { ...t, ra: null, ua: null, ma: null, uoa: null };
};

export function YearsTable({ rows: rowsAll, bySrc, c4, info }: { rows: YearRow[]; /** Мех по годам для источников «На аукционах» / «У поставщика». */ bySrc?: Record<"auction" | "supplier", { key: string; fur: CellsPair }[]>; c4: "on" | "off"; info: ModeInfo }) {
  void info;
  const scope = useFurScope();
  const sel = scope?.src ?? "all";
  // Источник меха: мех по годам берётся из выбранного источника, подкладка, оплаты и долг по источнику не делятся («—»).
  const rowsRaw = useMemo(() => {
    if (sel === "all" || !bySrc) return rowsAll;
    const per = new Map(bySrc[sel].map((x) => [x.key, x.fur]));
    const yr = rowsAll.filter((r) => r.key !== "all").map((r) => {
      const fur = per.get(r.key) ?? r.fur;
      const lin = r.money.lining;
      return { ...r, fur: r.key === "none" ? r.fur : fur, paid: lin.paid, debt: lin.debt, money: { fur: { paid: 0, debt: 0 }, lining: lin } };
    });
    const allRow = rowsAll.find((r) => r.key === "all")!;
    const tot: YearRow = { ...allRow, fur: { incl: sumCellsP(yr.map((r) => r.fur.incl)), excl: sumCellsP(yr.map((r) => r.fur.excl)) }, paid: yr.reduce((a, r) => a + r.paid, 0), debt: yr.reduce((a, r) => a + r.debt, 0), money: { fur: { paid: 0, debt: 0 }, lining: { paid: yr.reduce((a, r) => a + r.money.lining.paid, 0), debt: yr.reduce((a, r) => a + r.money.lining.debt, 0) } } };
    return [...yr.filter((r) => [r.fur.incl, r.lining.incl].some((c) => c.rq !== 0 || c.uq !== 0 || c.mq !== 0 || c.rv !== 0)), tot];
  }, [rowsAll, bySrc, sel]);
  const rows = useMemo(() => alignYears(rowsRaw), [rowsRaw]);
  const { mode: vat } = useVatDisplay();
  // По умолчанию видны три тотала (Мех, Подкладка, Всего); по клику на «›» строка раскрывается по годам.
  const [open, setOpen] = useState<Set<string>>(new Set(["all"])); // «Всего, ₽ мех+подкладка» по годам развёрнуто по умолчанию
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // Сортировка строк-годов по клику на заголовок (▲/▼) внутри каждого раскрытого блока (Мех, Подкладка, Всего); без выбора — по годам.
  const ycs = useClientSort<YearRow>({});
  const ys = (yrs0: YearRow[], pick: (r: YearRow) => Cells) => sortRows(yrs0, ycs.state, {
    name: (r) => r.label, rq: (r) => pick(r).rq, rv: (r) => pick(r).rv, uq: (r) => pick(r).uq, uv: (r) => pick(r).uv, mq: (r) => pick(r).mq, mv: (r) => pick(r).mv, paid: (r) => r.paid, debt: (r) => r.debt,
  });
  const sum = (a: Cells, b: Cells): Cells => ({ rq: a.rq + b.rq, rv: a.rv + b.rv, ra: null, uq: a.uq + b.uq, uv: a.uv + b.uv, ua: null, mq: a.mq + b.mq, mv: a.mv + b.mv, ma: null, uo: a.uo + b.uo, uoa: null });

  return (
    <PinSection id="years-table" title="Динамика по годам" value={Array.from(open)} onRestore={(v) => setOpen(new Set(v))}
      headerExtra={<>
        {sel !== "all" ? <span className="text-[11px] text-neutral-500" data-testid="years-src-note">подкладка, оплаты и долг по источнику не делятся</span> : null}
          <InfoHint label="Как читать динамику по годам" wide>
            <p><b>Год</b> — год закупки лота. В каждой строке куплено − использовано = остаток. «Использовано» — всегда без 4%, и сырьё могло уйти в ТЗ позже: мех, купленный в 2025, мог быть списан в 2026.</p>
            <p className="mt-1">«Мех», «Подкладка» и «Всего, ₽» — итоги за все годы; «›» раскрывает годы. Штуки — только мех, подкладка в метрах; в «Всего» суммируются только рубли.</p>
            <p className="mt-1"><b>Оплачено</b> и <b>задолженность</b> — поставщику, по закупкам года, всегда с НДС и без 4%; в раскрытой строке отдельно мех и подкладка.</p>
            <p className="mt-1">Год шапки таблицу не меняет, фильтры панели — меняют. Бобр подрядчика (без лотов закупки) смотрите в «Производство» и «Изделия».</p>
          </InfoHint>
      </>}>
      <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className={TABLE_CLS}>
          <TableCols />
          <thead>
            <tr className="border-b border-neutral-200">
              <TH rowSpan={2} align="left" className="sticky left-0 z-[2] bg-white px-2" label="Сырьё / год" {...ycs.th("name")} />
              <THGroup colSpan={2}>Куплено</THGroup>
              <THGroup colSpan={2}>Использовано</THGroup>
              <THGroup colSpan={2}>Остаток</THGroup>
              <TH rowSpan={2} sep label="Оплачено" unit={UNIT.rub} {...ycs.th("paid")} />
              <TH rowSpan={2} label="Задолженность" unit={UNIT.rub} {...ycs.th("debt")} />
            </tr>
            <tr className="border-b border-neutral-200">
              {[0, 1, 2].flatMap((g) => [<TH key={`q${g}`} sep label="Кол-во" unit="шт. · м" {...ycs.th(["rq", "uq", "mq"][g])} />, <TH key={`v${g}`} label="Сумма" unit={UNIT.rub} {...ycs.th(["rv", "uv", "mv"][g])} />])}
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Три тотала (Мех, Подкладка, Всего) — каждый раскрывается по годам. Цифры те же, что раньше, только перегруппированы.
              const all = rows.find((r) => r.key === "all");
              const yrs = rows.filter((r) => r.key !== "all");
              if (!all) return null;
              const yearInfo = (r: YearRow) => r.key === "none" ? <InfoHint label="Что такое «Без даты»" className="ml-1"><p>ТЗ без даты и без года партии: в базе нет ни даты ТЗ, ни даты начала/выпуска, ни года партии. Их выпуск не отнесён ни к одному году.</p></InfoHint> : null;
              const kinds: { k: string; label: string; unit: string; pick: (r: YearRow) => Cells; money: (r: YearRow) => { paid: number; debt: number } }[] = [
                { k: "fur", label: "Мех", unit: "шт.", pick: (r) => r.fur[vat], money: (r) => r.money.fur },
                { k: "lining", label: "Подкладка", unit: "м", pick: (r) => r.lining[vat], money: (r) => r.money.lining },
              ];
              return (
                <>
                  {kinds.map((kd) => {
                    const c = kd.pick(all), m = kd.money(all), isOpen = open.has(kd.k);
                    return (
                      <Fragment key={kd.k}>
                        <tr data-block={kd.k} className="border-b border-neutral-100 bg-white">
                          <NameCell className="font-semibold" arrow={<button type="button" onClick={() => toggle(kd.k)} aria-expanded={isOpen} aria-label={`Раскрыть по годам: ${kd.label}`}><Chevron open={isOpen} /></button>}>{shortMaterialName(kd.label)}</NameCell>
                          <CellsTds c={c} unit={kd.unit} avg={false} />
                          <MoneyTds paid={m.paid} due={m.debt} note={kd.k === "lining" ? LINING_NOTE : undefined} />
                        </tr>
                        {isOpen ? ys(yrs, kd.pick).map((r) => {
                          const y = kd.pick(r), ym = kd.money(r);
                          return (
                            <tr key={kd.k + r.key} data-block={kd.k} className="border-b border-neutral-100 bg-neutral-50 text-[13px] text-neutral-700">
                              <NameCell indent title={r.label}>{shortMaterialName(r.label)}{yearInfo(r)}</NameCell>
                              <CellsTds c={y} unit={kd.unit} avg={false} />
                              <MoneyTds paid={ym.paid} due={ym.debt} />
                            </tr>
                          );
                        }) : null}
                      </Fragment>
                    );
                  })}
                  {(() => {
                    const t = sum(all.fur[vat], all.lining[vat]), isOpen = open.has("all");
                    return (
                      <Fragment>
                        <tr className="row-total">
                          <NameCell className="font-semibold" arrow={<button type="button" onClick={() => toggle("all")} aria-expanded={isOpen} aria-label="Раскрыть по годам: Всего, ₽ мех+подкладка"><Chevron open={isOpen} /></button>}>Всего, ₽ <span className="block text-xs font-normal opacity-80">мех+подкладка</span></NameCell>
                          <td className={td + GB}>—</td><td className={td}>{rub(t.rv)}</td>
                          <td className={td + GB}>—</td><td className={td}>{rub(t.uv)}</td>
                          <td className={td + GB}>—</td><td className={td}>{rub(t.mv)}</td>
                          <td className={td + " border-l border-neutral-300"}>{rub0(all.paid)}</td>
                          <td className={td + (all.debt > 0 ? " text-amber-700" : "")}>{rub0(all.debt)}</td>
                        </tr>
                        {isOpen ? ys(yrs, (r) => sum(r.fur[vat], r.lining[vat])).map((r) => {
                          const y = sum(r.fur[vat], r.lining[vat]);
                          const yk = "all:" + r.key, yOpen = open.has(yk);
                          return (
                            <Fragment key={"all" + r.key}>
                              <tr className="border-b border-neutral-100 bg-neutral-50 text-[13px] text-neutral-700">
                                <NameCell indent={8} title={r.label} arrow={<button type="button" onClick={() => toggle(yk)} aria-expanded={yOpen} aria-label={`Раскрыть на мех и подкладку: ${r.label}`} className="inline-flex h-6 w-5 items-center justify-center"><Chevron open={yOpen} /></button>}>{shortMaterialName(r.label)}{yearInfo(r)}</NameCell>
                                <td className={td + GB}>—</td><td className={td}>{rub(y.rv)}</td>
                                <td className={td + GB}>—</td><td className={td}>{rub(y.uv)}</td>
                                <td className={td + GB}>—</td><td className={td}>{rub(y.mv)}</td>
                                <MoneyTds paid={r.paid} due={r.debt} />
                              </tr>
                              {yOpen ? kinds.map((kd) => {
                                const c = kd.pick(r), m = kd.money(r);
                                return (
                                  <tr key={"all" + r.key + kd.k} className="border-b border-neutral-100 bg-white text-[12px] text-neutral-600">
                                    <NameCell indent={36}>{kd.label}</NameCell>
                                    <td className={td + GB}>—</td><td className={td}>{rub(c.rv)}</td>
                                    <td className={td + GB}>—</td><td className={td}>{rub(c.uv)}</td>
                                    <td className={td + GB}>—</td><td className={td}>{rub(c.mv)}</td>
                                    <MoneyTds paid={m.paid} due={m.debt} />
                                  </tr>
                                );
                              }) : null}
                            </Fragment>
                          );
                        }) : null}
                      </Fragment>
                    );
                  })()}
                </>
              );
            })()}
          </tbody>
        </table>
      </div>
    </PinSection>
  );
}

// ───────────────────────────── Динамика по сырью ─────────────────────────────

function CellsTds({ c, unit, bold, avg }: { c: Cells; unit: string; bold?: boolean; avg: boolean }) {
  const cls = td + (bold ? " font-semibold" : "");
  return (
    <>
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.rq)} {unit}</td><td className={cls}>{rub(c.rv)}</td>{avg ? <td className={cls + " text-neutral-600"}>{c.ra != null ? rub(c.ra) : "—"}</td> : null}
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.uq)} {unit}</td><td className={cls}>{rub(c.uv)}</td>{avg ? <td className={cls + " text-neutral-600"}>{c.ua != null ? rub(c.ua) : "—"}</td> : null}
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.mq)} {unit}</td><td className={cls}>{rub(c.mv)}</td>{avg ? <td className={cls + " text-neutral-600"}>{c.ma != null ? rub(c.ma) : "—"}</td> : null}
    </>
  );
}

const LINING_NOTE = "Расхождение со счётом №100 (Ж2): подкладка Спец. 7 — сумма закупок на 1 357,06 ₽ больше УПД №109 и оплаты 1 455 842 ₽.";
function MoneyTds({ paid, due, bold, note }: { paid: number; due: number; bold?: boolean; note?: string }) {
  const cls = td + (bold ? " font-semibold" : "");
  return (
    <>
      <td className={cls + " border-l border-neutral-100"}>{Math.abs(paid) < 0.5 ? <span className="text-neutral-300">—</span> : rub0(paid)}</td>
      <td className={cls + (due > 0.5 && !isDebtDust(due) ? " text-amber-700" : "")}>{Math.abs(due) < 0.5 ? <span className="text-neutral-300">—</span> : isDebtDust(due) ? <span className="text-neutral-300" title={`округление (${rub(due)})`}>—</span> : <span title={note && Math.abs(due - 1357.06) < 0.5 ? note : undefined} className={note && Math.abs(due - 1357.06) < 0.5 ? "cursor-help underline decoration-dotted" : undefined}>{rub0(due)}</span>}</td>
    </>
  );
}

/** Ключ строки аукциона — настоящее название партии закупки; служебные строки (без аукциона, шкуры подрядчика, не полученное) не ссылки. */
const auctionLinkable = (key: string) => !key.startsWith("__") && key !== "hides" && !key.startsWith("unrecv|");
/** Ссылка служебной строки на существующую страницу: «Без аукциона» — закупки с фильтром «Без аукциона»; «не получен» — список закупок. «Шкуры подрядчика» — страница /lots/contractor-hides. Год берётся из шапки. */
const serviceHref = (key: string): string | null => (key === "__none" ? "/purchases?auction=none" : key.startsWith("unrecv|") ? "/purchases" : key === "hides" ? "/lots/contractor-hides" : null);

const addCells = (list: Cells[]): Cells => {
  const s = list.reduce((a, c) => ({ rq: a.rq + c.rq, rv: a.rv + c.rv, uq: a.uq + c.uq, uv: a.uv + c.uv, mq: a.mq + c.mq, mv: a.mv + c.mv, uo: a.uo + c.uo }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0, uo: 0 });
  const r = (v: number, q: number) => (q > 0 ? v / q : null);
  return { ...s, ra: r(s.rv, s.rq), ua: r(s.uv, s.uq), ma: r(s.mv, s.mq), uoa: r(s.uo, s.uq) };
};

export function RawTable({ auctionSrc, rows: rowsAll, total, money, c4, info: _info, orderFilters, vatRates }: { /** Источник строки аукциона (для переключателя «На аукционах / У поставщика»). */ auctionSrc?: Record<string, "auction" | "supplier">; vatRates?: { fur: VatTriple; lining: VatTriple }; rows: RawTableRow[]; total: CellsPair; money: { paid: number; due: number; unreceived: { paid: number; due: number; names: string[]; byFur: { label: string; names: string[]; paid: number; due: number }[] } }; c4: "on" | "off"; info: ModeInfo; orderFilters: boolean}) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const avg = false; // колонки цен убраны: цены — в окне по клику на «Цена» в блоке «Сырьё»
  const scope = useFurScope();
  const sel = scope?.src ?? "all";
  // Источник меха: строки видов собираются из своих строк аукционов нужного источника (подкладка не делится по источнику).
  const rows = useMemo(() => {
    if (sel === "all" || !auctionSrc) return rowsAll;
    const srcOf = (k: string) => (k.startsWith("unrecv|") ? "auction" : auctionSrc[k] ?? "supplier");
    return rowsAll.flatMap((r) => {
      if (r.kind !== "fur") return [r];
      const as = r.auctions.filter((a) => srcOf(a.key) === sel);
      if (as.length === 0) return [];
      return [{ ...r, auctions: as, cells: { incl: addCells(as.map((a) => a.cells.incl)), excl: addCells(as.map((a) => a.cells.excl)) }, paid: as.reduce((x, a) => x + a.paid, 0), due: as.reduce((x, a) => x + a.due, 0) }];
    });
  }, [rowsAll, auctionSrc, sel]);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // Сортировка по клику на заголовок (▲/▼): виды меха и ткани внутри своих блоков; без выбора — порядок по умолчанию.
  const cs = useClientSort<RawTableRow>({
    name: (r) => r.label, rq: (r) => r.cells[vat].rq, rv: (r) => r.cells[vat].rv, uq: (r) => r.cells[vat].uq, uv: (r) => r.cells[vat].uv, mq: (r) => r.cells[vat].mq, mv: (r) => r.cells[vat].mv, paid: (r) => r.paid, due: (r) => r.due,
  });
  const { furEx, linEx, furSubEx, linSubEx, TEx, AL } = useMemo(() => alignRawTable({ rows, vat, sel, money, total }), [rows, vat, sel, money, total]);
  const alRow = (r: RawTableRow): RawTableRow => {
    const c = AL.byKey.get(r.key);
    if (!c) return r;
    return {
      ...r, paid: c.p, due: c.d, cells: { ...r.cells, [vat]: cellsWith(r.cells[vat], c) },
      auctions: r.auctions.map((a) => { const x = AL.byAuc.get(r.key + "|" + a.key); return x ? { ...a, paid: x.p, due: x.d, cells: { ...a.cells, [vat]: cellsWith(a.cells[vat], x) } } : a; }),
    };
  };
  const fur = cs.sort(furEx).map(alRow);
  const lin = cs.sort(linEx).map(alRow);
  const furSub = cellsWith(furSubEx, AL.fur);
  const linSub = cellsWith(linSubEx, AL.lin);
  const T = cellsWith(TEx, AL.total);
  const tPaid = AL.total.p;
  const tDue = AL.total.d;

  const kindHead = (kindLabel: string, block: string) => (
    <tr data-hover-block={block} data-block={block} className="bg-neutral-100/70 text-xs font-semibold uppercase tracking-wide text-neutral-600"><td colSpan={9} className="px-2 py-1">{kindLabel}</td></tr>
  );
  const arrow = (k: string, label: string) => (
    <button type="button" onClick={() => toggle(k)} aria-expanded={open.has(k)} aria-label={`Раскрыть: ${label}`}><Chevron open={open.has(k)} /></button>
  );
  const itemRows = (list: RawTableRow[], unit: string) =>
    list.map((r) => {
      // У ткани подкладки следующего уровня (аукционов) нет: название — ссылка на карточку лота / список лотов этой ткани.
      const flat = r.kind === "lining" && !!r.lotIds && r.lotIds.length > 0;
      const isOpen = !flat && open.has(r.key);
      return (
        <Fragment key={r.key}>
          <tr data-block={r.kind} className="border-b border-neutral-100 bg-white hover:bg-neutral-50">
            <NameCell arrow={flat ? undefined : arrow(r.key, r.label)} title={r.label}>
              {r.kind === "lining" && r.lotIds && r.lotIds.length > 0 ? (
                <Link href={r.lotIds.length === 1 ? `/analytics/raw/lot/${r.lotIds[0]}` : `/lots?tab=lining&lmat=${encodeURIComponent(r.label)}`} className="font-medium hover:underline focus-visible:underline" title={r.lotIds.length === 1 ? "Открыть карточку лота: закупка, остаток, списания по ТЗ" : `Открыть лоты подкладки «${r.label}» (${r.lotIds.length})`}>
                  {shortMaterialName(r.label)}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span>
                </Link>
              ) : r.kind === "fur" && (r.lots > 0 || r.cells.incl.rq > 0) ? (
                <Link href={`/lots/fur/${encodeURIComponent(r.label)}`} className="font-medium hover:underline focus-visible:underline" title={`Страница вида меха «${r.label}»: аукционы, лоты, ТЗ`}>
                  {shortMaterialName(r.label)}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span>
                </Link>
              ) : <span className="font-medium">{shortMaterialName(r.label)}</span>}
            </NameCell>
            <CellsTds c={r.cells[vat]} unit={unit} avg={avg} />
            <MoneyTds paid={r.paid} due={r.due} />
          </tr>
          {isOpen ? r.auctions.map((a) => (
            <tr key={r.key + a.key} data-block={r.kind} className="border-b border-neutral-100 bg-neutral-50 text-[13px] text-neutral-700">
              <NameCell indent title={a.label}>
                {auctionLinkable(a.key) ? (
                  <Link href={r.kind === "lining" ? `/lots/lining/${encodeURIComponent(a.key)}` : `/lots?auction=${encodeURIComponent(a.key)}`} className="hover:underline focus-visible:underline" title={r.kind === "lining" ? "Открыть партию подкладки" : "Открыть аукцион: счета, лоты и себестоимость"}>
                    {a.label}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span>
                  </Link>
                ) : serviceHref(a.key) ? (
                  <Link href={serviceHref(a.key)!} className="hover:underline focus-visible:underline" title="Открыть закупки: что куплено, оплачено и чего нет">
                    {a.label}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">→</span>
                  </Link>
                ) : a.label}
              </NameCell>
              <CellsTds c={a.cells[vat]} unit={unit} avg={avg} />
              <MoneyTds paid={a.paid} due={a.due} />
            </tr>
          )) : null}
        </Fragment>
      );
    });

  const furBlock = (
    <>
      {kindHead("Мех", "fur")}
      {itemRows(fur, "шт.")}
      {fur.length > 1 ? (
        <tr className="row-total"><NameCell><TotalLabel note="мех" avg={avg} /></NameCell><CellsTds c={furSub} unit="шт." bold avg={avg} /><MoneyTds paid={AL.fur.p} due={AL.fur.d} bold /></tr>
      ) : null}
    </>
  );
  // Подкладка по умолчанию свёрнута до одной итоговой строки; по клику — ткани.
  const LIN = "__lining";
  const linPaid = AL.lin.p, linDue = AL.lin.d;
  const linBlock = (
    <>
      {kindHead("Подкладка", "lining")}
      <tr data-block="lining" className="border-b border-neutral-100 bg-white hover:bg-neutral-50">
        <NameCell arrow={lin.length > 0 ? arrow(LIN, "подкладка") : null}><span className="font-medium">Подкладка</span></NameCell>
        <CellsTds c={linSub} unit="м" avg={avg} />
        <MoneyTds paid={linPaid} due={linDue} note={LINING_NOTE} />
      </tr>
      {open.has(LIN) ? itemRows(lin, "м") : null}
      {open.has(LIN) && lin.length > 1 ? (
        <tr className="row-total"><NameCell><TotalLabel note="подкладка" avg={avg} /></NameCell><CellsTds c={linSub} unit="м" bold avg={avg} /><MoneyTds paid={linPaid} due={linDue} bold note={LINING_NOTE} /></tr>
      ) : null}
    </>
  );

  return (
    <PinSection id="raw-table" title="Динамика по сырью" value={Array.from(open)} onRestore={(v) => setOpen(new Set(v))}
      headerExtra={<>
            {sel !== "all" ? <span className="text-[11px] text-neutral-500">подкладка по источнику не делится</span> : null}
          <InfoHint label="Как читать таблицу по сырью" wide>
            <p>Строка — вид меха или ткань подкладки. Нажмите на вид — разбивка по аукционам.</p>
            <p className="mt-1"><b>Ср. цена</b> — средневзвешенная: Σ ₽ ÷ Σ шт. (подкладка — ÷ Σ м). Все колонки без 4%, поэтому куплено = использовано + остаток.{orderFilters ? " Фильтр по ТЗ сужает только «Использовано»: тогда куплено − использовано ≠ остаток." : ""}</p>
            <p className="mt-1">Год шапки и фильтры панели действуют. В «Всего» мех и подкладка складываются только в рублях.</p>
            <p className="mt-1"><b>Бобр</b> — сырьё подрядчика без лотов закупки: смотрите в «Производство» и «Изделия».</p>
            {vatRates ? <VatTriplesHint fur={vatRates.fur} lining={vatRates.lining} /> : null}
          </InfoHint>
      </>}>
      <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className={TABLE_CLS}>
          <TableCols />
          <thead>
            <tr className="border-b border-neutral-200">
              <TH rowSpan={2} align="left" className="sticky left-0 z-[2] bg-white px-2" label="Вид" {...cs.th("name")} />
              <THGroup colSpan={avg ? 3 : 2}>Куплено</THGroup>
              <THGroup colSpan={avg ? 3 : 2}>Использовано</THGroup>
              <THGroup colSpan={avg ? 3 : 2}>Остаток</THGroup>
              <TH rowSpan={2} sep label="Оплачено" unit={UNIT.rub} {...cs.th("paid")} />
              <TH rowSpan={2} label="Задолженность" unit={UNIT.rub} {...cs.th("due")} />
            </tr>
            <tr className="border-b border-neutral-200">
              {[0, 1, 2].flatMap((g) => [<TH key={`q${g}`} sep label="Кол-во" unit="шт. · м" {...cs.th(["rq", "uq", "mq"][g])} />, <TH key={`v${g}`} label="Сумма" unit={UNIT.rub} {...cs.th(["rv", "uv", "mv"][g])} />, ...(avg ? [<TH key={`a${g}`} label="Ср. цена" unit="₽/шт. · ₽/м" />] : [])])}
            </tr>
          </thead>
          <tbody>
            {fur.length > 0 ? furBlock : null}
            {lin.length > 0 ? linBlock : null}
            {(() => {
              // Деньги по закупкам без лотов (мех ещё не получен) — отдельной строкой; остальное расхождение («Всего» − виды) — прочее.
              if (rows.length === 0 || sel !== "all") return null;
              const u = money.unreceived;
              const ex = AL.extras; // [по видам не полученного меха…, прочие закупки без лотов, прочее] — целые рубли
              const nB = u.byFur.length;
              const otherPaid = ex[nB]?.p ?? 0, otherDue = ex[nB]?.d ?? 0, restPaid = ex[nB + 1]?.p ?? 0, restDue = ex[nB + 1]?.d ?? 0;
              const show = (x: number, y: number) => Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5;
              return (
                <>
                  {u.byFur.map((g, gi) => (
                    <tr key={g.label} className="border-b border-neutral-100 text-[13px] text-neutral-700">
                      <td className="px-2 py-1.5 text-left" colSpan={7}>{g.label} — ещё не получен ({g.names.join(", ")})</td>
                      <MoneyTds paid={ex[gi]?.p ?? g.paid} due={ex[gi]?.d ?? g.due} />
                    </tr>
                  ))}
                  {show(otherPaid, otherDue) ? (
                    <tr className="border-b border-neutral-100 bg-white text-[13px] text-neutral-700">
                      <td className="px-2 py-1.5 text-left" colSpan={7}>Мех ещё не получен: прочие закупки без лотов</td>
                      <MoneyTds paid={otherPaid} due={otherDue} />
                    </tr>
                  ) : null}
                  {show(restPaid, restDue) ? (
                    <tr className="border-b border-neutral-100 bg-white text-[13px] text-neutral-700">
                      <td className="px-2 py-1.5 text-left" colSpan={7}>Прочее: мех без аукциона, шкуры подрядчика, зачёты и поправки</td>
                      <MoneyTds paid={restPaid} due={restDue} />
                    </tr>
                  ) : null}
                </>
              );
            })()}
            {rows.length === 0 ? <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-neutral-500">По выбранным фильтрам лотов нет.</td></tr> : null}
            {rows.length > 0 ? (
              <tr className="row-total">
                <NameCell><TotalLabel note="мех+подкладка" /></NameCell>
                <td className={td}>—</td><td className={td}>{rub(T.rv)}</td>{avg ? <td className={td}>—</td> : null}
                <td className={td}>—</td><td className={td}>{rub(T.uv)}</td>{avg ? <td className={td}>—</td> : null}
                <td className={td}>—</td><td className={td}>{rub(T.mv)}</td>{avg ? <td className={td}>—</td> : null}
                <td className={td + " border-l border-neutral-300"}>{rub0(tPaid)}</td><td className={td}>{rub0(tDue)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </PinSection>
  );
}
