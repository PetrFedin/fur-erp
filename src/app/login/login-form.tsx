"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { loginAction, type LoginState } from "./actions";
import { DemoLogin } from "./demo-login";
import { Input, Label } from "@/components/ui/input";
import { AuthShell, FIELD, FOOTER_LINK, FormError, PasswordField, SubmitButton } from "@/components/auth/auth-kit";

const initialState: LoginState = {};

export function LoginForm({ demoEmail, demoPassword, supplierEmail, supplierPassword, canRegister = false }: { demoEmail?: string; demoPassword?: string; supplierEmail?: string; supplierPassword?: string; canRegister?: boolean }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  // После неудачной попытки email остаётся в поле, а фокус сразу на пароле.
  useEffect(() => {
    if (state.error) document.getElementById("password")?.focus();
  }, [state]);

  const invalid = Boolean(state.error);

  return (
    <AuthShell
      title="Вход"
      description="Закупки, сырьё и себестоимость"
      footer={
        canRegister ? (
          <>
            Нет аккаунта?{" "}
            <Link href="/register" className={FOOTER_LINK}>
              Зарегистрировать компанию
            </Link>
          </>
        ) : undefined
      }
    >
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

        <PasswordField autoComplete="current-password" invalid={invalid} errorId="login-error" />

        {state.error && <FormError id="login-error">{state.error}</FormError>}

        <SubmitButton pending={pending} label="Войти" pendingLabel="Входим…" />
      </form>

      {demoEmail && demoPassword ? <DemoLogin email={demoEmail} password={demoPassword} /> : null}
      {supplierEmail && supplierPassword ? <DemoLogin id="demo-supplier" title="Демо-доступ: кабинет Веллмеха" note="Вход для поставщика: отгрузки, расчёты аукционов, ТЗ, изделия (без цен), справочники." email={supplierEmail} password={supplierPassword} /> : null}
    </AuthShell>
  );
}
