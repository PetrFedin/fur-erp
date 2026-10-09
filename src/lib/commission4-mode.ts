import { cookies } from "next/headers";

// Режим показа «Без 4% | С 4%». Не "use client": читается серверными страницами.
// Cookie `commission4Display`: "off" — без 4%; по умолчанию (cookie не задан) — С 4%: мы их платим.
export type Commission4Mode = "off" | "on";

export const COMMISSION4_COOKIE = "commission4Display";
/** Режим по умолчанию (cookie не задан): «С 4%» — мы эти 4% платим посреднику сверх. Любой параметр mode без значения берёт его же. */
export const DEFAULT_COMMISSION4_MODE: Commission4Mode = "on";

export function parseCommission4Cookie(_value: string | undefined): Commission4Mode {
  // Переключатель «Без 4%» убран из шапки: режим всегда «С 4%».
  return DEFAULT_COMMISSION4_MODE;
}

/** Текущий режим из cookie (для серверных компонентов с (app) layout). */
export async function getCommission4Mode(): Promise<Commission4Mode> {
  const store = await cookies();
  return parseCommission4Cookie(store.get(COMMISSION4_COOKIE)?.value);
}
