"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { Cells, CellsPair, RawTableRow, YearRow } from "@/lib/dashboard-data";

const rub = (v: number) => formatMoney(v.toFixed(2));
const rub0 = (v: number) => formatMoney(Math.round(v));
const avg = (v: number, q: number) => (q > 0 ? rub(v / q) : "—");

const th = "whitespace-nowrap px-2 py-1.5 text-right text-xs font-medium text-neutral-500";
const td = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";

function Chevron({ open }: { open: boolean }) {
  return <span aria-hidden className={"inline-block w-4 text-neutral-400 transition-transform " + (open ? "rotate-90" : "")}>›</span>;
}

// ───────────────────────────── Динамика по годам ─────────────────────────────

export function YearsTable({ rows, c4 }: { rows: YearRow[]; c4: "on" | "off" }) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const sum = (a: Cells, b: Cells): Cells => ({ rq: a.rq + b.rq, rv: a.rv + b.rv, ra: null, uq: a.uq + b.uq, uv: a.uv + b.uv, ua: null, mq: a.mq + b.mq, mv: a.mv + b.mv, ma: null });

  const sub = (label: string, c: Cells, unit: string, key: string) => (
    <tr key={key} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
      <td className="py-1.5 pl-8 pr-2">{label}</td>
      <td className={td}>{formatQty(c.rq)} {unit}</td><td className={td}>{rub(c.rv)}</td>
      <td className={td}>{formatQty(c.uq)} {unit}</td><td className={td}>{rub(c.uv)}</td>
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
            <p><b>Закуплено / использовано / остаток</b> — по году закупки лота (как фильтр года в «Сырье»), поэтому в каждой строке закуплено − использовано = остаток. Использовано — {c4W}.</p>
            <p className="mt-1"><b>Произведено</b> — завершённые ТЗ по году ТЗ (дата ТЗ, иначе год партии); себестоимость без работы.</p>
            <p className="mt-1"><b>Оплачено поставщику</b> и <b>долг</b> — по закупкам года и их оплатам (проведённые оплаты + авансы без привязки); считаются так же, как в «Оплатах», и не зависят от фильтров панели. Долг «Итого» считается по всем годам сразу и не равен сумме строк (авансы без привязки вычитаются один раз).</p>
            <p className="mt-1">Год шапки на эту таблицу не влияет: показаны все годы. Фильтры панели действуют на сырьё и производство.</p>
          </InfoHint>
        </h2>
        <span className="text-xs text-neutral-500">{vat === "incl" ? "с НДС" : "без НДС"} · использовано {c4W} · нажмите на год — мех и подкладка отдельно</span>
      </div>
      <div className="table-scroll overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
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
                    <td className="px-2 py-1.5 text-left">
                      <button type="button" onClick={() => toggle(r.key)} aria-expanded={isOpen} className="flex items-center gap-1 font-semibold hover:underline">
                        <Chevron open={isOpen} />{r.label}
                      </button>
                    </td>
                    <td className={td}>{formatQty(f.rq)} шт.{l.rq > 0 ? <span className="text-neutral-500"> + {formatQty(l.rq)} м</span> : null}</td><td className={td}>{rub(t.rv)}</td>
                    <td className={td}>{formatQty(f.uq)} шт.{l.uq > 0 ? <span className="text-neutral-500"> + {formatQty(l.uq)} м</span> : null}</td><td className={td}>{rub(t.uv)}</td>
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
                        <td className="py-1.5 pl-8 pr-2" colSpan={7}>Работа по завершённым ТЗ (вне себестоимости): <b className="tabular-nums">{rub(r.prod.work)}</b></td>
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
    </section>
  );
}

// ───────────────────────────── Динамика по сырью ─────────────────────────────

function CellsTds({ c, unit, bold }: { c: Cells; unit: string; bold?: boolean }) {
  const cls = td + (bold ? " font-semibold" : "");
  return (
    <>
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.rq)} {unit}</td><td className={cls}>{rub(c.rv)}</td><td className={cls + " text-neutral-600"}>{c.ra != null ? rub(c.ra) : "—"}</td>
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.uq)} {unit}</td><td className={cls}>{rub(c.uv)}</td><td className={cls + " text-neutral-600"}>{c.ua != null ? rub(c.ua) : "—"}</td>
      <td className={cls + " border-l border-neutral-100"}>{formatQty(c.mq)} {unit}</td><td className={cls}>{rub(c.mv)}</td><td className={cls + " text-neutral-600"}>{c.ma != null ? rub(c.ma) : "—"}</td>
    </>
  );
}

const addCells = (list: Cells[]): Cells => {
  const s = list.reduce((a, c) => ({ rq: a.rq + c.rq, rv: a.rv + c.rv, uq: a.uq + c.uq, uv: a.uv + c.uv, mq: a.mq + c.mq, mv: a.mv + c.mv }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0 });
  const r = (v: number, q: number) => (q > 0 ? v / q : null);
  return { ...s, ra: r(s.rv, s.rq), ua: r(s.uv, s.uq), ma: r(s.mv, s.mq) };
};

export function RawTable({ rows, total, c4 }: { rows: RawTableRow[]; total: CellsPair; c4: "on" | "off" }) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const fur = rows.filter((r) => r.kind === "fur");
  const lin = rows.filter((r) => r.kind === "lining");
  const furSub = addCells(fur.map((r) => r.cells[vat]));
  const linSub = addCells(lin.map((r) => r.cells[vat]));
  const T = total[vat];

  const block = (list: RawTableRow[], unit: string, kindLabel: string, subtotal: Cells) => (
    <>
      <tr className="bg-neutral-100/70 text-xs font-semibold uppercase tracking-wide text-neutral-600"><td colSpan={10} className="px-2 py-1">{kindLabel}</td></tr>
      {list.map((r) => {
        const isOpen = open.has(r.key);
        return (
          <Fragment key={r.key}>
            <tr className="border-b border-neutral-100 hover:bg-neutral-50">
              <td className="px-2 py-1.5 text-left">
                <button type="button" onClick={() => toggle(r.key)} aria-expanded={isOpen} className="flex items-center gap-1 font-medium hover:underline">
                  <Chevron open={isOpen} />{r.label}
                </button>
                <Link href={r.kind === "fur" ? `/lots?fur=${encodeURIComponent(r.label)}` : `/lots?lmat=${encodeURIComponent(r.label)}`} className="ml-5 text-[11px] text-blue-700 hover:underline print:hidden">→ Сырьё</Link>
              </td>
              <CellsTds c={r.cells[vat]} unit={unit} />
            </tr>
            {isOpen ? r.auctions.map((a) => (
              <tr key={r.key + a.key} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
                <td className="py-1.5 pl-9 pr-2 text-left">{a.label}</td>
                <CellsTds c={a.cells[vat]} unit={unit} />
              </tr>
            )) : null}
          </Fragment>
        );
      })}
      {list.length > 1 ? (
        <tr className="border-b border-neutral-200 bg-neutral-50 font-semibold"><td className="px-2 py-1.5 text-left">Итого {kindLabel.toLowerCase()}</td><CellsTds c={subtotal} unit={unit} bold /></tr>
      ) : null}
    </>
  );

  return (
    <section aria-labelledby="dash-raw-table" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-raw-table" className="flex items-center gap-2 text-base font-semibold">
          Динамика по сырью
          <InfoHint label="Как читать таблицу по сырью" wide>
            <p>Строка — вид меха или ткань подкладки. «Лиса красная» — вид «Лиса» (красная — цвет), одна строка. Нажмите на вид — разбивка по партиям закупки (аукционам).</p>
            <p className="mt-1"><b>Средневзвешенная цена</b> = Σ ₽ ÷ Σ шт. (для подкладки — ÷ Σ м). Использовано — {c4W}; куплено и остаток — без 4%.</p>
            <p className="mt-1">Фильтры панели и год шапки действуют. Итоговая строка складывает мех и подкладку только в рублях.</p>
          </InfoHint>
        </h2>
        <span className="text-xs text-neutral-500">{vat === "incl" ? "с НДС" : "без НДС"} · использовано {c4W}</span>
      </div>
      <div className="table-scroll overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
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
            {fur.length > 0 ? block(fur, "шт.", "Мех", furSub) : null}
            {lin.length > 0 ? block(lin, "м", "Подкладка", linSub) : null}
            {rows.length === 0 ? <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-neutral-500">По выбранным фильтрам лотов нет.</td></tr> : null}
            {rows.length > 0 ? (
              <tr className="bg-neutral-900 font-semibold text-white">
                <td className="px-2 py-2 text-left">Всего, ₽ (мех + подкладка)</td>
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.rv)}</td><td className={td + " text-white/50"}>—</td>
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.uv)}</td><td className={td + " text-white/50"}>—</td>
                <td className={td + " text-white/50"}>—</td><td className={td}>{rub(T.mv)}</td><td className={td + " text-white/50"}>—</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
