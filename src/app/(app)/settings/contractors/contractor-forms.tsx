"use client";

import { useActionState } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateForm, DialogButtons } from "@/components/create-dialog";
import type { ContractorFormState } from "./actions";

type Contractor = { name: string; inn: string | null; contactName: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; suppliesRaw: boolean };

/** Реквизиты подрядчика: создание (в окне) и правка (на карточке). */
export function ContractorForm({ action, contractor }: { action: (p: ContractorFormState, fd: FormData) => Promise<ContractorFormState>; contractor?: Contractor }) {
  const { state, pending, saved, dlg, setForm, onSubmit } = useCreateForm(action, {});
  return (
    <form ref={setForm} onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div className="col-span-full">
        <Label htmlFor="c-name">Название</Label>
        <Input id="c-name" name="name" required defaultValue={contractor?.name} />
      </div>
      <div><Label htmlFor="c-inn">ИНН</Label><Input id="c-inn" name="inn" defaultValue={contractor?.inn ?? ""} /></div>
      <div><Label htmlFor="c-contact">Контактное лицо</Label><Input id="c-contact" name="contactName" defaultValue={contractor?.contactName ?? ""} /></div>
      <div><Label htmlFor="c-phone">Телефон</Label><Input id="c-phone" name="phone" defaultValue={contractor?.phone ?? ""} /></div>
      <div><Label htmlFor="c-email">Email</Label><Input id="c-email" name="email" type="email" defaultValue={contractor?.email ?? ""} /></div>
      <div className="col-span-full sm:col-span-2"><Label htmlFor="c-address">Адрес и реквизиты</Label><Input id="c-address" name="address" defaultValue={contractor?.address ?? ""} /></div>
      <div className="col-span-full">
        <Label htmlFor="c-notes">Заметки</Label>
        <Textarea id="c-notes" name="notes" rows={3} defaultValue={contractor?.notes ?? ""} />
      </div>
      <label className="col-span-full flex items-center gap-2 text-sm">
        <input type="checkbox" name="suppliesRaw" defaultChecked={contractor?.suppliesRaw ?? false} className="h-4 w-4" />
        Также поставляет сырьё (в его кабинете будут «Аукционы» и «Сырьё»)
      </label>
      {state.error && <p className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <DialogButtons pending={pending} withMore={Boolean(dlg) && !contractor} saved={saved} onCancel={dlg?.close} />
    </form>
  );
}

/** Добавление договора подрядчика: номер, дата, вид. */
export function ContractForm({ action }: { action: (p: ContractorFormState, fd: FormData) => Promise<ContractorFormState> }) {
  const [state, formAction, pending] = useActionState(action, {} as ContractorFormState);
  return (
    <form action={formAction} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div><Label htmlFor="k-number">Номер</Label><Input id="k-number" name="number" required placeholder="1605" /></div>
      <div><Label htmlFor="k-date">Дата</Label><Input id="k-date" name="date" type="date" /></div>
      <div>
        <Label htmlFor="k-kind">Вид</Label>
        <Select id="k-kind" name="kind" defaultValue="WORK">
          <option value="WORK">Подряд (пошив)</option>
          <option value="SUPPLY">Купля-продажа сырья</option>
        </Select>
      </div>
      <div><Label htmlFor="k-note">Примечание</Label><Input id="k-note" name="note" /></div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Сохраняю…" : "Добавить договор"}</Button>
      {state.error && <p className="col-span-full text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="col-span-full text-sm text-emerald-700">Договор добавлен</p>}
    </form>
  );
}

/** «Создать доступ в кабинет»: email, имя и временный пароль (пусто — сгенерируется и покажется один раз). */
export function CabinetAccessForm({ action, defaultEmail }: { action: (p: ContractorFormState & { password?: string }, fd: FormData) => Promise<ContractorFormState & { password?: string }>; defaultEmail: string }) {
  const [state, formAction, pending] = useActionState(action, {} as ContractorFormState & { password?: string });
  return (
    <form action={formAction} autoComplete="off" className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div><Label htmlFor="a-name">Имя в кабинете</Label><Input id="a-name" name="name" required /></div>
      <div><Label htmlFor="a-email">Email (логин)</Label><Input id="a-email" name="email" type="email" required defaultValue={defaultEmail} /></div>
      <div><Label htmlFor="a-pass">Временный пароль</Label><Input id="a-pass" name="password" type="password" autoComplete="new-password" placeholder="пусто — сгенерировать" /></div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Создаю…" : "Создать доступ"}</Button>
      {state.error && <p className="col-span-full text-sm text-red-700">{state.error}</p>}
      {state.ok && (
        <p className="col-span-full rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Доступ создан.{state.password ? <> Временный пароль (показан один раз, передайте подрядчику): <b className="select-all font-mono">{state.password}</b></> : " Пароль — тот, что вы ввели."}
        </p>
      )}
    </form>
  );
}
