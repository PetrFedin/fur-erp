import { formatMoney, formatQty, formatDec1 } from "@/lib/utils";

/** Подпись лота в списке правки списания (одна и та же при показе строки и в раскрытом списке): номер, материал, остаток, цена за единицу с НДС и ставка НДС лота. */
export function lotOptionLabel(l: { lotNumber: string | null; grade: string | null; color: string | null; rawMaterialName: string; quantityRemaining: string; unitCost?: string; vatRate?: string }) {
  const price = l.unitCost != null ? ` · ${formatMoney(l.unitCost)}/ед.${l.vatRate != null ? ` · НДС ${Number(l.vatRate)}%` : ""}` : "";
  return `${l.lotNumber ?? "без номера"} · ${l.rawMaterialName}${[l.grade, l.color].filter(Boolean).length ? ` (${[l.grade, l.color].filter(Boolean).join(", ")})` : ""} · ост. ${formatDec1(l.quantityRemaining)}${price}`;
}
