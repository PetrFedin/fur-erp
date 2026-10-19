import { InfoHint } from "./info-hint";
import { Money } from "./money";
import { formatMoney } from "@/lib/utils";
import { vatKindLabel, type VatBreakdown } from "@/lib/tz-vat";
import { TzVatHintBody } from "./tz-vat-hint";

const TONE: Record<string, string> = {
  "20": "border-sky-300 bg-sky-50 text-sky-800",
  "22": "border-violet-300 bg-violet-50 text-violet-800",
  mixed: "border-amber-300 bg-amber-50 text-amber-800",
  other: "border-neutral-300 bg-neutral-50 text-neutral-700",
  none: "border-neutral-200 text-neutral-500",
};

/**
 * «НДС: 20% / 22% / смешанный (доля 20%: X ₽)» по списаниям ТЗ + подсказка с разбивкой по ставкам.
 * Ставка берётся у лота каждой строки; суммы — построчные, не одной общей ставкой.
 */
export function TzVatBadge({ b, compact = false, hint = true, className = "" }: { b: VatBreakdown; compact?: boolean; hint?: boolean; className?: string }) {
  if (b.kind === "none") return <span className="text-neutral-500">—</span>;
  const total = b.rows.reduce((s, r) => s.add(r.incl), b.share20.incl.mul(0));
  const totalExcl = b.rows.reduce((s, r) => s.add(r.excl), total.mul(0));
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <span className={`rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${TONE[b.kind]}`}>
        {compact ? "" : "НДС: "}
        {vatKindLabel(b)}
      </span>
      {b.kind === "mixed" && !compact && (
        <span className="text-xs text-neutral-600">
          доля 20 %: <Money incl={b.share20.incl} excl={b.share20.excl} />
        </span>
      )}
      {hint && <InfoHint label="Ставки НДС в списаниях ТЗ">
        <TzVatHintBody
          rows={b.rows.map((r) => ({ rate: String(r.rate), lines: r.lines, incl: formatMoney(r.incl.toFixed(2)), excl: formatMoney(r.excl.toFixed(2)), vat: formatMoney(r.incl.sub(r.excl).toFixed(2)) }))}
          total={b.rows.length > 1 ? { lines: b.rows.reduce((s, r) => s + r.lines, 0), incl: formatMoney(total.toFixed(2)), excl: formatMoney(totalExcl.toFixed(2)), vat: formatMoney(total.sub(totalExcl).toFixed(2)) } : null}
        />
      </InfoHint>}
    </span>
  );
}
