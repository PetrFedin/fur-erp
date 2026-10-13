"use client";

import { useState } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { MaterialFormState } from "./actions";
import type { RawMaterial, RawMaterialCategory } from "@prisma/client";
import { useCreateForm, DialogButtons } from "@/components/create-dialog";
import { VatInput } from "@/components/vat-input";

const initialState: MaterialFormState = {};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type SerializedMaterial = Omit<RawMaterial, "minStockLevel" | "defaultVatRate"> & {
  minStockLevel: string | null;
  defaultVatRate: string | null;
};

export function MaterialForm({
  action,
  material,
  categories,
  defaultUnit,
}: {
  action: (
    prev: MaterialFormState,
    formData: FormData,
  ) => Promise<MaterialFormState>;
  material?: SerializedMaterial;
  categories: RawMaterialCategory[];
  defaultUnit?: string;
}) {
  const { state, pending, saved, dlg, setForm: keepRef, onSubmit: keepSubmit } = useCreateForm(action, initialState);
  const initialVat = material?.defaultVatRate != null ? Number(material.defaultVatRate) : null;
  const [vatMode, setVatMode] = useState<"" | "20" | "22" | "custom">(
    initialVat == null ? "" : initialVat === 20 ? "20" : initialVat === 22 ? "22" : "custom",
  );

  return (
    <form ref={keepRef} onSubmit={keepSubmit} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      <div className="col-span-full">
        <Label htmlFor="name">Название</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={material?.name}
          placeholder="Норка, шкурка выс. сорт"
        />
      </div>
      <div>
        <Label htmlFor="unit">Единица</Label>
        <Select
          id="unit"
          name="unit"
          defaultValue={material?.unit ?? defaultUnit ?? "PIECE"}
          required
        >
          {Object.entries(UNIT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="vatMode">НДС в ТЗ и закупках</Label>
        <Select id="vatMode" value={vatMode} onChange={(e) => setVatMode(e.target.value as typeof vatMode)}>
          <option value="">По лоту / по дате документа</option>
          <option value="20">20% (до 2026)</option>
          <option value="22">22% (с 2026)</option>
          <option value="custom">Своя ставка…</option>
        </Select>
        {vatMode === "custom" ? (
          <VatInput name="defaultVatRate" defaultValue={initialVat != null && initialVat !== 20 && initialVat !== 22 ? String(initialVat) : ""} required className="mt-1" />
        ) : (
          <input type="hidden" name="defaultVatRate" value={vatMode} />
        )}
        <p className="mt-1 text-xs text-neutral-500">
          Для новых закупок и строк ТЗ. Пусто — ставка берётся из лота (в ТЗ) и по дате документа (до 01.01.2026 — 20%, с 2026 — 22%).
        </p>
      </div>
      <details
        className="col-span-full rounded-md border border-neutral-200"
        open={Boolean(
          material?.sku ||
          material?.categoryId ||
          material?.minStockLevel ||
          material?.description,
        )}
      >
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Дополнительно
        </summary>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-neutral-100 p-3">
          <div>
            <Label htmlFor="sku">Артикул</Label>
            <Input id="sku" name="sku" defaultValue={material?.sku ?? ""} />
          </div>
          <div>
            <Label htmlFor="categoryId">Категория</Label>
            <Select
              id="categoryId"
              name="categoryId"
              defaultValue={material?.categoryId ?? ""}
            >
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
          <div className="col-span-full">
            <Label htmlFor="description">Описание</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={material?.description ?? ""}
            />
          </div>
        </div>
      </details>
      {state.error && (
        <p className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <DialogButtons pending={pending} withMore={Boolean(dlg) && !material} saved={saved} onCancel={dlg?.close} />
    </form>
  );
}
