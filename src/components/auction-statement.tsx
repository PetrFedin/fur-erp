import type { ReactNode } from "react";
import { Clamp } from "@/components/clamp";
import Link from "next/link";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { SortTh } from "@/components/sort-th";
import { groupLines, type Statement } from "@/lib/auction-statement";
import { sortRows, type SortParams, type SortState } from "@/lib/table-sort";
import { formatNum } from "@/lib/utils";

const money = (n: number) => formatNum(n, 1);
const num = (n: number) => formatNum(n, 10);

/**
 * «За что заплачено»: выдержка из расчёта аукциона. Статьи по группам с суммами в ₽ (и в $ там, где столбец в долларах),
 * источник каждой цифры (столбец листа расчёта), итог и сверка «сумма статей = итог расчёта».
 * action — кнопка/ссылка справа в заголовке («Открыть расчёт» / «Править»).
 */
export function StatementBlock({ st, source, action, note, cur = "₽", bare = false }: { st: Statement; source: string; action?: ReactNode; note?: ReactNode; cur?: string; /** Внутри общей карточки «Состав стоимости»: без рамки, заголовок h3. */ bare?: boolean }) {
  const groups = groupLines(st.lines);
  return (
    <section className={bare ? "flex flex-col gap-2" : "flex flex-col gap-2 rounded-md border border-neutral-300 bg-white p-3"} aria-labelledby="st-title">
      <div className="flex flex-wrap items-center gap-3">
        {bare ? <h3 id="st-title" className="text-sm font-semibold">По статьям расчёта</h3> : <h2 id="st-title" className="text-base font-semibold">Состав стоимости</h2>}
        <span className="min-w-0 max-w-md text-xs text-neutral-500"><Clamp>{source}</Clamp></span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {!st.detailed ? (
        <p className="text-sm text-neutral-600">Разбивки по статьям нет. Сумма по лотам: <b className="tabular-nums">{money(st.total)} {cur}</b>; разбивка — в строке лота.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th scope="col" className="py-1 pr-3 font-medium">Статья</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">$</th>
                <th scope="col" className="py-1 pl-2 text-right font-medium">₽</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const sub = g.lines.reduce((a, l) => a + l.total, 0);
                return (
                  <GroupRows key={g.key} title={g.title} sub={sub} many={g.lines.length > 1} lines={g.lines} />
                );
              })}
              <tr className="border-t-2 border-neutral-400 font-semibold">
                <td className="py-1.5 pr-3" colSpan={1}>Итого по расчёту</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{st.usdTotal != null ? money(st.usdTotal) : ""}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums">{money(st.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-neutral-600">
        <span title={`Итог = сумма лотов${st.detailed ? " = сумма статей" : ""}`}>Лотов {st.lots.length} · шкур {num(st.qty)} · итого <b className="tabular-nums text-neutral-800">{money(st.total)} {cur}</b></span>
        {st.detailed && Math.abs(st.gap) > 0.005 && <span className="ml-1 text-amber-900">· {money(st.gap)} {cur} не разнесено по статьям: сверьте формулу «себестоимость за единицу»</span>}
      </p>
      {note}
    </section>
  );
}

function GroupRows({ title, sub, lines, many }: { title: string; sub: number; lines: Statement["lines"]; many: boolean }) {
  return (
    <>
      <tr className="bg-neutral-50">
        <td className="py-1 pl-1 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600 ">{title}</td>
        <td className="py-1 pl-2 text-right text-xs font-semibold tabular-nums text-neutral-700">{many ? money(sub) : ""}</td>
      </tr>
      {lines.map((l) => (
        <tr key={l.id} className="border-b border-neutral-100">
          <td className="py-1 pl-3 pr-3">{l.label}{l.manual > 0 && <span className="ml-2 rounded bg-amber-100 px-1 text-[11px] text-amber-800">вручную: {l.manual}</span>}</td>
          <td className="px-2 py-1 text-right tabular-nums text-sky-800">{l.usd != null ? money(l.usd) : ""}</td>
          <td className="py-1 pl-2 text-right tabular-nums">{money(l.total)}</td>
        </tr>
      ))}
    </>
  );
}

export type PartCol = { key: string; title: string };
export type LotRow = { id: string; invoice: string; lot: string; fur: string; size: string; qty: number; unit: number; total: number; cur: string; /** суммы по группам статей на весь лот */ parts?: Record<string, number> };

/** Таблица лотов с сортировкой по заголовкам; номер лота открывает «из чего сложилась цена» (?lot=…). */
export function LotsTable({ rows, partCols = [], path, sp, cur, openId, showInvoice = true, totalLabel = "Итого" }: {
  rows: LotRow[]; partCols?: PartCol[]; path: string; sp: SortParams; cur: SortState | null; openId?: string; showInvoice?: boolean; totalLabel?: string;
}) {
  const sorted = sortRows(rows, cur, {
    invoice: (r) => r.invoice, lot: (r) => r.lot, fur: (r) => r.fur, size: (r) => r.size, qty: (r) => r.qty, unit: (r) => r.unit, total: (r) => r.total,
  });
  const th = (k: string, label: string, align: "left" | "right" = "left") => <SortTh path={path} sp={sp} k={k} cur={cur} label={label} align={align} />;
  const c = rows[0]?.cur ?? "₽";
  const lotHref = (id: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) { const val = Array.isArray(v) ? v[0] : v; if (val && k !== "lot") q.set(k, val); }
    if (openId !== id) q.set("lot", id);
    const s = q.toString();
    return `${path}${s ? `?${s}` : ""}#lots`;
  };
  return (
    <Table className={partCols.length ? "min-w-[900px]" : "min-w-[640px]"}>
      <Thead>
        <Tr>
          {showInvoice && th("invoice", "Счёт")}
          {th("lot", "Лот")}{th("fur", "Мех")}{th("size", "Размер, сорт")}
          {th("qty", "Шкур", "right")}{th("unit", `За шкуру, ${c}`, "right")}{th("total", `Сумма, ${c}`, "right")}
          {partCols.map((g) => <Th key={g.key} className="text-right">{g.title}</Th>)}
        </Tr>
      </Thead>
      <Tbody>
        {sorted.map((r) => (
          <Tr key={r.id} className={openId === r.id ? "bg-amber-50" : ""}>
            {showInvoice && <Td>{r.invoice || "—"}</Td>}
            <Td><Link href={lotHref(r.id)} scroll={false} aria-expanded={openId === r.id} className="inline-flex min-h-11 items-center font-medium text-blue-700 underline md:min-h-0">{r.lot || "без №"}</Link></Td>
            <Td>{r.fur}</Td><Td className="max-w-[14rem]"><Clamp>{r.size || "—"}</Clamp></Td>
            <Td className="text-right tabular-nums">{num(r.qty)}</Td><Td className="text-right tabular-nums">{money(r.unit)}</Td><Td className="text-right tabular-nums">{money(r.total)}</Td>
            {partCols.map((g) => <Td key={g.key} className="text-right tabular-nums">{r.parts ? money(r.parts[g.key] ?? 0) : "—"}</Td>)}
          </Tr>
        ))}
        {rows.length > 1 && (
          <Tr className="font-semibold">
            <Td colSpan={showInvoice ? 4 : 3}>{totalLabel}</Td>
            <Td className="text-right tabular-nums">{num(rows.reduce((a, r) => a + r.qty, 0))}</Td><Td />
            <Td className="text-right tabular-nums">{money(rows.reduce((a, r) => a + r.total, 0))}</Td>
            {partCols.map((g) => <Td key={g.key} className="text-right tabular-nums">{money(rows.reduce((a, r) => a + (r.parts?.[g.key] ?? 0), 0))}</Td>)}
          </Tr>
        )}
      </Tbody>
    </Table>
  );
}

/** «Из чего сложилась цена» одного лота: статьи расчёта на шкуру и на весь лот. */
export function LotCompose({ title, lines, qty, unit, total, closeHref, cur = "₽" }: {
  title: string; lines: { label: string; letter?: string; perUnit: number; total: number; manual?: boolean }[]; qty: number; unit: number; total: number; closeHref: string; cur?: string;
}) {
  return (
    <section id="lot-detail" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">Из чего сложилась цена: {title}</h3>
        <Link href={closeHref} scroll={false} className="ml-auto inline-flex min-h-11 items-center text-sm text-blue-700 underline md:min-h-0">Закрыть</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead><tr className="text-left text-xs text-neutral-500"><th scope="col" className="py-1 pr-3 font-medium">Статья</th><th scope="col" className="px-2 py-1 text-right font-medium">За шкуру, {cur}</th><th scope="col" className="py-1 pl-2 text-right font-medium">На {num(qty)} шк., {cur}</th></tr></thead>
          <tbody>
            {lines.filter((l) => Math.abs(l.total) > 0.005 || Math.abs(l.perUnit) > 0.005).map((l, i) => (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-1 pr-3">{l.label}{l.manual && <span className="ml-2 rounded bg-amber-100 px-1 text-[11px] text-amber-800">вручную</span>}</td>
                <td className="px-2 py-1 text-right tabular-nums">{money(l.perUnit)}</td><td className="py-1 pl-2 text-right tabular-nums">{money(l.total)}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td className="py-1.5">Итого по лоту</td><td className="px-2 py-1.5 text-right tabular-nums">{money(unit)}</td><td className="py-1.5 pl-2 text-right tabular-nums">{money(total)}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
