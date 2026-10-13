"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditDialog, Field } from "@/components/edit-dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { setOrderColors, updateProductionBatch } from "../actions";

/** «Изменить» партию: номер, название, год, план, примечание. */
export function BatchEditButton({
  batchId,
  version,
  defaults,
}: {
  batchId: string;
  version: string;
  defaults: { number: string; name: string; year: string; plannedUnits: string; notes: string };
}) {
  const router = useRouter();
  const nextNumber = useRef<number | undefined>(undefined);
  return (
    <EditDialog
      title="Изменить партию"
      variant="outline"
      action={async (fd) => {
        const res = await updateProductionBatch(batchId, fd);
        nextNumber.current = res.number;
        return res;
      }}
      onSaved={() => {
        const n = nextNumber.current;
        if (n !== undefined && String(n) !== defaults.number) router.replace(`/production/batches/${n}`);
      }}
      version={version}
      hint="ТЗ, документы и оплаты остаются привязаны к партии. При смене номера адрес страницы изменится; подтверждение партии сбросится."
    >
      <Field label="Номер партии">
        <Input name="number" inputMode="numeric" pattern="\d{1,4}" defaultValue={defaults.number} required />
      </Field>
      <Field label="Год">
        <Input name="year" inputMode="numeric" pattern="\d{4}" maxLength={4} defaultValue={defaults.year} placeholder="2026" />
      </Field>
      <Field label="Название" wide>
        <Input name="name" defaultValue={defaults.name} maxLength={200} />
      </Field>
      <Field label="План, шт.">
        <Input name="plannedUnits" inputMode="numeric" defaultValue={defaults.plannedUnits} />
      </Field>
      <Field label="Примечание" wide>
        <Input name="notes" defaultValue={defaults.notes} maxLength={2000} />
      </Field>
    </EditDialog>
  );
}

type ColorRow = { colorRefId: string; quantity: string; sizes: string };

/** Цвета составного ТЗ: несколько цветов с количеством и размерами (заменяет набор целиком). */
export function OrderColorsEditButton({
  orderId,
  colors,
  rows,
}: {
  orderId: string;
  colors: { id: string; name: string }[];
  rows: ColorRow[];
}) {
  const [list, setList] = useState<ColorRow[]>(rows.length ? rows : [{ colorRefId: "", quantity: "", sizes: "" }]);
  const version = JSON.stringify(rows.map((r) => [r.colorRefId, r.quantity ? Number(r.quantity) : "", r.sizes]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const upd = (i: number, patch: Partial<ColorRow>) => setList((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <EditDialog
      title="Цвета ТЗ"
      label="Изменить цвета"
      variant="outline"
      action={(fd) => setOrderColors(orderId, fd)}
      version={version}
      wide
      hint="Для составного ТЗ (несколько цветов в одном приложении). Пустой список — цвет берётся из основного поля «Цвет» карточки ТЗ."
    >
      <div className="flex flex-col gap-2 sm:col-span-2">
        {list.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_6rem_auto] items-end gap-2 max-sm:grid-cols-2">
            <Field label={i === 0 ? "Цвет" : ""}>
              <Select name="colorRefId" value={r.colorRefId} onChange={(e) => upd(i, { colorRefId: e.target.value })}>
                <option value="">— выберите —</option>
                {colors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={i === 0 ? "Кол-во" : ""}>
              <Input name="quantity" inputMode="numeric" value={r.quantity} onChange={(e) => upd(i, { quantity: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label={i === 0 ? "Размеры" : ""}>
              <Input name="sizes" value={r.sizes} onChange={(e) => upd(i, { sizes: e.target.value })} placeholder="42, 46" />
            </Field>
            <Button type="button" variant="ghost" size="sm" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label="Убрать строку">
              ×
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setList((l) => [...l, { colorRefId: "", quantity: "", sizes: "" }])}>
            + Ещё цвет
          </Button>
        </div>
      </div>
    </EditDialog>
  );
}
