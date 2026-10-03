"use server";

import { requireSession } from "@/lib/session";
import { fetchCbrRate } from "@/lib/cbr-rate";

/** Курс ЦБ РФ на дату для подстановки в форму (ничего не сохраняет). date — «ГГГГ-ММ-ДД». */
export async function getCbrRate(currency: string, date: string): Promise<{ rate?: string; date?: string; error?: string }> {
  await requireSession();
  const r = await fetchCbrRate(String(currency ?? ""), String(date ?? ""));
  return "error" in r ? { error: r.error } : { rate: r.rate, date: r.date };
}
