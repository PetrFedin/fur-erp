"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addPurchaseItem } from "../actions";
import type { MaterialUnit } from "@prisma/client";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type MaterialOption = { id: string; name: string; unit: MaterialUnit };

export function PurchaseItemForm({
  purchaseId,
  materials,
  currency,
}: {
  purchaseId: string;
  materials: MaterialOption[];
  currency: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const bound = addPurchaseItem.bind(null, purchaseId);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await bound(formData);
        formRef.current?.reset();
      }}
      className="grid grid-cols-7 items-end gap-2"
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
        <label className="mb-1 block text-xs text-neutral-500">Кол-во</label>
        <Input name="quantity" type="number" step="0.001" min="0" required />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Цена за ед., {currency}</label>
        <Input name="unitPrice" type="number" step="0.01" min="0" required />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Лот (если есть)</label>
        <Input name="lotNumber" placeholder="напр. 15016" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Сорт</label>
        <Input name="grade" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Цвет</label>
        <Input name="color" />
      </div>
      <div className="col-span-7 flex justify-end">
        <Button type="submit" variant="outline" size="sm">
          + Добавить позицию
        </Button>
      </div>
    </form>
  );
}
