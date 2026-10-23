"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole } from "@/lib/session";
import { deleteForecast, getForecast, putForecast, type ForecastEdits } from "@/lib/forecast-store";

const EDIT = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const s = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);
const newId = () => Math.random().toString(36).slice(2, 10);

export async function createForecast(v: { name: string; season: string; fromId?: string }): Promise<Res<{ id: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const name = s(v.name, 80);
  if (!name) return { ok: false, error: "Укажите название" };
  const src = v.fromId ? await getForecast(orgId, v.fromId) : null;
  const id = newId();
  await putForecast(orgId, id, { name, season: s(v.season, 40), edits: src?.edits ?? {}, off: src?.off ?? [], createdAt: new Date().toISOString(), updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true, id };
}

export async function renameForecast(id: string, name: string, season: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const d = await getForecast(orgId, id);
  if (!d) return { ok: false, error: "Прогноз не найден" };
  if (!s(name)) return { ok: false, error: "Укажите название" };
  await putForecast(orgId, id, { ...d, name: s(name, 80), season: s(season, 40), updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true };
}

export async function duplicateForecast(id: string): Promise<Res<{ id: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const d = await getForecast(orgId, id);
  if (!d) return { ok: false, error: "Прогноз не найден" };
  const nid = newId();
  await putForecast(orgId, nid, { ...d, name: `${d.name} (копия)`, createdAt: new Date().toISOString(), updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true, id: nid };
}

export async function removeForecast(id: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  await deleteForecast(session.user.organizationId, id);
  revalidateAll();
  return { ok: true };
}

export async function saveForecastEdits(id: string, edits: ForecastEdits, off: string[]): Promise<Res<{ at: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const d = await getForecast(orgId, id);
  if (!d) return { ok: false, error: "Прогноз не найден" };
  const clean: ForecastEdits = {};
  for (const [a, f] of Object.entries(edits ?? {}).slice(0, 500)) {
    const o: ForecastEdits[string] = {};
    for (const k of ["hp", "hidePrice", "mp", "meterPrice", "wp", "extra"] as const) if (f?.[k] !== undefined) o[k] = s(f[k], 20);
    if (Object.keys(o).length) clean[s(a, 120)] = o;
  }
  await putForecast(orgId, id, { ...d, edits: clean, off: (off ?? []).slice(0, 500).map((x) => s(x, 120)), updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true, at: new Date().toISOString() };
}
