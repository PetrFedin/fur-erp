"use server";

import { headers } from "next/headers";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { loginKey, lockedSeconds, recordFailure, recordSuccess } from "@/lib/rate-limit";

export type LoginState = { error?: string; email?: string };

async function clientIp() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "unknown").slice(0, 64);
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const key = loginKey(email, await clientIp());

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
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      recordFailure(key);
      return { error: "Неверный email или пароль", email };
    }
    // Успешный вход завершается redirect-исключением — сбрасываем счётчик.
    recordSuccess(key);
    throw error;
  }
}
