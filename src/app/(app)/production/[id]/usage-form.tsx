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

export function UsageForm({ orderId, lots }: { orderId: string; lots: LotOption[] }) {
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
      action={(formData) => {
        startTransition(async () => {
          const result = await bound(formData);
          setError(result.error ?? null);
          if (!result.error) {
            formRef.current?.reset();
            setMaterialId("");
          }
        });
      }}
      className="grid grid-cols-5 items-end gap-2"
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
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Списываем..." : "+ Списать"}
      </Button>
      {error && <p className="col-span-5 text-sm text-red-600">{error}</p>}
      {materialId && lotsForMaterial.length === 0 && (
        <p className="col-span-5 text-sm text-amber-600">
          {filter ? "Ничего не найдено по фильтру" : "Нет доступных лотов этого материала на складе"}
        </p>
      )}
    </form>
  );
}
