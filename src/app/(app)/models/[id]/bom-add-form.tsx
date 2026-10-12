"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addBomLine } from "../actions";
import type { MaterialUnit } from "@prisma/client";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type MaterialOption = { id: string; name: string; unit: MaterialUnit };

export function BomAddForm({
  productModelId,
  materials,
}: {
  productModelId: string;
  materials: MaterialOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const boundAction = addBomLine.bind(null, productModelId);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        const res = await boundAction(formData);
        if (res?.error) {
          setError(res.error);
          return;
        }
        setError(null);
        formRef.current?.reset();
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="flex-1">
        <label className="mb-1 block text-xs text-neutral-500">Материал</label>
        <Select className="ui-field rounded-lg" name="rawMaterialId" required defaultValue="">
          <option value="" disabled>
            Выберите материал
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
        <Input className="ui-field rounded-lg" name="quantityPerUnit" type="number" step="0.001" min="0" required />
      </div>
      <Button type="submit" variant="outline">
        Добавить
      </Button>
      {error ? <p role="alert" className="w-full text-xs text-red-600">{error}</p> : null}
    </form>
  );
}
