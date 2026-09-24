"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addBomLine } from "../actions";
import type { RawMaterial } from "@prisma/client";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export function BomAddForm({
  productModelId,
  materials,
}: {
  productModelId: string;
  materials: RawMaterial[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const boundAction = addBomLine.bind(null, productModelId);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await boundAction(formData);
        formRef.current?.reset();
      }}
      className="flex items-end gap-2"
    >
      <div className="flex-1">
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
      <div className="w-40">
        <label className="mb-1 block text-xs text-neutral-500">Норма на изделие</label>
        <Input name="quantityPerUnit" type="number" step="0.001" min="0" required />
      </div>
      <Button type="submit" variant="outline">
        Добавить
      </Button>
    </form>
  );
}
