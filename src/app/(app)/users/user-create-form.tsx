"use client";

import { useState } from "react";
import { Input, Label, Select } from "@/components/ui/input";
import { createUser, type UserFormState } from "./actions";
import { useCreateForm, DialogButtons } from "@/components/create-dialog";

const initialState: UserFormState = {};

const ROLES = [
  { value: "ADMIN", label: "Администратор" },
  { value: "PURCHASER", label: "Закупщик" },
  { value: "WAREHOUSE", label: "Кладовщик" },
  { value: "TECHNOLOGIST", label: "Технолог" },
  { value: "ACCOUNTANT", label: "Бухгалтер" },
  { value: "VIEWER", label: "Наблюдатель" },
  { value: "SUPPLIER", label: "Подрядчик (кабинет)" },
];

export function UserCreateForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [role, setRole] = useState("VIEWER");
  const { state, pending, saved, dlg, setForm, onSubmit } = useCreateForm(createUser, initialState);
  return (
    <form ref={setForm} onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="name">Имя</Label>
        <Input id="name" name="name" required />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div>
        <Label htmlFor="password">Пароль</Label>
        <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
      </div>
      <div>
        <Label htmlFor="role">Роль</Label>
        <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      {role === "SUPPLIER" && (
        <div className="sm:col-span-2">
          <Label htmlFor="supplierId">Подрядчик (чей кабинет)</Label>
          <Select id="supplierId" name="supplierId" defaultValue="" required>
            <option value="" disabled>выберите…</option>
            {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </div>
      )}
      {state.error && <p className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <DialogButtons pending={pending} withMore saved={saved} onCancel={dlg?.close} saveLabel="Создать" />
    </form>
  );
}
