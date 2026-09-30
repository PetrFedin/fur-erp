"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerOrganization, type RegisterState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const initialState: RegisterState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(registerOrganization, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Регистрация компании</CardTitle>
          <CardDescription>
            Вы станете владельцем и сможете добавить сотрудников.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="companyName">Название компании</Label>
              <Input id="companyName" name="companyName" required placeholder="ООО «Мех Стиль»" />
            </div>
            <div>
              <Label htmlFor="name">Ваше имя</Label>
              <Input id="name" name="name" required placeholder="Иван Иванов" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required placeholder="you@company.ru" />
            </div>
            <div>
              <Label htmlFor="password">Пароль</Label>
              <Input id="password" name="password" type="password" required minLength={8} />
            </div>
            {state.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
            )}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Создаём..." : "Зарегистрироваться"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-neutral-500">
            Уже есть аккаунт?{" "}
            <Link href="/login" className="font-medium text-neutral-900 underline">
              Войти
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
