"use client";

import { TotalLabel } from "@/components/total-label";
import { Fragment, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
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

export function YearsTable({ rows, c4, info }: { rows: YearRow[]; c4: "on" | "off"; info: ModeInfo }) {
  void info;
  const { mode: vat } = useVatDisplay();
  // По умолчанию видны три тотала (Мех, Подкладка, Всего); по клику на «›» строка раскрывается по годам.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const sum = (a: Cells, b: Cells): Cells => ({ rq: a.rq + b.rq, rv: a.rv + b.rv, ra: null, uq: a.uq + b.uq, uv: a.uv + b.uv, ua: null, mq: a.mq + b.mq, mv: a.mv + b.mv, ma: null, uo: a.uo + b.uo, uoa: null });

  return (
    <section aria-labelledby="dash-years" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
        <h2 id="dash-years" className="text-base font-semibold">Динамика по годам</h2>
          <InfoHint label="Как читать динамику по годам" wide>
            <p><b>Закуплено / использовано / остаток</b> — по году закупки лота: в каждой строке закуплено − использовано = остаток. Использовано — всегда без 4% (надбавка 4% показана в виджетах «Сырьё» и «Себестоимость»).</p>
            <p className="mt-1">Строки «Мех», «Подкладка» и «Всего, ₽» — итоги за все годы; нажмите «›», чтобы увидеть разбивку по годам. Штуки — только мех, подкладка в метрах; в «Всего» количества не суммируются, суммируются рубли.</p>
                        <p className="mt-1"><b>Оплачено</b> и <b>задолженность</b> (поставщику) — по закупкам этого года, как в «Оплатах»; в раскрытой строке — отдельно по меху и подкладке. Фильтры панели действуют и на эти колонки.</p>
            <p className="mt-1"><b>Всего, ₽</b> — сумма строк по каждой колонке (задолженность: года 1 + года 2 = общая). Год шапки таблицу не меняет; фильтры панели действуют на сырьё и производство.</p>
            <p className="mt-1"><b>Использовано</b> — всегда без 4%, поэтому куплено = использовано + остаток. Оплачено и задолженность — всегда с НДС, не зависят от 4%.</p>
            <p className="mt-1">Использовано — сырьё лотов, купленных в этом году (где бы ни было списано): мех, купленный в 2025, мог уйти в ТЗ 2026.</p>
            <p className="mt-1">Бобр — сырьё подрядчика, лотов закупки нет; изделия из бобра смотрите в «Производство» и «Изделия».</p>
          </InfoHint>
        </div>
      </div>
      <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className={TABLE_CLS}>
          <TableCols />
          <thead>
            <tr className="border-b border-neutral-200">
              <th rowSpan={2} className={NAME_TH}>Сырьё / год</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Куплено</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Использовано</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Остаток</th>
              <th rowSpan={2} className={th + " border-l border-neutral-100"}>Оплачено</th>
              <th rowSpan={2} className={th}>Задолженность</th>
            </tr>
            <tr className="border-b border-neutral-200">
              {["шт.", "₽", "шт.", "₽", "шт.", "₽"].map((h, i) => <th key={i} className={th + (i % 2 === 0 ? " border-l border-neutral-100" : "")}>{h}</th>)}
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
                          <MoneyTds paid={m.paid} due={m.debt} />
                        </tr>
                        {isOpen ? yrs.map((r) => {
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
                        {isOpen ? yrs.map((r) => {
                          const y = sum(r.fur[vat], r.lining[vat]);
                          return (
                            <tr key={"all" + r.key} className="border-b border-neutral-100 bg-neutral-50 text-[13px] text-neutral-700">
                              <NameCell indent title={r.label}>{shortMaterialName(r.label)}{yearInfo(r)}</NameCell>
                              <td className={td + GB}>—</td><td className={td}>{rub(y.rv)}</td>
                              <td className={td + GB}>—</td><td className={td}>{rub(y.uv)}</td>
                              <td className={td + GB}>—</td><td className={td}>{rub(y.mv)}</td>
                              <MoneyTds paid={r.paid} due={r.debt} />
                            </tr>
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
    </section>
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

function MoneyTds({ paid, due, bold }: { paid: number; due: number; bold?: boolean }) {
  const cls = td + (bold ? " font-semibold" : "");
  return (
    <>
      <td className={cls + " border-l border-neutral-100"}>{Math.abs(paid) < 0.5 ? <span className="text-neutral-300">—</span> : rub0(paid)}</td>
      <td className={cls + (due > 0.5 ? " text-amber-700" : "")}>{Math.abs(due) < 0.5 ? <span className="text-neutral-300">—</span> : rub0(due)}</td>
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

export function RawTable({ rows, total, money, c4, info: _info, orderFilters, vatRates }: { vatRates?: { fur: VatTriple; lining: VatTriple }; rows: RawTableRow[]; total: CellsPair; money: { paid: number; due: number; unreceived: { paid: number; due: number; names: string[]; byFur: { label: string; names: string[]; paid: number; due: number }[] } }; c4: "on" | "off"; info: ModeInfo; orderFilters: boolean}) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const avg = false; // колонки цен убраны: цены — в окне по клику на «Цена» в блоке «Сырьё»
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const fur = rows.filter((r) => r.kind === "fur");
  const lin = rows.filter((r) => r.kind === "lining");
  const furSub = addCells(fur.map((r) => r.cells[vat]));
  const linSub = addCells(lin.map((r) => r.cells[vat]));
  const T = total[vat];

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
        <tr className="row-total"><NameCell><TotalLabel note="мех" avg={avg} /></NameCell><CellsTds c={furSub} unit="шт." bold avg={avg} /><MoneyTds paid={fur.reduce((a, r) => a + r.paid, 0)} due={fur.reduce((a, r) => a + r.due, 0)} bold /></tr>
      ) : null}
    </>
  );
  // Подкладка по умолчанию свёрнута до одной итоговой строки; по клику — ткани.
  const LIN = "__lining";
  const linBlock = (
    <>
      {kindHead("Подкладка", "lining")}
      <tr data-block="lining" className="border-b border-neutral-200 bg-neutral-50">
        <NameCell arrow={lin.length > 0 ? arrow(LIN, "подкладка") : null}>Подкладка</NameCell>
        <CellsTds c={linSub} unit="м" avg={avg} />
        <MoneyTds paid={lin.reduce((a, r) => a + r.paid, 0)} due={lin.reduce((a, r) => a + r.due, 0)} />
      </tr>
      {open.has(LIN) ? itemRows(lin, "м") : null}
    </>
  );

  return (
    <section aria-labelledby="dash-raw-table" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
        <h2 id="dash-raw-table" className="text-base font-semibold">Динамика по сырью</h2>
          <InfoHint label="Как читать таблицу по сырью" wide>
            <p>Строка — вид меха или ткань подкладки («Лиса красная» — вид «Лиса», красная — цвет). Нажмите на вид — разбивка по аукционам.</p>
            <p className="mt-1"><b>Средневзвешенная цена</b> = Σ ₽ ÷ Σ шт. (подкладка — ÷ Σ м). Использовано, куплено и остаток — без 4%.</p>
            <p className="mt-1">Год шапки и фильтры панели действуют. «Всего» складывает мех и подкладку только в рублях.</p>
            <p className="mt-1"><b>Куплено = использовано + остаток</b> по штукам и рублям, все колонки — без 4%.{orderFilters ? " Фильтр по ТЗ сужает только «Использовано»: тогда куплено − использовано ≠ остаток." : ""}</p>
            <p className="mt-1"><b>Бобр</b> — сырьё подрядчика, лотов закупки нет; изделия из бобра смотрите в «Производство» и «Изделия». Поэтому в этой таблице по лотам его нет.</p>
            {vatRates ? <VatTriplesHint fur={vatRates.fur} lining={vatRates.lining} /> : null}
          </InfoHint>
        </div>
      </div>
      <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className={TABLE_CLS}>
          <TableCols />
          <thead>
            <tr className="border-b border-neutral-200">
              <th rowSpan={2} className={NAME_TH}>Вид</th>
              <th colSpan={avg ? 3 : 2} className={th + " border-l border-neutral-100 text-center"}>Куплено</th>
              <th colSpan={avg ? 3 : 2} className={th + " border-l border-neutral-100 text-center"}>Использовано</th>
              <th colSpan={avg ? 3 : 2} className={th + " border-l border-neutral-100 text-center"}>Остаток</th>
              <th rowSpan={2} className={th + " border-l border-neutral-100"}>Оплачено</th>
              <th rowSpan={2} className={th}>Задолженность</th>
            </tr>
            <tr className="border-b border-neutral-200">
              {[0, 1, 2].flatMap((g) => (avg ? ["шт.", "₽", "цена ₽/шт."] : ["шт.", "₽"]).map((h, i) => <th key={g + h} className={th + (i === 0 ? " border-l border-neutral-100" : "")}>{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {fur.length > 0 ? furBlock : null}
            {lin.length > 0 ? linBlock : null}
            {(() => {
              // Деньги по закупкам без лотов (мех ещё не получен) — отдельной строкой; остальное расхождение («Всего» − виды) — прочее.
              if (rows.length === 0) return null;
              const u = money.unreceived;
              const restPaid = money.paid - rows.reduce((a, r) => a + r.paid, 0) - u.paid;
              const restDue = money.due - rows.reduce((a, r) => a + r.due, 0) - u.due;
              const show = (x: number, y: number) => Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5;
              return (
                <>
                  {u.byFur.map((g) => (
                    <tr key={g.label} className="border-b border-neutral-100 text-[13px] text-neutral-700">
                      <td className="px-2 py-1.5 text-left" colSpan={7}>{g.label} — ещё не получен ({g.names.join(", ")})</td>
                      <MoneyTds paid={g.paid} due={g.due} />
                    </tr>
                  ))}
                  {show(u.paid - u.byFur.reduce((a, g) => a + g.paid, 0), u.due - u.byFur.reduce((a, g) => a + g.due, 0)) ? (
                    <tr className="border-b border-neutral-100 bg-white text-[13px] text-neutral-700">
                      <td className="px-2 py-1.5 text-left" colSpan={7}>Мех ещё не получен: прочие закупки без лотов</td>
                      <MoneyTds paid={u.paid - u.byFur.reduce((a, g) => a + g.paid, 0)} due={u.due - u.byFur.reduce((a, g) => a + g.due, 0)} />
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
                <NameCell><TotalLabel /></NameCell>
                <td className={td}>—</td><td className={td}>{rub(T.rv)}</td>{avg ? <td className={td}>—</td> : null}
                <td className={td}>—</td><td className={td}>{rub(T.uv)}</td>{avg ? <td className={td}>—</td> : null}
                <td className={td}>—</td><td className={td}>{rub(T.mv)}</td>{avg ? <td className={td}>—</td> : null}
                <td className={td + " border-l border-neutral-300"}>{rub0(money.paid)}</td><td className={td}>{rub0(money.due)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
