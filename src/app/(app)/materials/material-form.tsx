"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { MaterialFormState } from "./actions";
import type { RawMaterial, RawMaterialCategory } from "@prisma/client";

const initialState: MaterialFormState = {};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type SerializedMaterial = Omit<RawMaterial, "minStockLevel"> & { minStockLevel: string | null };

export function MaterialForm({
  action,
  material,
  categories,
}: {
  action: (prev: MaterialFormState, formData: FormData) => Promise<MaterialFormState>;
  material?: SerializedMaterial;
  categories: RawMaterialCategory[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label htmlFor="name">Название</Label>
        <Input id="name" name="name" required defaultValue={material?.name} placeholder="Норка, шкурка выс. сорт" />
      </div>
      <div>
        <Label htmlFor="sku">Артикул</Label>
        <Input id="sku" name="sku" defaultValue={material?.sku ?? ""} />
      </div>
      <div>
        <Label htmlFor="unit">Единица измерения</Label>
        <Select id="unit" name="unit" defaultValue={material?.unit ?? "PIECE"} required>
          {Object.entries(UNIT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="categoryId">Категория</Label>
        <Select id="categoryId" name="categoryId" defaultValue={material?.categoryId ?? ""}>
          <option value="">Без категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="minStockLevel">Мин. остаток (для алертов)</Label>
        <Input
          id="minStockLevel"
          name="minStockLevel"
          type="number"
          step="0.001"
          min="0"
          defaultValue={material?.minStockLevel ?? ""}
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor="description">Описание</Label>
        <Textarea id="description" name="description" rows={2} defaultValue={material?.description ?? ""} />
      </div>
      {state.error && (
        <p className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="col-span-2 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
