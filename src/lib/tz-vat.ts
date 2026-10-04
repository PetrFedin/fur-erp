// Ставки НДС в списаниях ТЗ. Ставка — у ЛОТА (RawMaterialLot.vatRate: закупки 2025 — 20%,
// 2026 и далее — 22% по УПД), поэтому в одном ТЗ могут быть списания с разной ставкой
// (например, подкладка 2025 г. по 20% и мех 2026 г. по 22%).
// Суммы считаются построчно (количество × цена лота с её ставкой), а не умножением итога
// на одну общую ставку: Σ с НДС = Σ totalCost строк, Σ без НДС = Σ количество × цена лота без НДС.
import { Decimal } from "@prisma/client/runtime/library";
import { lineWith4, usageInput } from "./commission4";
import type { Commission4Mode } from "./commission4-mode";

export type VatKind = "none" | "20" | "22" | "mixed" | "other";

type UsageForVat = Parameters<typeof usageInput>[0] & { lot: Parameters<typeof usageInput>[0]["lot"] & { vatRate: Decimal.Value } };

export type VatRateRow = {
  rate: number;
  lines: number;
  /** Сумма списаний с НДС и без НДС (с учётом режима «С 4%»). */
  incl: Decimal;
  excl: Decimal;
};

export type VatBreakdown = {
  kind: VatKind;
  /** Группы по ставке, по возрастанию ставки. */
  rows: VatRateRow[];
  /** Сумма списаний по ставке 20% (с НДС / без НДС) — «доля 20%» смешанного ТЗ. */
  share20: { incl: Decimal; excl: Decimal };
};

export function vatBreakdown(usages: UsageForVat[], mode: Commission4Mode): VatBreakdown {
  const map = new Map<number, VatRateRow>();
  for (const u of usages) {
    const rate = Number(new Decimal(u.lot.vatRate).toFixed(2));
    const l = lineWith4(usageInput(u), mode);
    const row = map.get(rate) ?? { rate, lines: 0, incl: new Decimal(0), excl: new Decimal(0) };
    row.lines += 1;
    row.incl = row.incl.add(l.incl);
    row.excl = row.excl.add(l.excl);
    map.set(rate, row);
  }
  const rows = Array.from(map.values()).sort((a, b) => a.rate - b.rate);
  const kind: VatKind =
    rows.length === 0 ? "none" : rows.length > 1 ? "mixed" : rows[0].rate === 20 ? "20" : rows[0].rate === 22 ? "22" : "other";
  const r20 = map.get(20);
  return { kind, rows, share20: { incl: r20?.incl ?? new Decimal(0), excl: r20?.excl ?? new Decimal(0) } };
}

/** Короткая подпись для колонки/бейджа (без суммы). */
export function vatKindLabel(b: Pick<VatBreakdown, "kind" | "rows">): string {
  switch (b.kind) {
    case "none":
      return "—";
    case "mixed":
      return "смешанный";
    case "other":
      return `${b.rows[0].rate}%`;
    default:
      return `${b.kind}%`;
  }
}

/** Значения фильтра «Ставка НДС» в списке ТЗ. */
export const VAT_FILTER: Record<string, string> = { "": "НДС: любая ставка", "20": "Только 20%", "22": "Только 22%", mixed: "Смешанные (20% и 22%)" };

export function matchesVatFilter(kind: VatKind, filter: string): boolean {
  if (!filter) return true;
  return kind === filter;
}
