import type { MaterialVatSummary } from "@/lib/material-vat";

/** Ячейка «НДС в ТЗ»: ставка по умолчанию либо ставки лотов с разбивкой до/с 2026. */
export function MaterialVatCell({ s }: { s: MaterialVatSummary }) {
  return (
    <div className="min-w-[10rem]">
      {s.defaultRate != null ? (
        <span className="font-medium">{s.defaultRate}% <span className="text-[11px] font-normal text-neutral-500">у материала</span></span>
      ) : s.groups.length === 0 ? (
        <span className="text-neutral-400">—</span>
      ) : (
        <span className="font-medium">
          {s.groups.map((g, i) => (
            <span key={g.rate} title={`до 2026: ${g.before2026}, с 2026: ${g.from2026}`}>
              {i > 0 ? " · " : ""}
              {g.rate}% <span className="font-normal text-neutral-500">(лотов {g.lots})</span>
            </span>
          ))}
        </span>
      )}
      <span className="block text-[11px] leading-tight text-neutral-500">
        {s.defaultRate != null ? "задана у материала" : s.groups.length ? "в ТЗ — ставка лота, на который списано" : "ставка лота / по дате закупки"}
      </span>
      {s.groups.length > 0 && s.defaultRate != null && (
        <span className="block text-[11px] leading-tight text-neutral-400">лоты: {s.groups.map((g) => `${g.rate}% ×${g.lots}`).join(", ")}</span>
      )}
      {s.mismatch > 0 && <span className="block text-[11px] leading-tight text-amber-700">ставка расходится с датой закупки: {s.mismatch}</span>}
    </div>
  );
}
