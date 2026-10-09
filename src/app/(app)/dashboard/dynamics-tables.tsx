"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { Cells, CellsPair, RawTableRow, YearRow } from "@/lib/dashboard-data";
import type { ModeInfo } from "./mode-line";

const rub = (v: number) => formatMoney(v.toFixed(2));
const rub0 = (v: number) => formatMoney(Math.round(v));

const th = "whitespace-nowrap px-1.5 py-1.5 text-right text-xs font-medium text-neutral-500";
const td = "whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums";

function Chevron({ open }: { open: boolean }) {
  return <span aria-hidden className={"inline-block w-4 text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}>›</span>;
}

/** Узкая колонка со стрелкой раскрытия: у всех строк на одной вертикали; у строк без раскрытия — пустая ячейка той же ширины. */
const ARROW_TD = "w-6 py-1.5 pl-2 pr-0 text-left align-middle";
const ARROW_TH = "w-6 px-0";

// ───────────────────────────── Динамика по годам ─────────────────────────────

export function YearsTable({ rows, c4, info }: { rows: YearRow[]; c4: "on" | "off"; info: ModeInfo }) {
  void info;
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const sum = (a: Cells, b: Cells): Cells => ({ rq: a.rq + b.rq, rv: a.rv + b.rv, ra: null, uq: a.uq + b.uq, uv: a.uv + b.uv, ua: null, mq: a.mq + b.mq, mv: a.mv + b.mv, ma: null, uo: a.uo + b.uo, uoa: null });

  const sub = (label: string, c: Cells, unit: string, key: string) => (
    <tr key={key} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
      <td className={ARROW_TD} />
      <td className="py-1.5 pr-2 pl-0">{label}</td>
      <td className={td}>{formatQty(c.rq)} {unit}</td><td className={td}>{rub(c.rv)}</td>
      <td className={td}>{formatQty(c.uq)} {unit}</td><td className={td}>{rub(c.uv)}</td>
      <td className={td}>{formatQty(c.mq)} {unit}</td><td className={td}>{rub(c.mv)}</td>
      <td className={td} colSpan={2}><span className="text-neutral-500">—</span></td>
    </tr>
  );

  return (
    <section aria-labelledby="dash-years" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
        <h2 id="dash-years" className="text-base font-semibold">Динамика по годам</h2>
          <InfoHint label="Как читать динамику по годам" wide>
            <p><b>Закуплено / использовано / остаток</b> — по году закупки лота: в каждой строке закуплено − использовано = остаток. Использовано — всегда без 4% (надбавка 4% показана в виджетах «Сырьё» и «Себестоимость»).</p>
            <p className="mt-1">Штуки — только мех; подкладка (метры) — в раскрытой строке, а в рублях она учтена. </p>
                        <p className="mt-1"><b>Оплачено</b> и <b>долг</b> (поставщику) — по закупкам этого года, как в «Оплатах». Аванс без привязки к закупке относится к году даты оплаты. Фильтры панели на эти две колонки не влияют.</p>
            <p className="mt-1"><b>Итого</b> — сумма строк по каждой колонке (долг: долг года 1 + долг года 2 = общий долг). Год шапки таблицу не меняет; фильтры панели действуют на сырьё и производство.</p>
            <p className="mt-1"><b>Использовано</b> — всегда без 4%, поэтому куплено = использовано + остаток. Оплачено и долг — всегда с НДС, не зависят от фильтров и 4%.</p>
            <p className="mt-1">Использовано — сырьё лотов, купленных в этом году (где бы ни было списано): мех, купленный в 2025, мог уйти в ТЗ 2026.</p>
          </InfoHint>
        </div>
      </div>
      <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th rowSpan={2} className={ARROW_TH} aria-label="Раскрыть" />
              <th rowSpan={2} className="px-2 py-1.5 text-left text-xs font-medium text-neutral-500">Год</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Куплено</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Использовано</th>
              <th colSpan={2} className={th + " border-l border-neutral-100 text-center"}>Остаток</th>
              <th rowSpan={2} className={th + " border-l border-neutral-100"}>Оплачено</th>
              <th rowSpan={2} className={th}>Долг</th>
            </tr>
            <tr className="border-b border-neutral-200">
              {["шт.", "₽", "шт.", "₽", "шт.", "₽"].map((h, i) => <th key={i} className={th + (i % 2 === 0 ? " border-l border-neutral-100" : "")}>{h}</th>)}
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
                    <td className={td}>{formatQty(f.rq)} шт.</td><td className={td}>{rub(t.rv)}</td>
                    <td className={td}>{formatQty(f.uq)} шт.</td><td className={td}>{rub(t.uv)}</td>
                    <td className={td}>{formatQty(f.mq)} шт.</td><td className={td}>{rub(t.mv)}</td>
                    <td className={td}>{rub0(r.paid)}</td>
                    <td className={td + (r.debt > 0 ? " text-amber-700" : "")}>{rub0(r.debt)}</td>
                  </tr>
                  {isOpen ? (
                    <>
                      {sub("Мех", f, "шт.", r.key + "f")}
                      {sub("Подкладка", l, "м", r.key + "l")}
                    </>
                  ) : null}
                </Fragment>
              );
            })}
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

const addCells = (list: Cells[]): Cells => {
  const s = list.reduce((a, c) => ({ rq: a.rq + c.rq, rv: a.rv + c.rv, uq: a.uq + c.uq, uv: a.uv + c.uv, mq: a.mq + c.mq, mv: a.mv + c.mv, uo: a.uo + c.uo }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0, uo: 0 });
  const r = (v: number, q: number) => (q > 0 ? v / q : null);
  return { ...s, ra: r(s.rv, s.rq), ua: r(s.uv, s.uq), ma: r(s.mv, s.mq), uoa: r(s.uo, s.uq) };
};

export function RawTable({ rows, total, money, c4, info: _info, orderFilters }: { rows: RawTableRow[]; total: CellsPair; money: { paid: number; due: number; unreceived: { paid: number; due: number; names: string[]; byFur: { label: string; names: string[]; paid: number; due: number }[] } }; c4: "on" | "off"; info: ModeInfo; orderFilters: boolean}) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const avg = false; // колонки цен убраны: цены — в окне по клику на «Цена» в блоке «Сырьё»
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const fur = rows.filter((r) => r.kind === "fur");
  const lin = rows.filter((r) => r.kind === "lining");
  const furSub = addCells(fur.map((r) => r.cells[vat]));
  const linSub = addCells(lin.map((r) => r.cells[vat]));
  const T = total[vat];

  const kindHead = (kindLabel: string) => (
    <tr className="bg-neutral-100/70 text-xs font-semibold uppercase tracking-wide text-neutral-600"><td colSpan={avg ? 13 : 10} className="px-2 py-1">{kindLabel}</td></tr>
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
            </td>
            <CellsTds c={r.cells[vat]} unit={unit} avg={avg} />
            <MoneyTds paid={r.paid} due={r.due} />
          </tr>
          {isOpen ? r.auctions.map((a) => (
            <tr key={r.key + a.key} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
              <td className={ARROW_TD} />
              <td className="px-2 py-1.5 text-left">{a.label}</td>
              <CellsTds c={a.cells[vat]} unit={unit} avg={avg} />
              <MoneyTds paid={a.paid} due={a.due} />
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
        <tr className="border-b border-neutral-200 bg-neutral-50 font-semibold"><td className={ARROW_TD} /><td className="px-2 py-1.5 text-left">Итого мех</td><CellsTds c={furSub} unit="шт." bold avg={avg} /><MoneyTds paid={fur.reduce((a, r) => a + r.paid, 0)} due={fur.reduce((a, r) => a + r.due, 0)} bold /></tr>
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
        <td className="px-2 py-1.5 text-left">Подкладка</td>
        <CellsTds c={linSub} unit="м" bold avg={avg} />
        <MoneyTds paid={lin.reduce((a, r) => a + r.paid, 0)} due={lin.reduce((a, r) => a + r.due, 0)} bold />
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
          </InfoHint>
        </div>
      </div>
      <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className={"w-full text-sm " + (avg ? "min-w-[1080px]" : "min-w-[900px]")}>
          <thead>
            <tr className="border-b border-neutral-200">
              <th rowSpan={2} className={ARROW_TH} aria-label="Раскрыть" />
              <th rowSpan={2} className="px-2 py-1.5 text-left text-xs font-medium text-neutral-500">Вид</th>
              <th colSpan={avg ? 3 : 2} className={th + " border-l border-neutral-100 text-center"}>Куплено</th>
              <th colSpan={avg ? 3 : 2} className={th + " border-l border-neutral-100 text-center"}>Использовано</th>
              <th colSpan={avg ? 3 : 2} className={th + " border-l border-neutral-100 text-center"}>Остаток</th>
              <th rowSpan={2} className={th + " border-l border-neutral-100"}>Оплачено</th>
              <th rowSpan={2} className={th}>Долг</th>
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
                      <td className={ARROW_TD} />
                      <td className="px-2 py-1.5 text-left" colSpan={7}>{g.label} — ещё не получен ({g.names.join(", ")})</td>
                      <MoneyTds paid={g.paid} due={g.due} />
                    </tr>
                  ))}
                  {show(u.paid - u.byFur.reduce((a, g) => a + g.paid, 0), u.due - u.byFur.reduce((a, g) => a + g.due, 0)) ? (
                    <tr className="border-b border-neutral-100 text-[13px] text-neutral-700">
                      <td className={ARROW_TD} />
                      <td className="px-2 py-1.5 text-left" colSpan={7}>Мех ещё не получен: прочие закупки без лотов</td>
                      <MoneyTds paid={u.paid - u.byFur.reduce((a, g) => a + g.paid, 0)} due={u.due - u.byFur.reduce((a, g) => a + g.due, 0)} />
                    </tr>
                  ) : null}
                  {show(restPaid, restDue) ? (
                    <tr className="border-b border-neutral-100 text-[13px] text-neutral-700">
                      <td className={ARROW_TD} />
                      <td className="px-2 py-1.5 text-left" colSpan={7}>Прочее: мех без аукциона, шкуры подрядчика, зачёты и поправки</td>
                      <MoneyTds paid={restPaid} due={restDue} />
                    </tr>
                  ) : null}
                </>
              );
            })()}
            {rows.length === 0 ? <tr><td colSpan={avg ? 13 : 10} className="px-3 py-6 text-center text-sm text-neutral-500">По выбранным фильтрам лотов нет.</td></tr> : null}
            {rows.length > 0 ? (
              <tr className="bg-neutral-900 font-semibold text-white">
                <td className="w-6" /><td className="px-2 py-2 text-left">Всего, ₽</td>
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.rv)}</td>{avg ? <td className={td + " text-white/50"}>—</td> : null}
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.uv)}</td>{avg ? <td className={td + " text-white/50"}>—</td> : null}
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.mv)}</td>{avg ? <td className={td + " text-white/50"}>—</td> : null}
                <td className={td + " border-l border-white/10"}>{rub0(money.paid)}</td><td className={td}>{rub0(money.due)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
