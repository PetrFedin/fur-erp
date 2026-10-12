"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { VatInput } from "@/components/vat-input";
import { resolveVatRate, vatPeriodLabel } from "@/lib/vat-by-date";
import { addPurchaseItem } from "../actions";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";
import type { MaterialUnit } from "@prisma/client";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type MaterialOption = { id: string; name: string; unit: MaterialUnit; defaultVatRate?: string | null };

export function PurchaseItemForm({
  purchaseId,
  materials,
  currency,
  colorOptions,
  canAddColor,
  purchaseDate,
}: {
  purchaseId: string;
  materials: MaterialOption[];
  currency: string;
  colorOptions: ColorSelectOption[];
  canAddColor: boolean;
  /** Дата закупки (YYYY-MM-DD): по ней подставляется ставка НДС (до 2026 — 20%, с 2026 — 22%). */
  purchaseDate?: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [colorResetKey, setColorResetKey] = useState(0);
  const bound = addPurchaseItem.bind(null, purchaseId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState("");
  const [vat, setVat] = useState<string | null>(null); // null — ставка не правилась вручную
  const auto = resolveVatRate(materials.find((m) => m.id === materialId)?.defaultVatRate ?? null, purchaseDate);
  const vatShown = vat ?? String(auto.rate);
  const vatNum = Number(vatShown.replace(",", "."));
  const vatWarn = purchaseDate && Number.isFinite(vatNum) && vatNum !== auto.byDate
    ? `Ставка ${vatNum}% не совпадает с датой закупки (${vatPeriodLabel(purchaseDate)} → ${auto.byDate}%)`
    : auto.warning;

  // onSubmit вместо action: у <form action> React после действия сбрасывает поля даже при ошибке,
  // и введённое (материал, количество, цена) пропадало. Здесь поля сбрасываются только при успехе.
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        setError(null);
        startTransition(async () => {
          try {
            const res = await bound(fd);
            if (res?.error) {
              setError(res.error);
              return;
            }
            form.reset();
            setMaterialId("");
            setVat(null);
            setColorResetKey((k) => k + 1);
          } catch {
            setError("Не удалось добавить позицию: пропала связь или сервер отклонил запрос.");
          }
        });
      }}
      className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 items-end gap-2"
    >
      <div className="col-span-2">
        <label className="mb-1 block text-xs text-neutral-500">Материал</label>
        <Select name="rawMaterialId" required value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
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
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Кол-во</label>
        <Input name="quantity" type="number" step="0.001" min="0" required />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Цена за ед., {currency} (без НДС)</label>
        <Input name="unitPrice" type="number" step="0.01" min="0" required />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">НДС</label>
        <VatInput name="vatRate" value={vatShown} onChange={(e) => setVat(e.target.value)} required />
        <p className={`mt-0.5 text-[11px] leading-tight ${vatWarn ? "text-amber-700" : "text-neutral-500"}`}>{vatWarn ?? `${vatPeriodLabel(purchaseDate)} · ${auto.source === "material" ? "из справочника" : "по дате"}`}</p>
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
        <ColorSelect key={colorResetKey} refs={colorOptions} canCreate={canAddColor} />
      </div>
      {error && (
        <p role="alert" className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-4 lg:col-span-8">
          {error}
        </p>
      )}
      <div className="col-span-2 sm:col-span-4 lg:col-span-8 flex justify-end">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Добавляем..." : "+ Добавить позицию"}
        </Button>
      </div>
    </form>
  );
}
