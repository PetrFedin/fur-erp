"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole, requireSession } from "@/lib/session";
import { deletePcs, getPcs, putPcs } from "@/lib/budget-pcs-store";
import { buildPcsWorkbook } from "@/lib/budget-pcs-xlsx";
import { loadBudgetAvg, withBudgetAvg } from "@/lib/budget-pcs-avg";
import { ST_FILE_LEN, type PcsBlock, type PcsParams, type PcsRow } from "@/lib/budget-pcs";

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
export async function savePcsRows(id: string, rows: { pcs: number; avg: number | null; st?: number[] }[]): Promise<Res<{ at: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const d = await getPcs(orgId, id); if (!d) return { ok: false, error: "Файл не найден" };
  if (!Array.isArray(rows) || rows.length !== d.rows.length) return { ok: false, error: "Состав строк изменился, обновите страницу" };
  const next: PcsRow[] = d.rows.map((r, i) => ({ ...r, pcs: num(rows[i]?.pcs), avg: rows[i]?.avg == null ? null : num(rows[i].avg), st: Array.isArray(rows[i]?.st) ? Array.from({ length: ST_FILE_LEN }, (_, k) => Math.round(num(rows[i].st![k]) * 100) / 100) : r.st, avgText: rows[i]?.avg === r.avg ? r.avgText : null }));
  await putPcs(orgId, id, { ...d, rows: next, updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true, at: new Date().toISOString() };
}
/** Excel: «Данные» — один массив, «Сводная» — сводная таблица, «Отчёт» — как файл MVST. */
export async function exportPcsXlsx(id: string, blocks?: PcsBlock[], hideEmpty?: boolean): Promise<Res<{ name: string; base64: string }>> {
  const session = await requireSession();
  const d = await getPcs(session.user.organizationId, s(id, 40));
  if (!d) return { ok: false, error: "Файл не найден" };
  const want = (blocks ?? ["RTW", "Acc"]).filter((b) => b === "RTW" || b === "Acc");
  const rows = withBudgetAvg(d.rows, await loadBudgetAvg(session.user.organizationId)).filter((r) => want.includes(r.block));
  const buf = await buildPcsWorkbook({ ...d, rows }, { hideEmpty: hideEmpty === true });
  return { ok: true, name: `${d.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Budget PCS"}${want.length === 1 ? (want[0] === "RTW" ? " RTW" : " Acc") : ""}.xlsx`, base64: buf.toString("base64") };
}

/** Доли использования сырья (проценты) — сохраняются в файле Budget PCS и пересчитывают таблицу «По типам меха». */
export async function savePcsParams(id: string, p: PcsParams): Promise<Res> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const d = await getPcs(orgId, s(id, 40)); if (!d) return { ok: false, error: "Файл не найден" };
  const pct = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? Math.min(100, Math.max(1, Math.round(x * 10) / 10)) : 70; };
  const left: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.left ?? {})) { const x = Number(v); if (Number.isFinite(x) && x >= 0) left[s(k, 40)] = Math.min(1e8, x); }
  const mx = p.mix && Number.isFinite(Number(p.mix.mink)) && Number.isFinite(Number(p.mix.sable)) ? { mink: Math.min(1e8, Math.max(0, Number(p.mix.mink))), sable: Math.min(1e8, Math.max(0, Number(p.mix.sable))) } : null;
  await putPcs(orgId, d.id, { ...d, params: { leftoverPct: pct(p.leftoverPct), lynxPct: pct(p.lynxPct), newPct: pct(p.newPct), accPct: pct(p.accPct ?? 75), upPct: Math.min(500, Math.max(0, Math.round(Number(p.upPct ?? 10) * 10) / 10) || 0), left, mix: mx }, updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true };
}

/** Заменить фото из презентации FW27: загруженный файл (jpg/png/webp, до 8 МБ) сжимается до 640×900 и ложится на место прежнего; версия в описании слайдов обновляется. */
export async function replaceFw27Photo(formData: FormData): Promise<Res<{ v: number }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const file = s(formData.get("file_name"), 20);
  const up = formData.get("file");
  if (!/^\d{2}-\d{1,2}\.jpg$/.test(file)) return { ok: false, error: "Неверное имя фото" };
  if (!(up instanceof File) || up.size === 0) return { ok: false, error: "Файл не выбран" };
  if (up.size > 8 * 1024 * 1024) return { ok: false, error: "Файл больше 8 МБ" };
  if (!/^image\/(jpeg|png|webp)$/.test(up.type)) return { ok: false, error: "Нужна картинка JPG, PNG или WebP" };
  const { prisma } = await import("@/lib/prisma");
  const { FW27_STATE } = await import("@/lib/fw27-presentation");
  type Data = import("@/lib/fw27-presentation").Fw27Data;
  const key = { organizationId_key: { organizationId: orgId, key: FW27_STATE } };
  const cur = await prisma.systemState.findUnique({ where: key, select: { value: true } });
  const data = cur?.value as Data | undefined;
  if (!data || !data.slides.some((sl) => sl.items.some((it) => it.file === file))) return { ok: false, error: "Фото не найдено в презентации" };
  const sharp = (await import("sharp")).default;
  const buf = await sharp(Buffer.from(await up.arrayBuffer())).rotate().resize({ width: 640, height: 900, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "uploads", "fw27");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), buf);
  const v = Date.now();
  const next: Data = { ...data, slides: data.slides.map((sl) => ({ ...sl, items: sl.items.map((it) => (it.file === file ? { ...it, v } : it)) })) };
  await prisma.systemState.update({ where: key, data: { value: next as object } });
  revalidateAll();
  return { ok: true, v };
}
