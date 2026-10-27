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
  // Проценты 0…100: 0 допустим («не использовать остатки», «аксессуарам остатки не отдаём»); «из новой покупки» — не меньше 1 (делитель).
  const pct = (v: unknown, min = 0) => { const x = Number(v); return Number.isFinite(x) ? Math.min(100, Math.max(min, Math.round(x * 10) / 10)) : 70; };
  const left: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.left ?? {})) { const x = Number(v); if (Number.isFinite(x) && x >= 0) left[s(k, 40)] = Math.min(1e8, x); }
  const mx = p.mix && Number.isFinite(Number(p.mix.mink)) && Number.isFinite(Number(p.mix.sable)) ? { mink: Math.min(1e8, Math.max(0, Number(p.mix.mink))), sable: Math.min(1e8, Math.max(0, Number(p.mix.sable))) } : null;
  await putPcs(orgId, d.id, { ...d, params: { leftoverPct: pct(p.leftoverPct), lynxPct: pct(p.lynxPct), newPct: pct(p.newPct, 1), accPct: pct(p.accPct ?? 75), upPct: Math.min(500, Math.max(0, Math.round(Number(p.upPct ?? 10) * 10) / 10) || 0), left, mix: mx }, updatedBy: session.user.name ?? null });
  revalidateAll();
  return { ok: true };
}

// ── Фото из презентации FW27/28: заменить, добавить (в том числе туда, где фото ещё нет), править количество и подпись, удалить своё ──
const FW27_FILE = /^(\d{2}-\d{1,2}|c-[a-z0-9]{6,12})\.jpg$/;
type Fw27 = import("@/lib/fw27-presentation").Fw27Data;
async function fw27Load(orgId: string) {
  const { prisma } = await import("@/lib/prisma");
  const { FW27_STATE } = await import("@/lib/fw27-presentation");
  const key = { organizationId_key: { organizationId: orgId, key: FW27_STATE } };
  const cur = await prisma.systemState.findUnique({ where: key, select: { value: true } });
  return { prisma, key, data: (cur?.value as Fw27 | undefined) ?? null, FW27_STATE };
}
/** Файл из формы → JPEG до 640×900 в uploads/fw27/<file>. Возвращает текст ошибки или null. */
async function fw27SaveImage(up: unknown, file: string): Promise<string | null> {
  if (!(up instanceof File) || up.size === 0) return "Файл не выбран";
  if (up.size > 8 * 1024 * 1024) return "Файл больше 8 МБ";
  if (!/^image\/(jpeg|png|webp)$/.test(up.type)) return "Нужна картинка JPG, PNG или WebP";
  const sharp = (await import("sharp")).default;
  const buf = await sharp(Buffer.from(await up.arrayBuffer())).rotate().resize({ width: 640, height: 900, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "uploads", "fw27");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), buf);
  return null;
}
const pcsOf = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 100000) : null; };

/** Заменить фото из презентации: файл (jpg/png/webp, до 8 МБ) сжимается и ложится на место прежнего; версия в описании обновляется. */
export async function replaceFw27Photo(formData: FormData): Promise<Res<{ v: number }>> {
  const session = await requireRole(...EDIT);
  const file = s(formData.get("file_name"), 20);
  if (!FW27_FILE.test(file)) return { ok: false, error: "Неверное имя фото" };
  const { prisma, key, data } = await fw27Load(session.user.organizationId);
  if (!data || !data.slides.some((sl) => sl.items.some((it) => it.file === file))) return { ok: false, error: "Фото не найдено в презентации" };
  const err = await fw27SaveImage(formData.get("file"), file);
  if (err) return { ok: false, error: err };
  const v = Date.now();
  const next: Fw27 = { ...data, slides: data.slides.map((sl) => ({ ...sl, items: sl.items.map((it) => (it.file === file ? { ...it, v } : it)) })) };
  await prisma.systemState.update({ where: key, data: { value: next as object } });
  revalidateAll();
  return { ok: true, v };
}

/** Добавить фото к строке плана: мех, категория, длина (или без длины), «CO / новые», количество и подпись. Нет слайда для такой строки — создаётся «Добавлено вручную». */
export async function addFw27Photo(formData: FormData): Promise<Res<{ file: string }>> {
  const session = await requireRole(...EDIT);
  const fur = s(formData.get("fur"), 40), cat = s(formData.get("cat"), 60), len = s(formData.get("len"), 10);
  const kind = s(formData.get("kind"), 4) === "CO" ? "CO" : "NEW";
  if (!fur || !cat) return { ok: false, error: "Укажите мех и категорию" };
  if (len && !["Short", "Regular", "Long"].includes(len)) return { ok: false, error: "Неверная длина" };
  const { prisma, key, data, FW27_STATE } = await fw27Load(session.user.organizationId);
  const base: Fw27 = data ?? { source: "добавлено вручную", asOf: new Date().toISOString().slice(0, 10), slides: [] };
  const file = `c-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const err = await fw27SaveImage(formData.get("file"), file);
  if (err) return { ok: false, error: err };
  const pcs = pcsOf(formData.get("pcs"));
  const item = { id: file.replace(".jpg", ""), file, pcs, pcsText: pcs === null ? null : `${pcs} pcs`, caption: s(formData.get("caption"), 120) || null, v: Date.now() };
  const slides = [...base.slides];
  const at = slides.findIndex((sl) => sl.page === 0 && sl.fur === fur && sl.cat === cat && (sl.len ?? "") === len && sl.kind === kind);
  if (at >= 0) slides[at] = { ...slides[at], items: [...slides[at].items, item] };
  else slides.push({ page: 0, title: kind === "CO" ? `CO: ${fur} · ${cat} (добавлено вручную)` : `Новые модели: ${fur} · ${cat} (добавлено вручную)`, kind, fur, cat, len: (len || null) as Fw27["slides"][number]["len"], items: [item] });
  const value = { ...base, slides } as object;
  await prisma.systemState.upsert({ where: key, create: { organizationId: session.user.organizationId, key: FW27_STATE, value }, update: { value } });
  revalidateAll();
  return { ok: true, file };
}

/** Править количество и подпись под фото (пустое количество — «без числа»). */
export async function updateFw27Item(file: string, patch: { pcs: string; caption: string }): Promise<Res> {
  const session = await requireRole(...EDIT);
  if (!FW27_FILE.test(file)) return { ok: false, error: "Неверное имя фото" };
  const { prisma, key, data } = await fw27Load(session.user.organizationId);
  if (!data) return { ok: false, error: "Презентация не загружена" };
  const pcs = pcsOf(patch.pcs);
  const next: Fw27 = { ...data, slides: data.slides.map((sl) => ({ ...sl, items: sl.items.map((it) => (it.file === file ? { ...it, pcs, pcsText: pcs === null ? null : `${pcs} pcs`, caption: s(patch.caption, 120) || null } : it)) })) };
  await prisma.systemState.update({ where: key, data: { value: next as object } });
  revalidateAll();
  return { ok: true };
}

/** Удалить добавленное вручную фото (фото из PDF не удаляются, их можно заменить). */
export async function deleteFw27Photo(file: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  if (!/^c-[a-z0-9]{6,12}\.jpg$/.test(file)) return { ok: false, error: "Удалять можно только добавленные вручную фото" };
  const { prisma, key, data } = await fw27Load(session.user.organizationId);
  if (!data) return { ok: false, error: "Презентация не загружена" };
  const slides = data.slides.map((sl) => ({ ...sl, items: sl.items.filter((it) => it.file !== file) })).filter((sl) => sl.page !== 0 || sl.items.length > 0);
  await prisma.systemState.update({ where: key, data: { value: { ...data, slides } as object } });
  const { unlink } = await import("node:fs/promises");
  const path = await import("node:path");
  await unlink(path.join(process.cwd(), "uploads", "fw27", file)).catch(() => undefined);
  revalidateAll();
  return { ok: true };
}
