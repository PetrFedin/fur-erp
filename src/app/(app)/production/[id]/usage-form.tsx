"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addMaterialUsage } from "../actions";
import type { MaterialUnit } from "@prisma/client";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type MaterialOption = { id: string; name: string; unit: MaterialUnit };

export function UsageForm({ orderId, materials }: { orderId: string; materials: MaterialOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bound = addMaterialUsage.bind(null, orderId);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        startTransition(async () => {
          const result = await bound(formData);
          setError(result.error ?? null);
          if (!result.error) formRef.current?.reset();
        });
      }}
      className="grid grid-cols-4 items-end gap-2"
    >
      <div className="col-span-2">
        <label className="mb-1 block text-xs text-neutral-500">Сырьё</label>
        <Select name="rawMaterialId" required defaultValue="">
          <option value="" disabled>
            Выберите сырьё
          </option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({UNIT_LABELS[m.unit]})
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
      {error && <p className="col-span-4 text-sm text-red-600">{error}</p>}
    </form>
  );
}
