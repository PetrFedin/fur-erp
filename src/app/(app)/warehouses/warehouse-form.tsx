"use client";

import { Input, Label } from "@/components/ui/input";
import type { WarehouseFormState } from "./actions";
import type { Warehouse } from "@prisma/client";
import { useCreateForm, DialogButtons } from "@/components/create-dialog";

const initialState: WarehouseFormState = {};

export function WarehouseForm({
  action,
  warehouse,
}: {
  action: (prev: WarehouseFormState, formData: FormData) => Promise<WarehouseFormState>;
  warehouse?: Warehouse;
}) {
  const { state, pending, saved, dlg, setForm: keepRef, onSubmit: keepSubmit } = useCreateForm(action, initialState);

  return (
    <form ref={keepRef} onSubmit={keepSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="name">Название</Label>
        <Input id="name" name="name" required defaultValue={warehouse?.name} />
      </div>
      <div>
        <Label htmlFor="address">Адрес</Label>
        <Input id="address" name="address" defaultValue={warehouse?.address ?? ""} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isDefault"
          defaultChecked={warehouse?.isDefault}
          className="h-4 w-4 rounded border-neutral-300"
        />
        Склад по умолчанию
      </label>
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <DialogButtons pending={pending} withMore={Boolean(dlg) && !warehouse} saved={saved} onCancel={dlg?.close} />
    </form>
  );
}
