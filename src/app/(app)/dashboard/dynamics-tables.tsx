"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { Cells, CellsPair, RawTableRow, YearRow } from "@/lib/dashboard-data";
import { ModeLine, Note, type ModeInfo } from "./mode-line";

const rub = (v: number) => formatMoney(v.toFixed(2));
const rub0 = (v: number) => formatMoney(Math.round(v));

const th = "whitespace-nowrap px-2 py-1.5 text-right text-xs font-medium text-neutral-500";
const td = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";

function Chevron({ open }: { open: boolean }) {
  return <span aria-hidden className={"inline-block w-4 text-neutral-400 transition-transform " + (open ? "rotate-90" : "")}>›</span>;
}

/** Узкая колонка со стрелкой раскрытия: у всех строк на одной вертикали; у строк без раскрытия — пустая ячейка той же ширины. */
const ARROW_TD = "w-6 py-1.5 pl-2 pr-0 text-left align-middle";
const ARROW_TH = "w-6 px-0";

// ───────────────────────────── Динамика по годам ─────────────────────────────

export function YearsTable({ rows, c4, info }: { rows: YearRow[]; c4: "on" | "off"; info: ModeInfo }) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const otherW = c4 === "on" ? "без 4%" : "с 4%";
  const sum = (a: Cells, b: Cells): Cells => ({ rq: a.rq + b.rq, rv: a.rv + b.rv, ra: null, uq: a.uq + b.uq, uv: a.uv + b.uv, ua: null, mq: a.mq + b.mq, mv: a.mv + b.mv, ma: null, uo: a.uo + b.uo, uoa: null });

  const sub = (label: string, c: Cells, unit: string, key: string) => (
    <tr key={key} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
      <td className={ARROW_TD} />
      <td className="py-1.5 pr-2 pl-0">{label}</td>
      <td className={td}>{formatQty(c.rq)} {unit}</td><td className={td}>{rub(c.rv)}</td>
      <td className={td}>{formatQty(c.uq)} {unit}</td><td className={td}>{rub(c.uv)}<div className="text-[10px] font-normal leading-3 text-neutral-500">{otherW}: {rub(c.uo)}</div></td>
      <td className={td}>{formatQty(c.mq)} {unit}</td><td className={td}>{rub(c.mv)}</td>
      <td className={td} colSpan={4}><span className="text-neutral-400">—</span></td>
    </tr>
  );

  return (
    <section aria-labelledby="dash-years" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-years" className="flex items-center gap-2 text-base font-semibold">
          Динамика по годам
          <InfoHint label="Как читать динамику по годам" wide>
            <p><b>Закуплено / использовано / остаток</b> — по году закупки лота: в каждой строке закуплено − использовано = остаток. Использовано — {c4W}.</p>
            <p className="mt-1"><b>Произведено</b> — выпуск завершённых ТЗ по году ТЗ (дата ТЗ, иначе год партии); себестоимость без работы. ТЗ в работе сюда не входят — они в блоке «Производство».</p>
            <p className="mt-1"><b>Оплачено</b> и <b>долг поставщику</b> — по закупкам этого года, как в «Оплатах». Аванс без привязки к закупке относится к году даты оплаты. Фильтры панели на эти две колонки не влияют.</p>
            <p className="mt-1"><b>Итого</b> — сумма строк по каждой колонке (долг: долг года 1 + долг года 2 = общий долг). Год шапки таблицу не меняет; фильтры панели действуют на сырьё и производство.</p>
          </InfoHint>
        </h2>
        <span className="flex flex-wrap items-center gap-x-3 text-xs text-neutral-500"><ModeLine info={{ ...info, year: "все годы (год шапки не меняет)" }} c4={c4} /><span>нажмите на год — мех и подкладка отдельно</span></span>
      </div>
      <div className="table-scroll overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th rowSpan={2} className={ARROW_TH} aria-label="Раскрыть" />
              <th rowSpan={2} className="px-2 py-1.5 text-left text-xs font-medium text-neutral-500">Год</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Куплено</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Использовано</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Остаток</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Произведено</th>
              <th rowSpan={2} className={th + " border-l border-neutral-100"}>Оплачено поставщику</th>
              <th rowSpan={2} className={th}>Долг поставщику</th>
            </tr>
            <tr className="border-b border-neutral-200">
              {["шт. / м", "₽", "шт. / м", "₽", "шт. / м", "₽", "шт.", "себестоимость ₽"].map((h, i) => <th key={i} className={th + (i % 2 === 0 ? " border-l border-neutral-100" : "")}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const f = r.fur[vat], l = r.lining[vat];
              const t = sum(f, l);
              const isOpen = open.has(r.key);
              const total = r.key === "all";
              return (
                <Fragment key={r.key}>
                  <tr className={"border-b border-neutral-100 " + (total ? "bg-neutral-50 font-semibold" : "")}>
                    <td className={ARROW_TD}>
                      <button type="button" onClick={() => toggle(r.key)} aria-expanded={isOpen} aria-label={`Раскрыть: ${r.label}`}><Chevron open={isOpen} /></button>
                    </td>
                    <td className="px-2 py-1.5 text-left font-semibold">{r.label}{r.key === "none" ? <InfoHint label="Что такое «Без даты»" className="ml-1"><p>ТЗ без даты и без года партии: в базе нет ни даты ТЗ, ни даты начала/выпуска, ни года партии. Их выпуск не отнесён ни к одному году.</p></InfoHint> : null}</td>
                    <td className={td}>{formatQty(f.rq)} шт.{l.rq > 0 ? <span className="text-neutral-500"> + {formatQty(l.rq)} м</span> : null}</td><td className={td}>{rub(t.rv)}</td>
                    <td className={td}>{formatQty(f.uq)} шт.{l.uq > 0 ? <span className="text-neutral-500"> + {formatQty(l.uq)} м</span> : null}</td><td className={td}>{rub(t.uv)}<div className="text-[10px] font-normal leading-3 text-neutral-500">{otherW}: {rub(t.uo)}</div></td>
                    <td className={td}>{formatQty(f.mq)} шт.{l.mq > 0 ? <span className="text-neutral-500"> + {formatQty(l.mq)} м</span> : null}</td><td className={td}>{rub(t.mv)}</td>
                    <td className={td}>{formatQty(r.prod.qty)} шт.</td><td className={td}>{rub(vat === "incl" ? r.prod.costIncl : r.prod.costExcl)}</td>
                    <td className={td}>{rub0(r.paid)}</td>
                    <td className={td + (r.debt > 0 ? " text-amber-700" : "")}>{rub0(r.debt)}</td>
                  </tr>
                  {isOpen ? (
                    <>
                      {sub("Мех", f, "шт.", r.key + "f")}
                      {sub("Подкладка", l, "м", r.key + "l")}
                      <tr className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-600">
                        <td className="py-1.5 pl-2 pr-2" colSpan={7}>Работа по завершённым ТЗ (вне себестоимости): <b className="tabular-nums">{rub(r.prod.work)}</b></td>
                        <td className={td} colSpan={4}></td>
                      </tr>
                    </>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Note>
        ≠ <b>В одной строке «Использовано» и «Произведено» не сравниваются:</b> «Использовано» — сырьё лотов, <i>купленных</i> в этом году (где бы ни было списано); «Произведено» — ТЗ этого <i>года ТЗ</i> (дата ТЗ → окончание → начало → год партии). Мех, купленный в 2025, мог уйти в ТЗ 2026. В «Итого» всё сходится: использовано (без 4%) = себестоимость завершённых + ТЗ «в работе».{" "}
        «Использовано» мелко показано в обеих базах: «без 4%» + остаток = куплено. «Оплачено» и «Долг» — всегда с НДС, не зависят от фильтров и 4%; «Без даты» — ТЗ без даты и года партии.
      </Note>
    </section>
  );
}

// ───────────────────────────── Динамика по сырью ─────────────────────────────

function CellsTds({ c, unit, bold, other }: { c: Cells; unit: string; bold?: boolean; other: string }) {
  const cls = td + (bold ? " font-semibold" : "");
  // Под «Использовано» мелко — то же в другой базе 4%: «без 4%» + остаток = куплено; «с 4%» — с надбавкой.
  const sm = (v: string) => <div className="text-[10px] font-normal leading-3 text-neutral-500">{other}: {v}</div>;
  return (
    <>
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.rq)} {unit}</td><td className={cls}>{rub(c.rv)}</td><td className={cls + " text-neutral-600"}>{c.ra != null ? rub(c.ra) : "—"}</td>
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.uq)} {unit}</td><td className={cls}>{rub(c.uv)}{sm(rub(c.uo))}</td><td className={cls + " text-neutral-600"}>{c.ua != null ? rub(c.ua) : "—"}{c.uoa != null ? sm(rub(c.uoa)) : null}</td>
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.mq)} {unit}</td><td className={cls}>{rub(c.mv)}</td><td className={cls + " text-neutral-600"}>{c.ma != null ? rub(c.ma) : "—"}</td>
    </>
  );
}

const addCells = (list: Cells[]): Cells => {
  const s = list.reduce((a, c) => ({ rq: a.rq + c.rq, rv: a.rv + c.rv, uq: a.uq + c.uq, uv: a.uv + c.uv, mq: a.mq + c.mq, mv: a.mv + c.mv, uo: a.uo + c.uo }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0, uo: 0 });
  const r = (v: number, q: number) => (q > 0 ? v / q : null);
  return { ...s, ra: r(s.rv, s.rq), ua: r(s.uv, s.uq), ma: r(s.mv, s.mq), uoa: r(s.uo, s.uq) };
};

export function RawTable({ rows, total, c4, info, orderFilters }: { rows: RawTableRow[]; total: CellsPair; c4: "on" | "off"; info: ModeInfo; orderFilters: boolean }) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const otherW = c4 === "on" ? "без 4%" : "с 4%";
  const fur = rows.filter((r) => r.kind === "fur");
  const lin = rows.filter((r) => r.kind === "lining");
  const furSub = addCells(fur.map((r) => r.cells[vat]));
  const linSub = addCells(lin.map((r) => r.cells[vat]));
  const T = total[vat];

  const kindHead = (kindLabel: string) => (
    <tr className="bg-neutral-100/70 text-xs font-semibold uppercase tracking-wide text-neutral-600"><td colSpan={11} className="px-2 py-1">{kindLabel}</td></tr>
  );
  const arrow = (k: string, label: string) => (
    <button type="button" onClick={() => toggle(k)} aria-expanded={open.has(k)} aria-label={`Раскрыть: ${label}`}><Chevron open={open.has(k)} /></button>
  );
  const itemRows = (list: RawTableRow[], unit: string) =>
    list.map((r) => {
      const isOpen = open.has(r.key);
      return (
        <Fragment key={r.key}>
          <tr className="border-b border-neutral-100 hover:bg-neutral-50">
            <td className={ARROW_TD}>{arrow(r.key, r.label)}</td>
            <td className="px-2 py-1.5 text-left">
              <span className="font-medium">{r.label}</span>
              <Link href={r.kind === "fur" ? `/lots?fur=${encodeURIComponent(r.label)}` : `/lots?lmat=${encodeURIComponent(r.label)}`} className="ml-2 text-[11px] text-blue-700 hover:underline print:hidden">→ Сырьё</Link>
            </td>
            <CellsTds c={r.cells[vat]} unit={unit} other={otherW} />
          </tr>
          {isOpen ? r.auctions.map((a) => (
            <tr key={r.key + a.key} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
              <td className={ARROW_TD} />
              <td className="px-2 py-1.5 text-left">{a.label}</td>
              <CellsTds c={a.cells[vat]} unit={unit} other={otherW} />
            </tr>
          )) : null}
        </Fragment>
      );
    });

  const furBlock = (
    <>
      {kindHead("Мех")}
      {itemRows(fur, "шт.")}
      {fur.length > 1 ? (
        <tr className="border-b border-neutral-200 bg-neutral-50 font-semibold"><td className={ARROW_TD} /><td className="px-2 py-1.5 text-left">Итого мех</td><CellsTds c={furSub} unit="шт." bold other={otherW} /></tr>
      ) : null}
    </>
  );
  // Подкладка по умолчанию свёрнута до одной итоговой строки; по клику — ткани.
  const LIN = "__lining";
  const linBlock = (
    <>
      {kindHead("Подкладка")}
      <tr className="border-b border-neutral-200 bg-neutral-50 font-semibold">
        <td className={ARROW_TD}>{arrow(LIN, "подкладка")}</td>
        <td className="px-2 py-1.5 text-left">Подкладка{lin.length > 1 ? <span className="ml-2 text-[11px] font-normal text-neutral-500">{lin.length} видов ткани</span> : null}</td>
        <CellsTds c={linSub} unit="м" bold other={otherW} />
      </tr>
      {open.has(LIN) ? itemRows(lin, "м") : null}
    </>
  );

  return (
    <section aria-labelledby="dash-raw-table" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-raw-table" className="flex items-center gap-2 text-base font-semibold">
          Динамика по сырью
          <InfoHint label="Как читать таблицу по сырью" wide>
            <p>Строка — вид меха или ткань подкладки («Лиса красная» — вид «Лиса», красная — цвет). Нажмите на вид — разбивка по аукционам.</p>
            <p className="mt-1"><b>Средневзвешенная цена</b> = Σ ₽ ÷ Σ шт. (подкладка — ÷ Σ м). Использовано — {c4W}; куплено и остаток — без 4%.</p>
            <p className="mt-1">Год шапки и фильтры панели действуют. «Всего» складывает мех и подкладку только в рублях.</p>
          </InfoHint>
        </h2>
        <ModeLine info={info} c4={c4} />
      </div>
      <div className="table-scroll overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th rowSpan={2} className={ARROW_TH} aria-label="Раскрыть" />
              <th rowSpan={2} className="px-2 py-1.5 text-left text-xs font-medium text-neutral-500">Вид</th>
              <th colSpan={3} className={th + " border-l border-neutral-100 text-center"}>Куплено</th>
              <th colSpan={3} className={th + " border-l border-neutral-100 text-center"}>Использовано</th>
              <th colSpan={3} className={th + " border-l border-neutral-100 text-center"}>Остаток</th>
            </tr>
            <tr className="border-b border-neutral-200">
              {[0, 1, 2].flatMap((g) => ["шт.", "₽", "средневзв. ₽/шт."].map((h, i) => <th key={g + h} className={th + (i === 0 ? " border-l border-neutral-100" : "")}>{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {fur.length > 0 ? furBlock : null}
            {lin.length > 0 ? linBlock : null}
            {rows.length === 0 ? <tr><td colSpan={11} className="px-3 py-6 text-center text-sm text-neutral-500">По выбранным фильтрам лотов нет.</td></tr> : null}
            {rows.length > 0 ? (
              <tr className="bg-neutral-900 font-semibold text-white">
                <td className="w-6" /><td className="px-2 py-2 text-left">Всего, ₽ (мех + подкладка)</td>
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.rv)}</td><td className={td + " text-white/50"}>—</td>
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.uv)}</td><td className={td + " text-white/50"}>—</td>
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.mv)}</td><td className={td + " text-white/50"}>—</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Note>
        <b>Куплено = использовано (без 4%) + остаток</b> по штукам и по рублям. «Куплено» и «Остаток» — всегда без 4%; 4% добавляется только к «Использовано» (мелкая строка — обе базы). Поэтому в режиме «с 4%» средневзвешенная цена купленного может лежать вне интервала «использовано — остаток»: сравнивайте с «без 4%».
        {orderFilters ? " Фильтр по ТЗ сужает только «Использовано»: тогда куплено − использовано ≠ остаток." : ""}
      </Note>
    </section>
  );
}
