"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createUser, type UserFormState } from "../actions";
import { useKeepingForm } from "@/lib/use-keeping-form";

const initialState: UserFormState = {};

const ROLES = [
  { value: "ADMIN", label: "Администратор" },
  { value: "PURCHASER", label: "Закупщик" },
  { value: "WAREHOUSE", label: "Кладовщик" },
  { value: "TECHNOLOGIST", label: "Технолог" },
  { value: "ACCOUNTANT", label: "Бухгалтер" },
  { value: "VIEWER", label: "Наблюдатель" },
];

export default function NewUserPage() {
  const [state, formAction, pending] = useActionState(createUser, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);

  return (
    <div className="max-w-md">
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-xl">Новый пользователь</CardTitle>
          <CardDescription>
            Пароль сообщите сотруднику лично.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={keepRef} onSubmit={keepSubmit} className="flex flex-col gap-4">
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
              <Input id="password" name="password" type="password" required minLength={8} />
            </div>
            <div>
              <Label htmlFor="role">Роль</Label>
              <Select id="role" name="role" defaultValue="VIEWER">
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            {state.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Создаём..." : "Создать"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
