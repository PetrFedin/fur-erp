"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addMaterialUsage } from "../actions";
import { formatMoney, formatQty } from "@/lib/utils";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export type LotOption = {
  id: string;
  lotNumber: string | null;
  grade: string | null;
  color: string | null;
  rawMaterialId: string;
  rawMaterialName: string;
  unit: string;
  quantityRemaining: string;
  unitCost: string;
};

export function UsageForm({ orderId, lots, defaultCommission4 = true }: { orderId: string; lots: LotOption[]; defaultCommission4?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [materialId, setMaterialId] = useState("");
  const [filter, setFilter] = useState("");
  const bound = addMaterialUsage.bind(null, orderId);

  const materials = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; unit: string }>();
    for (const lot of lots) {
      if (!seen.has(lot.rawMaterialId)) {
        seen.set(lot.rawMaterialId, { id: lot.rawMaterialId, name: lot.rawMaterialName, unit: lot.unit });
      }
    }
    return Array.from(seen.values());
  }, [lots]);

  const filterLower = filter.trim().toLowerCase();
  const lotsForMaterial = lots
    .filter((l) => l.rawMaterialId === materialId)
    .filter((l) =>
      filterLower
        ? [l.lotNumber, l.grade, l.color].some((v) => v?.toLowerCase().includes(filterLower))
        : true
    );

  return (
    <form
      ref={formRef}
      // onSubmit, а не action: React 19 стирает поля формы после action даже при ошибке — человек терял выбор лота и количество.
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await bound(formData);
          setError(result.error ?? null);
          if (!result.error) {
            formRef.current?.reset();
            setMaterialId("");
          }
        });
      }}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-2"
    >
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Материал</label>
        <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
          <option value="" disabled>
            Выберите материал
          </option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({UNIT_LABELS[m.unit] ?? m.unit})
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Поиск лота (номер/сорт/цвет)</label>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="напр. 15874 или Silver"
          disabled={!materialId}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Лот</label>
        <Select name="lotId" required defaultValue="" disabled={!materialId}>
          <option value="" disabled>
            {materialId ? "Выберите лот" : "Сначала выберите материал"}
          </option>
          {lotsForMaterial.map((l) => (
            <option key={l.id} value={l.id}>
              {l.lotNumber ?? "без номера"}
              {[l.grade, l.color].filter(Boolean).length > 0
                ? ` (${[l.grade, l.color].filter(Boolean).join(", ")})`
                : ""}{" "}
              — остаток {formatQty(l.quantityRemaining)} по {formatMoney(l.unitCost)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Количество</label>
        <Input name="quantity" type="number" step="0.001" min="0" required />
      </div>
<label className="flex items-center gap-2 text-xs text-neutral-600 max-md:min-h-8 max-md:py-1" title="4% — доп. комиссия посредника (Веллмех): мы платим на 4% больше за мех и подкладку в ТЗ; работа, расходы, фурнитура и прочее не облагаются">
        <input type="hidden" name="c4form" value="1" />
        <input type="checkbox" name="commission4" defaultChecked={defaultCommission4} className="h-4 w-4 max-md:h-5 max-md:w-5" />
        Начислять 4%
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Списываем..." : "+ Списать"}
      </Button>
      {error && <p className="sm:col-span-2 lg:col-span-5 text-sm text-red-600">{error}</p>}
      {materialId && lotsForMaterial.length === 0 && (
        <p className="sm:col-span-2 lg:col-span-5 text-sm text-amber-700">
          {filter ? "Ничего не найдено по фильтру" : "Нет доступных лотов этого материала на складе"}
        </p>
      )}
    </form>
  );
}
