import { cookies } from "next/headers";

// Режим показа «Без 4% | С 4%». Не "use client": читается серверными страницами.
// Cookie `commission4Display`: "on" — показывать с 4%, всё остальное — без 4%.
export type Commission4Mode = "off" | "on";

export const COMMISSION4_COOKIE = "commission4Display";

export function parseCommission4Cookie(value: string | undefined): Commission4Mode {
  return value === "on" ? "on" : "off";
}

/** Текущий режим из cookie (для серверных компонентов с (app) layout). */
export async function getCommission4Mode(): Promise<Commission4Mode> {
  const store = await cookies();
  return parseCommission4Cookie(store.get(COMMISSION4_COOKIE)?.value);
}
