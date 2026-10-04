import { InfoHint } from "./info-hint";
import { Money } from "./money";
import { formatMoney } from "@/lib/utils";
import { vatKindLabel, type VatBreakdown } from "@/lib/tz-vat";

const TONE: Record<string, string> = {
  "20": "border-sky-300 bg-sky-50 text-sky-800",
  "22": "border-violet-300 bg-violet-50 text-violet-800",
  mixed: "border-amber-300 bg-amber-50 text-amber-800",
  other: "border-neutral-300 bg-neutral-50 text-neutral-700",
  none: "border-neutral-200 text-neutral-400",
};

/**
 * «НДС: 20% / 22% / смешанный (доля 20%: X ₽)» по списаниям ТЗ + подсказка с разбивкой по ставкам.
 * Ставка берётся у лота каждой строки; суммы — построчные, не одной общей ставкой.
 */
export function TzVatBadge({ b, compact = false, className = "" }: { b: VatBreakdown; compact?: boolean; className?: string }) {
  if (b.kind === "none") return <span className="text-neutral-400">—</span>;
  const total = b.rows.reduce((s, r) => s.add(r.incl), b.share20.incl.mul(0));
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${TONE[b.kind]}`}>
        {compact ? "" : "НДС: "}
        {vatKindLabel(b)}
      </span>
      {b.kind === "mixed" && !compact && (
        <span className="text-xs text-neutral-600">
          доля 20%: <Money incl={b.share20.incl} excl={b.share20.excl} />
        </span>
      )}
      <InfoHint label="Ставки НДС в списаниях ТЗ">
        <b>Ставки НДС в списаниях этого ТЗ</b>
        <p className="mt-1">
          Ставка НДС — у лота: закупки 2025 г. — 20%, 2026 г. и далее — 22% (по УПД). В одном ТЗ могут быть лоты разных закупок и лет, поэтому и ставки разные.
        </p>
        <table className="mt-1 w-full text-xs">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="pr-2 font-normal">Ставка</th>
              <th className="pr-2 font-normal">Строк</th>
              <th className="pr-2 text-right font-normal">С НДС</th>
              <th className="pr-2 text-right font-normal">Без НДС</th>
              <th className="text-right font-normal">НДС</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.rate}>
                <td className="pr-2">{r.rate}%</td>
                <td className="pr-2">{r.lines}</td>
                <td className="pr-2 text-right">{formatMoney(r.incl.toFixed(2))}</td>
                <td className="pr-2 text-right">{formatMoney(r.excl.toFixed(2))}</td>
                <td className="text-right">{formatMoney(r.incl.sub(r.excl).toFixed(2))}</td>
              </tr>
            ))}
            {b.rows.length > 1 && (
              <tr className="border-t border-neutral-200 font-medium">
                <td className="pr-2">Итого</td>
                <td className="pr-2">{b.rows.reduce((s, r) => s + r.lines, 0)}</td>
                <td className="pr-2 text-right">{formatMoney(total.toFixed(2))}</td>
                <td className="pr-2 text-right">{formatMoney(b.rows.reduce((s, r) => s.add(r.excl), total.mul(0)).toFixed(2))}</td>
                <td className="text-right">{formatMoney(total.sub(b.rows.reduce((s, r) => s.add(r.excl), total.mul(0))).toFixed(2))}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-1">
          Σ с НДС = Σ (количество × цена лота с его ставкой), Σ без НДС = Σ (количество × цена лота без НДС): каждая строка по ставке своего лота, а не итог × одна ставка. Сырьё и подкладка (расходы и работа в таблице не участвуют).
        </p>
      </InfoHint>
    </span>
  );
}
