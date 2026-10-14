"use client";

import { EditDialog, Field } from "@/components/edit-dialog";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { deleteShipment, updateShipmentHeader } from "../actions";

export type HeaderValues = { id: string; name: string; supplierId: string; batchId: string; plannedDate: string; notes: string };

/** «Изменить» шапку отгрузки окном с «Сохранить / Отмена»; несохранённое защищено вопросом при закрытии. */
export function HeaderEdit({ v, suppliers, batches }: { v: HeaderValues; suppliers: { id: string; name: string }[]; batches: { id: string; label: string }[] }) {
  return (
    <EditDialog title="Изменить отгрузку" label="Изменить" variant="outline" action={updateShipmentHeader.bind(null, v.id)} wide>
      <Field label="Название" wide>
        <Input name="name" required maxLength={120} defaultValue={v.name} />
      </Field>
      <Field label="Поставщик">
        <Select name="supplierId" defaultValue={v.supplierId}>
          <option value="">— не указан —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Партия пошива">
        <Select name="batchId" defaultValue={v.batchId}>
          <option value="">— без партии —</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Плановая дата">
        <Input name="plannedDate" type="date" required defaultValue={v.plannedDate} />
      </Field>
      <Field label="Примечание" wide>
        <Textarea name="notes" rows={3} maxLength={2000} defaultValue={v.notes} />
      </Field>
    </EditDialog>
  );
}

/** «Удалить» — пока приёмка не закрыта; удаляется вместе с этапами и составом. */
export function HeaderDelete({ id, name, blockedReason, events, lines }: { id: string; name: string; blockedReason: string | null; events: number; lines: number }) {
  return (
    <DeleteEntityButton
      confirmText={`Удалить отгрузку «${name}» вместе с этапами (${events}) и составом (строк: ${lines})? Это нельзя отменить.`}
      action={deleteShipment.bind(null, id)}
      blockedReason={blockedReason}
      redirectTo="/shipments"
    />
  );
}
