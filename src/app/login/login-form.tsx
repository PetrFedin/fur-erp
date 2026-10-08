"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { loginAction, type LoginState } from "./actions";
import { DemoLogin } from "./demo-login";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const initialState: LoginState = {};

// Один заметный фокус на всех элементах страницы: тёмное кольцо с отступом (≥3:1 на белом).
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2";
const FIELD = `h-11 border-neutral-500 text-base shadow-none placeholder:text-neutral-500 ${FOCUS}`;

export function LoginForm({ demoEmail, demoPassword }: { demoEmail?: string; demoPassword?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // После неудачной попытки email остаётся в поле, а фокус сразу на пароле.
  useEffect(() => {
    if (state.error) document.getElementById("password")?.focus();
  }, [state]);

  const invalid = Boolean(state.error);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-10 text-neutral-900 selection:bg-neutral-900 selection:text-white">
      <div className="w-full max-w-md">
        <p className="mb-6 text-sm font-semibold tracking-[0.18em] text-neutral-900">MVST FUR PRODUCTION</p>

        <Card className="shadow-sm">
          <CardContent className="p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Вход</h1>
            <p className="mt-1 text-sm text-neutral-600">Закупки, склад и себестоимость</p>

            <form
              action={formAction}
              className="mt-6 flex flex-col gap-4 [&_input:-webkit-autofill]:[box-shadow:0_0_0_1000px_white_inset]"
            >
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="you@company.ru"
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  defaultValue={state.email ?? ""}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? "login-error" : undefined}
                  className={FIELD}
                />
              </div>

              <div>
                <Label htmlFor="password">Пароль</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? "login-error" : capsLock ? "caps-hint" : undefined}
                    onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                    onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                    onBlur={() => setCapsLock(false)}
                    className={`${FIELD} pr-28`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-controls="password"
                    className={`absolute right-1 top-1/2 h-9 -translate-y-1/2 rounded-md px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 ${FOCUS}`}
                  >
                    {showPassword ? "Скрыть" : "Показать"}
                  </button>
                </div>
                {capsLock && (
                  <p id="caps-hint" role="status" className="mt-1.5 text-sm text-neutral-700">
                    Включён Caps Lock
                  </p>
                )}
              </div>

              {state.error && (
                <p id="login-error" role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {state.error}
                </p>
              )}

              <Button type="submit" disabled={pending} aria-busy={pending} className={`h-11 w-full text-base ${FOCUS}`}>
                {pending ? (
                  <>
                    <span
                      className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      aria-hidden="true"
                    />
                    Входим…
                  </>
                ) : (
                  "Войти"
                )}
              </Button>
            </form>

            {demoEmail && demoPassword ? <DemoLogin email={demoEmail} password={demoPassword} /> : null}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-neutral-600">
          Нет аккаунта?{" "}
          <Link
            href="/register"
            className={`inline-flex min-h-11 items-center rounded-md px-1 font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-700 ${FOCUS}`}
          >
            Зарегистрировать компанию
          </Link>
        </p>
      </div>
    </main>
  );
}
