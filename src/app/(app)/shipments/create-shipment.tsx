"use client";

import { useState } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { CreateDialog, DialogButtons, useCreateForm } from "@/components/create-dialog";
import { todayIso } from "@/lib/shipments";
import { createShipment } from "./actions";

type Opt = { id: string; name: string };

/** «+ Отгрузка»: окно с названием (по умолчанию «Отгрузка <месяц> <год> · N»), поставщиком, партией пошива, плановой датой и примечанием. После «Создать» открывается карточка. */
export function CreateShipmentButton(props: { defaultName: string; suppliers: Opt[]; defaultSupplierId: string; batches: { id: string; label: string }[] }) {
  return (
    <CreateDialog label="+ Отгрузка" title="Новая отгрузка" hint="Состав примерки и этапы добавляются в карточке после создания.">
      <ShipmentCreateForm {...props} />
    </CreateDialog>
  );
}

function ShipmentCreateForm({ defaultName, suppliers, defaultSupplierId, batches }: { defaultName: string; suppliers: Opt[]; defaultSupplierId: string; batches: { id: string; label: string }[] }) {
  const { state, pending, dlg, setForm, onSubmit } = useCreateForm(createShipment, {});
  const [today] = useState(() => todayIso());
  return (
    <form ref={setForm} onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="col-span-full">
        <Label htmlFor="sh-name">Название</Label>
        <Input id="sh-name" name="name" required maxLength={120} defaultValue={defaultName} />
      </div>
      <div>
        <Label htmlFor="sh-supplier">Подрядчик</Label>
        <Select id="sh-supplier" name="supplierId" defaultValue={defaultSupplierId}>
          <option value="">— не указан —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="sh-batch">Партия пошива</Label>
        <Select id="sh-batch" name="batchId" defaultValue="">
          <option value="">— без партии —</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="sh-date">Плановая дата</Label>
        <Input id="sh-date" name="plannedDate" type="date" required defaultValue={today} />
      </div>
      <div>
        <Label htmlFor="sh-fitting">Дата примерки (необязательно)</Label>
        <Input id="sh-fitting" name="fittingDate" type="date" />
        <p className="mt-1 text-xs text-neutral-500">Если указать — в хронологии появится ожидаемый этап «Примерка» (Веллмех).</p>
      </div>
      <div className="col-span-full">
        <Label htmlFor="sh-notes">Примечание</Label>
        <Textarea id="sh-notes" name="notes" rows={3} maxLength={2000} />
      </div>
      {state.error && <p role="alert" className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <DialogButtons pending={pending} saveLabel="Создать" onCancel={dlg?.close} />
    </form>
  );
}
