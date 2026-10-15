import type { Sheet, CalcPayload, CalcTotals } from "@/lib/supplier-calc";

const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("ru-RU", { maximumFractionDigits: 4 }));

/**
 * Таблица расчёта как лист Excel (только чтение): строка букв, строка названий, строки лотов, итог.
 * Серые ячейки — формулы, белые — ввод, жёлтые — значение вписано вручную. Шапка и первый столбец закреплены.
 * Не клиентский компонент: годится и для серверных страниц (окно «Цена лота», «Входящие»).
 */
export function CalcSheetReadonly({ p, t, rows, highlight, showTotals = true, maxHeight = "60vh", rowLabel }: {
  p: CalcPayload; t: CalcTotals; rows?: number[]; highlight?: number; showTotals?: boolean; maxHeight?: string;
  rowLabel?: (i: number) => string;
}) {
  const sh: Sheet = t.sheet;
  const idx = (rows ?? p.rows.map((_, i) => i)).filter((i) => sh.used[i]);
  return (
    <div className="table-keep scroll-hint overflow-auto rounded-lg border border-neutral-300 bg-white" style={{ maxHeight }}>
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-[44px] border-b border-r border-neutral-300 bg-neutral-200 px-2 py-1 text-center text-[11px] font-normal text-neutral-500" />
            {sh.cols.map((c) => (
              <th key={c.id} className="sticky top-0 z-20 min-w-[84px] border-b border-r border-neutral-300 bg-neutral-200 px-2 py-1 text-center font-mono text-[11px] font-normal text-neutral-600">
                {c.letter}{c.id === sh.unitCol ? <span className="ml-1 rounded bg-emerald-200 px-1 text-[11px] text-emerald-900">в закупку</span> : null}
              </th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 top-[26px] z-30 border-b border-r border-neutral-300 bg-neutral-100 px-2 py-1 text-center text-[11px] font-normal text-neutral-500">№</th>
            {sh.cols.map((c) => (
              <th key={c.id} title={c.formula ? `Формула: ${c.formula}` : c.hint} className="sticky top-[26px] z-20 border-b border-r border-neutral-300 bg-neutral-100 px-2 py-1 text-left align-bottom text-xs font-semibold leading-tight">
                {c.title}{c.unit && !c.title.includes(c.unit) ? <span className="font-normal text-neutral-500">, {c.unit}</span> : null}
                {c.kind !== "input" && <span className="block text-[11px] font-normal text-neutral-400">{c.formula ? c.formula.replace(/^=/, "= ") : "формула"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {idx.map((i) => (
            <tr key={p.rows[i]?._id ?? i} className={highlight === i ? "bg-amber-50" : ""}>
              <td className={`sticky left-0 z-10 border-b border-r border-neutral-200 px-2 py-1 text-center text-xs text-neutral-500 ${highlight === i ? "bg-amber-100 font-semibold" : "bg-neutral-100"}`}>{rowLabel ? rowLabel(i) : i + 1}</td>
              {sh.cols.map((c) => {
                if (c.kind === "input") {
                  const v = p.rows[i]?.[c.id] ?? "";
                  return <td key={c.id} className={`border-b border-r border-neutral-200 px-2 py-1 ${c.text ? "" : "text-right tabular-nums"} ${highlight === i ? "" : "bg-white"}`}>{v}</td>;
                }
                const cell = sh.cells[c.id]?.[i];
                const val = c.id === "total" ? t.calcs[i]?.totalRub : cell?.v;
                return (
                  <td key={c.id} title={cell?.err} className={`border-b border-r border-neutral-200 px-2 py-1 text-right tabular-nums ${cell?.manual ? "bg-amber-100" : highlight === i ? "bg-amber-50" : "bg-neutral-50"} ${cell?.err ? "text-red-700" : ""}`}>
                    {cell?.err ? "ошибка" : fmt(val)}{cell?.manual ? <span className="ml-1 text-[11px] text-amber-700">вруч.</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
          {showTotals && (
            <tr className="font-semibold">
              <td className="sticky bottom-0 left-0 z-20 border-r border-t-2 border-neutral-400 bg-neutral-200 px-2 py-1 text-center text-xs">Итого</td>
              {sh.cols.map((c) => {
                const s = c.id === "total" ? { v: t.totalRub } : sh.sums[c.id];
                return <td key={c.id} className="sticky bottom-0 z-10 border-r border-t-2 border-neutral-400 bg-neutral-200 px-2 py-1 text-right tabular-nums" title={s?.err}>{s ? (s.err ? <span className="text-red-700">ошибка</span> : fmt(s.v)) : ""}</td>;
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
