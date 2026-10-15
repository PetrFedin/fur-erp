"use server";

import { headers } from "next/headers";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { clientIpFrom, loginKeys, lockedSeconds } from "@/lib/rate-limit";

export type LoginState = { error?: string; email?: string };

async function clientIp() {
  return clientIpFrom(await headers());
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const key = loginKeys(email, await clientIp());

  const wait = lockedSeconds(key);
  if (wait > 0) {
    return {
      error: `Слишком много неудачных попыток входа. Повторите через ${Math.max(1, Math.ceil(wait / 60))} мин.`,
      email,
    };
  }

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/", // куда дальше — решает src/app/page.tsx (поставщик попадает на /shipments)
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      // Счётчик неудач ведёт сам вход (src/auth.ts) — так же считается и прямой POST на /api/auth.
      return { error: "Неверный email или пароль", email };
    }
    // Успешный вход завершается redirect-исключением.
    throw error;
  }
}
