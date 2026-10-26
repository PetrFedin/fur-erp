"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole, requireSession } from "@/lib/session";
import { deletePcs, getPcs, putPcs } from "@/lib/budget-pcs-store";
import { buildPcsWorkbook } from "@/lib/budget-pcs-xlsx";
import type { PcsRow } from "@/lib/budget-pcs";

const EDIT = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const s = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);
const newId = () => Math.random().toString(36).slice(2, 10);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, 1e7) : 0);

export async function createPcs(v: { name: string; season: string; fromId?: string }): Promise<Res<{ id: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const name = s(v.name); if (!name) return { ok: false, error: "Укажите название" };
  const src = v.fromId ? await getPcs(orgId, v.fromId) : null;
  const id = newId();
  await putPcs(orgId, id, { name, season: s(v.season, 40), supplier: src?.supplier ?? "", asOf: src?.asOf ?? { RTW: "", Acc: "" }, rows: src?.rows ?? [], createdAt: new Date().toISOString(), updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true, id };
}
export async function renamePcs(id: string, name: string, season: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const d = await getPcs(orgId, id); if (!d) return { ok: false, error: "Файл не найден" };
  if (!s(name)) return { ok: false, error: "Укажите название" };
  await putPcs(orgId, id, { ...d, name: s(name), season: s(season, 40), updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true };
}
export async function duplicatePcs(id: string): Promise<Res<{ id: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const d = await getPcs(orgId, id); if (!d) return { ok: false, error: "Файл не найден" };
  const nid = newId();
  await putPcs(orgId, nid, { ...d, name: `${d.name} (копия)`, createdAt: new Date().toISOString(), updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true, id: nid };
}
export async function removePcs(id: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  await deletePcs(session.user.organizationId, id);
  revalidateAll();
  return { ok: true };
}
/** Сохранение значений: штуки и AVG по строкам (порядок и состав строк не меняются). */
export async function savePcsRows(id: string, rows: { pcs: number; avg: number | null }[]): Promise<Res<{ at: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const d = await getPcs(orgId, id); if (!d) return { ok: false, error: "Файл не найден" };
  if (!Array.isArray(rows) || rows.length !== d.rows.length) return { ok: false, error: "Состав строк изменился, обновите страницу" };
  const next: PcsRow[] = d.rows.map((r, i) => ({ ...r, pcs: num(rows[i]?.pcs), avg: rows[i]?.avg == null ? null : num(rows[i].avg), avgText: rows[i]?.avg === r.avg ? r.avgText : null }));
  await putPcs(orgId, id, { ...d, rows: next, updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true, at: new Date().toISOString() };
}
/** Excel: «Данные» — один массив, «Сводная» — сводная таблица, «Отчёт» — как файл MVST. */
export async function exportPcsXlsx(id: string): Promise<Res<{ name: string; base64: string }>> {
  const session = await requireSession();
  const d = await getPcs(session.user.organizationId, s(id, 40));
  if (!d) return { ok: false, error: "Файл не найден" };
  const buf = await buildPcsWorkbook(d);
  return { ok: true, name: `${d.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Budget PCS"}.xlsx`, base64: buf.toString("base64") };
}
