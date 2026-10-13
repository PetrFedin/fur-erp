import { formatQty } from "@/lib/utils";

/** Подпись лота в списке правки списания (одна и та же при показе строки и в раскрытом списке). */
export function lotOptionLabel(l: { lotNumber: string | null; grade: string | null; color: string | null; rawMaterialName: string; quantityRemaining: string }) {
  return `${l.lotNumber ?? "без номера"} · ${l.rawMaterialName}${[l.grade, l.color].filter(Boolean).length ? ` (${[l.grade, l.color].filter(Boolean).join(", ")})` : ""} · ост. ${formatQty(l.quantityRemaining)}`;
}
