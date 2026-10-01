"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { ClientFormState } from "./actions";
import type { Client } from "@prisma/client";

const initialState: ClientFormState = {};

export function ClientForm({
  action,
  client,
}: {
  action: (prev: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  client?: Client;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <Label htmlFor="name">Название</Label>
        <Input id="name" name="name" required defaultValue={client?.name} />
      </div>
      <div>
        <Label htmlFor="inn">ИНН</Label>
        <Input id="inn" name="inn" defaultValue={client?.inn ?? ""} />
      </div>
      <div>
        <Label htmlFor="contactName">Контактное лицо</Label>
        <Input id="contactName" name="contactName" defaultValue={client?.contactName ?? ""} />
      </div>
      <div>
        <Label htmlFor="phone">Телефон</Label>
        <Input id="phone" name="phone" defaultValue={client?.phone ?? ""} />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={client?.email ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="address">Адрес</Label>
        <Input id="address" name="address" defaultValue={client?.address ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="notes">Заметки</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={client?.notes ?? ""} />
      </div>
      {state.error && (
        <p className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
