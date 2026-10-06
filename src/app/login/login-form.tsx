"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type LoginState } from "./actions";
import { DemoLogin } from "./demo-login";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: LoginState = {};

export function LoginForm({ demoEmail, demoPassword }: { demoEmail?: string; demoPassword?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Вход в MVST FUR PRODUCTION</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required placeholder="you@company.ru" />
            </div>
            <div>
              <Label htmlFor="password">Пароль</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Входим..." : "Войти"}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-neutral-500">
            Нет аккаунта?{" "}
            <Link href="/register" className="font-medium text-neutral-900 underline">Зарегистрировать компанию</Link>
          </p>

          {demoEmail && demoPassword ? <DemoLogin email={demoEmail} password={demoPassword} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
