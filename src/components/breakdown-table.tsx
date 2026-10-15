import { groupBreakdownItems, labelUnit, type BreakdownItem } from "@/lib/cost-breakdown-groups";
import { formatNum } from "@/lib/utils";

const fmt = (n: number) => formatNum(n, 1);

/**
 * «Из чего сложилась цена» одной строкой, как в Excel: сверху группы ①…⑥, ниже подписи статей, под ними значения.
 * Числа и подписи — из отчёта поставщика как есть. Горизонтальная прокрутка, первый столбец закреплён.
 */
export function BreakdownTable({ items, caption }: { items: BreakdownItem[]; caption?: string }) {
  const groups = groupBreakdownItems(items);
  const flat = groups.flatMap((g) => g.items.map((it) => ({ ...it, g: g.key })));
  if (flat.length === 0) return null;
  return (
    <div className="scroll-hint overflow-auto rounded-lg border border-neutral-300 bg-white">
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 min-w-[64px] border-b border-r border-neutral-300 bg-neutral-200 px-2 py-1" />
            {groups.map((g) => (
              <th key={g.key} colSpan={g.items.length} className="border-b border-r border-neutral-300 bg-neutral-200 px-2 py-1 text-left font-semibold text-neutral-700">{g.title}</th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 z-20 border-b border-r border-neutral-300 bg-neutral-100 px-2 py-1 text-left font-normal text-neutral-500">{caption ?? "Статья"}</th>
            {flat.map((it, i) => (
              <th key={i} className="min-w-[96px] max-w-[160px] border-b border-r border-neutral-300 bg-neutral-100 px-2 py-1 text-left align-bottom font-medium leading-tight">{it.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sticky left-0 z-10 border-r border-neutral-200 bg-neutral-100 px-2 py-1.5 text-neutral-500">Значение</td>
            {flat.map((it, i) => {
              const u = labelUnit(it.label);
              return (
                <td key={i} className="border-r border-neutral-200 bg-white px-2 py-1.5 text-right font-mono tabular-nums">
                  {fmt(it.value)}{u ? <span className={`ml-1 ${u === "$" ? "text-sky-700" : "text-neutral-500"}`}>{u}</span> : null}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
