"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

// Общие части страниц входа и регистрации. Общие компоненты приложения (Input, Button, Card) не меняем:
// отличия задаём классами здесь, чтобы остальные страницы остались как были.

/** Один заметный фокус: тёмное кольцо с отступом (≥3:1 на белом). */
export const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2";

/** Поле формы: 44px высотой, 16px текстом (без увеличения на iPhone), рамка и плейсхолдер ≥4.5:1. */
export const FIELD = `h-11 border-neutral-500 text-base shadow-none placeholder:text-neutral-500 ${FOCUS}`;

export function AuthShell({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-10 text-neutral-900 selection:bg-neutral-900 selection:text-white">
      <div className="w-full max-w-md">
        <p className="mb-6 text-sm font-semibold tracking-[0.18em] text-neutral-900">MVST FUR PRODUCTION</p>

        <Card className="shadow-sm">
          <CardContent className="p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
            <p className="mt-1 text-sm text-neutral-600">{description}</p>
            {children}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-neutral-600">{footer}</p>
      </div>
    </main>
  );
}

/** Ссылка под карточкой: тихая, но с целью нажатия 44px. */
export const FOOTER_LINK = `inline-flex min-h-11 items-center rounded-md px-1 font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-700 ${FOCUS}`;

export function FormError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}

export function SubmitButton({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} className={`h-11 w-full text-base ${FOCUS}`}>
      {pending ? (
        <>
          <span
            className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/** Поле пароля: показать/скрыть, подсказка про Caps Lock, необязательная подсказка к полю. */
export function PasswordField({
  autoComplete,
  invalid,
  errorId,
  hint,
  minLength,
}: {
  autoComplete: "current-password" | "new-password";
  invalid: boolean;
  errorId: string;
  hint?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const describedBy =
    [invalid ? errorId : null, capsLock ? "caps-hint" : null, hint ? "password-hint" : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div>
      <Label htmlFor="password">Пароль</Label>
      <div className="relative">
        <Input
          id="password"
          name="password"
          type={show ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
          onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
          onBlur={() => setCapsLock(false)}
          className={`${FIELD} pr-28`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-pressed={show}
          aria-controls="password"
          className={`absolute right-1 top-1/2 h-9 -translate-y-1/2 rounded-md px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 ${FOCUS}`}
        >
          {show ? "Скрыть" : "Показать"}
        </button>
      </div>
      {hint && (
        <p id="password-hint" className="mt-1.5 text-sm text-neutral-600">
          {hint}
        </p>
      )}
      {capsLock && (
        <p id="caps-hint" role="status" className="mt-1.5 text-sm text-neutral-700">
          Включён Caps Lock
        </p>
      )}
    </div>
  );
}
