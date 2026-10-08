"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { registerOrganization, type RegisterField, type RegisterState } from "./actions";
import { Input, Label } from "@/components/ui/input";
import { AuthShell, FIELD, FOOTER_LINK, FormError, PasswordField, SubmitButton } from "@/components/auth/auth-kit";

const initialState: RegisterState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(registerOrganization, initialState);

  // После ошибки фокус сразу на поле, которое нужно исправить (или на первое, если поле неизвестно).
  useEffect(() => {
    if (!state.error) return;
    document.getElementById(state.field ?? "companyName")?.focus();
  }, [state]);

  const invalid = (field: RegisterField) => state.field === field;
  const errorFor = (field: RegisterField) => (invalid(field) ? "register-error" : undefined);

  return (
    <AuthShell
      title="Регистрация компании"
      description="Вы станете владельцем и сможете добавить сотрудников."
      footer={
        <>
          Уже есть аккаунт?{" "}
          <Link href="/login" className={FOOTER_LINK}>
            Войти
          </Link>
        </>
      }
    >
      <form
        action={formAction}
        className="mt-6 flex flex-col gap-4 [&_input:-webkit-autofill]:[box-shadow:0_0_0_1000px_white_inset]"
      >
        <div>
          <Label htmlFor="companyName">Название компании</Label>
          <Input
            id="companyName"
            name="companyName"
            required
            placeholder="ООО «Мех Стиль»"
            autoComplete="organization"
            defaultValue={state.values?.companyName ?? ""}
            aria-invalid={invalid("companyName") || undefined}
            aria-describedby={errorFor("companyName")}
            className={FIELD}
          />
        </div>
        <div>
          <Label htmlFor="name">Ваше имя</Label>
          <Input
            id="name"
            name="name"
            required
            placeholder="Иван Иванов"
            autoComplete="name"
            defaultValue={state.values?.name ?? ""}
            aria-invalid={invalid("name") || undefined}
            aria-describedby={errorFor("name")}
            className={FIELD}
          />
        </div>
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
            defaultValue={state.values?.email ?? ""}
            aria-invalid={invalid("email") || undefined}
            aria-describedby={errorFor("email")}
            className={FIELD}
          />
        </div>
        <PasswordField
          autoComplete="new-password"
          invalid={invalid("password")}
          errorId="register-error"
          minLength={8}
          hint="Минимум 8 символов"
        />

        {state.error && <FormError id="register-error">{state.error}</FormError>}

        <SubmitButton pending={pending} label="Зарегистрироваться" pendingLabel="Создаём…" />
      </form>
    </AuthShell>
  );
}
