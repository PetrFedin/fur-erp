"use client";

import { Input, Label, Textarea } from "@/components/ui/input";
import type { SupplierFormState } from "./actions";
import type { Supplier } from "@prisma/client";
import { useCreateForm, DialogButtons } from "@/components/create-dialog";

const initialState: SupplierFormState = {};

export function SupplierForm({
  action,
  supplier,
}: {
  action: (prev: SupplierFormState, formData: FormData) => Promise<SupplierFormState>;
  supplier?: Supplier;
}) {
  const { state, pending, saved, dlg, setForm: keepRef, onSubmit: keepSubmit } = useCreateForm(action, initialState);

  return (
    <form ref={keepRef} onSubmit={keepSubmit} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      <div className="col-span-full">
        <Label htmlFor="name">Название</Label>
        <Input id="name" name="name" required defaultValue={supplier?.name} />
      </div>
      <div>
        <Label htmlFor="inn">ИНН</Label>
        <Input id="inn" name="inn" defaultValue={supplier?.inn ?? ""} />
      </div>
      <div>
        <Label htmlFor="contactName">Контактное лицо</Label>
        <Input id="contactName" name="contactName" defaultValue={supplier?.contactName ?? ""} />
      </div>
      <div>
        <Label htmlFor="phone">Телефон</Label>
        <Input id="phone" name="phone" defaultValue={supplier?.phone ?? ""} />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={supplier?.email ?? ""} />
      </div>
      <div className="col-span-full">
        <Label htmlFor="address">Адрес</Label>
        <Input id="address" name="address" defaultValue={supplier?.address ?? ""} />
      </div>
      <div className="col-span-full">
        <Label htmlFor="notes">Заметки</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={supplier?.notes ?? ""} />
      </div>
      {state.error && (
        <p className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <DialogButtons pending={pending} withMore={Boolean(dlg) && !supplier} saved={saved} onCancel={dlg?.close} />
    </form>
  );
}
