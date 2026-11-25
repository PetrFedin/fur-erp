import { formatShare } from "@/lib/utils";
import type { PriceAgg } from "@/lib/analytics-pricing";

type Seg = { key: string; label: string; value: number; cls: string };

function segments(a: PriceAgg): Seg[] {
  return [
    { key: "fur", label: "Мех", value: a.furExcl, cls: "bg-emerald-600" },
    { key: "lin", label: "Подкладка", value: a.liningExcl, cls: "bg-sky-500" },
    { key: "c4", label: "4 %", value: a.c4Excl, cls: "bg-amber-500" },
    { key: "vat", label: "НДС в материалах", value: a.vat, cls: "bg-neutral-400" },
    { key: "exp", label: "Расходы ТЗ", value: a.expenses, cls: "bg-violet-500" },
    { key: "work", label: "Работа", value: a.work, cls: "bg-rose-500" },
  ].filter((s) => s.value > 0.005);
}

export function Bar({ a }: { a: PriceAgg }) {
  const segs = segments(a);
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <span className="text-neutral-500">–</span>;
  return (
    <div className="min-w-32">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={segs.map((s) => `${s.label} ${formatShare(s.value / total)}`).join(", ")}>
        {segs.map((s) => (
          <span key={s.key} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${formatShare(s.value / total)}`} />
        ))}
      </div>
      <div className="mt-0.5 text-[11px] leading-tight text-neutral-500">
        {segs.map((s) => `${s.label} ${formatShare(s.value / total)}`).join(" · ")}
      </div>
    </div>
  );
}
