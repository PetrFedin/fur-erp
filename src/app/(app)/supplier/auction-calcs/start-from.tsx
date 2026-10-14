"use client";

import { useRouter } from "next/navigation";
import { Label, Select } from "@/components/ui/input";
import type { StartOption } from "@/lib/supplier-calc-start";

export function StartFrom({ calcs, auctions, current }: { calcs: StartOption[]; auctions: StartOption[]; current: string }) {
  const router = useRouter();
  if (calcs.length === 0 && auctions.length === 0) return null;
  return (
    <div className="max-w-xl">
      <Label>Начать с цифр расчёта</Label>
      <Select value={current} onChange={(e) => router.push(e.target.value ? `/supplier/auction-calcs/new?from=${encodeURIComponent(e.target.value)}` : "/supplier/auction-calcs/new")}>
        <option value="">— с пустого —</option>
        {calcs.length > 0 && <optgroup label="Свой предыдущий расчёт">{calcs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
        {auctions.length > 0 && <optgroup label="Аукцион из справочника (только ставки)">{auctions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
      </Select>
      <p className="mt-1 text-xs text-neutral-500">Копируются ставки, курс, формат и «куда»; лоты остаются примерными — количество и цены вы правите. Расчёт будет «предварительным».</p>
    </div>
  );
}
