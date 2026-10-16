import "server-only";
// Редактор «Магазин и фото» одного артикула: чтение для окна и сохранение одной операцией.
// Хранение прежнее (миграции не нужны): PLU — свойства артикула «PLU» / «PLU <вариант>», ссылки — SystemState article-shop-links:<id>,
// фото — SystemState article-photos:<id> + файлы в UPLOAD_DIR/article-photos/<организация>/<артикул>/.
import { readFile } from "node:fs/promises";
import type { Prisma, PrismaClient } from "@prisma/client";
import { LINKS_KEY, PHOTOS_KEY, readLinks, readPhotos, type ArticlePhoto, type ShopLink } from "./article-photos";
import { groupPhotosByColor, pluOfItem, variantColorName } from "./article-photo-color";
import { loadAllArticleParams, loadArticleParams, writeArticleParams, PARAMS_MAX, type ArticleParam } from "./article-params";
import { isPluParam } from "./article-photo-match";
import { removeStoredFiles, resolveInside } from "./fitting-files";
import { photoRel } from "./article-photo-upload";
import { buildPluParams, dupWithin, parsePluList, photoDirOk, pluByVariant, pluTakenBy, validateShopUrl, PHOTOS_PER_ARTICLE_MAX, VARIANTS_MAX } from "./article-shop-core";
import { rmdir } from "node:fs/promises";
import path from "node:path";

export type ShopActor = { id: string; name: string | null; role: string; organizationId: string };
export type ShopRow = { key: string; label: string; plu: string; url: string };
export type ShopEditorData = {
  name: string;
  rows: ShopRow[];
  photos: { id: string; variant: string; color?: string }[];
  /** Цвета для «+ Цвет»: из ТЗ артикула и весь справочник цветов. */
  colorsArticle: string[];
  colorsAll: string[];
};
export type ShopPayload = {
  rows: { key: string; plu: string; url: string; label?: string }[];
  photos: { id: string; variant: string; color?: string }[];
  known: string[];
  allowDup?: boolean;
};
export type ShopSaveResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string; dupes?: { plu: string; article: string }[] };

const VARIANT_MAX = 80;
const cleanKey = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, VARIANT_MAX);

/** Данные окна. Только для сотрудников заказчика (вызывающий проверил роль); ссылки и PLU для подрядчика отсюда не уходят. */
export async function loadShopEditor(db: PrismaClient, orgId: string, modelId: string): Promise<ShopEditorData | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(modelId)) return null;
  const model = await db.productModel.findFirst({ where: { id: modelId, organizationId: orgId }, select: { name: true } });
  if (!model) return null;
  const [pRow, lRow, params, refs, ordColors] = await Promise.all([
    db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PHOTOS_KEY + modelId } }, select: { value: true } }),
    db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: LINKS_KEY + modelId } }, select: { value: true } }),
    loadArticleParams(db, orgId, modelId),
    db.colorRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, note: true }, orderBy: { name: "asc" } }),
    db.productionOrderColor.findMany({ where: { order: { productModelId: modelId, organizationId: orgId } }, select: { colorRef: { select: { name: true } } } }),
  ]);
  const photos = readPhotos(pRow?.value);
  const links = readLinks(lRow?.value);
  const labels = new Map(groupPhotosByColor(photos, refs).map((g) => [g.key, g.label]));
  const keys: string[] = [];
  const add = (k: string) => { if (!keys.some((x) => x.toLowerCase() === k.toLowerCase())) keys.push(k); };
  for (const p of photos) add(p.variant);
  for (const l of links) add(l.variant);
  const linkPlu = new Map<string, string>();
  for (const l of links) { const plu = pluOfItem(l.itemId); if (plu && !linkPlu.has(l.variant)) linkPlu.set(l.variant, plu); }
  const plus = pluByVariant(params?.params ?? [], keys, linkPlu);
  for (const k of plus.keys()) add(k);
  const rows: ShopRow[] = keys.map((key) => ({
    key,
    label: labels.get(key) ?? (key ? variantColorName(key, refs) ?? links.find((l) => l.variant === key)?.color ?? key : "Цвет не определён"),
    plu: plus.get(key) ?? (linkPlu.get(key) ?? ""),
    url: links.find((l) => l.variant === key)?.url ?? "",
  }));
  return {
    name: model.name,
    rows,
    photos: photos.map((p) => ({ id: p.id, variant: p.variant, ...(p.color ? { color: p.color } : {}) })),
    colorsArticle: [...new Set(ordColors.map((c) => c.colorRef.name))].sort((a, b) => a.localeCompare(b, "ru")),
    colorsAll: refs.map((r) => r.name),
  };
}

const UUID = /^[0-9a-f-]{8,40}$/i;

function parsePayload(raw: unknown): { ok: true; p: Required<Omit<ShopPayload, "allowDup">> & { allowDup: boolean } } | { ok: false; error: string } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.rows) || !Array.isArray(o.photos) || !Array.isArray(o.known)) return { ok: false, error: "Не удалось прочитать данные формы" };
  if (o.rows.length > VARIANTS_MAX) return { ok: false, error: `Не больше ${VARIANTS_MAX} цветов` };
  if (o.photos.length > PHOTOS_PER_ARTICLE_MAX) return { ok: false, error: `Не больше ${PHOTOS_PER_ARTICLE_MAX} фото на артикул` };
  const rows: ShopPayload["rows"] = [];
  for (const r of o.rows as Record<string, unknown>[]) {
    const key = cleanKey(r?.key);
    if (rows.some((x) => x.key.toLowerCase() === key.toLowerCase())) return { ok: false, error: "Цвет указан дважды" };
    rows.push({ key, plu: String(r?.plu ?? "").slice(0, 400), url: String(r?.url ?? "").slice(0, 600), label: cleanKey(r?.label) });
  }
  const photos: ShopPayload["photos"] = [];
  for (const p of o.photos as Record<string, unknown>[]) {
    const id = String(p?.id ?? "");
    if (!UUID.test(id) || photos.some((x) => x.id === id)) return { ok: false, error: "Фото указано неверно" };
    const variant = cleanKey(p?.variant);
    if (variant && !rows.some((r) => r.key.toLowerCase() === variant.toLowerCase())) return { ok: false, error: "Фото привязано к неизвестному цвету" };
    photos.push({ id, variant: rows.find((r) => r.key.toLowerCase() === variant.toLowerCase())?.key ?? "", color: cleanKey(p?.color) || undefined });
  }
  const known = (o.known as unknown[]).map(String).filter((x) => UUID.test(x));
  return { ok: true, p: { rows, photos, known, allowDup: o.allowDup === true } };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Сохранить PLU, ссылки и фото артикула одной операцией (одна транзакция + строка в журнале изменений).
 * Роль проверяет вызывающий server action; организация — здесь. `db` — НЕ журналирующий клиент (rawPrisma): строку журнала пишем сами.
 * В журнал идут PLU и названия цветов, но не адреса ссылок.
 */
export async function saveShop(db: PrismaClient, actor: ShopActor, modelId: string, raw: unknown): Promise<ShopSaveResult> {
  const orgId = actor.organizationId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(modelId)) return { ok: false, error: "Артикул не найден" };
  const model = await db.productModel.findFirst({ where: { id: modelId, organizationId: orgId }, select: { id: true, name: true } });
  if (!model) return { ok: false, error: "Артикул не найден" };
  const parsed = parsePayload(raw);
  if (!parsed.ok) return parsed;
  const p = parsed.p;

  // PLU и ссылки по цветам
  const byVariant: { variant: string; plus: string[] }[] = [];
  const urls = new Map<string, string>();
  for (const r of p.rows) {
    const pl = parsePluList(r.plu);
    if ("error" in pl) return { ok: false, error: `${r.label || r.key || "Без цвета"}: ${pl.error}` };
    const u = validateShopUrl(r.url);
    if ("error" in u) return { ok: false, error: `${r.label || r.key || "Без цвета"}: ${u.error}` };
    byVariant.push({ variant: r.key, plus: pl.plus });
    if (u.url) urls.set(r.key, u.url);
  }
  const twice = dupWithin(byVariant);
  if (twice.length) return { ok: false, error: `PLU ${twice[0]} указан у двух цветов` };
  const allPlus = byVariant.flatMap((x) => x.plus);
  if (allPlus.length && !p.allowDup) {
    const all = await loadAllArticleParams(db, orgId);
    const names = new Map((await db.productModel.findMany({ where: { organizationId: orgId, id: { in: [...all.keys()] } }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
    const taken = pluTakenBy(all, names, modelId, allPlus);
    if (taken.length) return { ok: false, error: `PLU ${taken[0].plu} уже есть у артикула ${taken[0].article}`, dupes: taken };
  }
  const newPlu = buildPluParams(byVariant);
  if ("error" in newPlu) return { ok: false, error: newPlu.error };

  // текущее состояние
  const pKey = PHOTOS_KEY + modelId, lKey = LINKS_KEY + modelId;
  const [pRow, lRow, cur] = await Promise.all([
    db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: pKey } }, select: { value: true } }),
    db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: lKey } }, select: { value: true } }),
    loadArticleParams(db, orgId, modelId),
  ]);
  if (!cur) return { ok: false, error: "Артикул не найден" };
  const oldPhotos = readPhotos(pRow?.value);
  const oldLinks = readLinks(lRow?.value);
  const oldById = new Map(oldPhotos.map((x) => [x.id, x]));

  // фото: существующие остаются (возможно, с новым цветом), новые должны лежать в каталоге артикула
  const next: ArticlePhoto[] = [];
  let added = 0, recolored = 0;
  for (const ph of p.photos) {
    const old = oldById.get(ph.id);
    if (old) {
      if (old.variant !== ph.variant) {
        recolored += 1;
        const { itemId: _i, color: _c, ...rest } = old; void _i; void _c;
        next.push({ ...rest, variant: ph.variant, ...(ph.color ? { color: ph.color } : {}) });
      } else next.push(old);
      continue;
    }
    const file = photoRel(orgId, modelId, ph.id), thumb = photoRel(orgId, modelId, ph.id, true);
    const abs = resolveInside(file), tAbs = resolveInside(thumb);
    if (!photoDirOk(file, orgId, modelId) || !abs || !tAbs) return { ok: false, error: "Фото не найдено: загрузите его заново" };
    let w = 0, h = 0;
    try {
      await readFile(tAbs);
      const meta = await (await import("sharp")).default(abs).metadata();
      w = meta.width ?? 0; h = meta.height ?? 0;
      if (!w || !h) throw new Error("size");
    } catch { return { ok: false, error: "Фото не найдено: загрузите его заново" }; }
    added += 1;
    next.push({ id: ph.id, file, thumb, w, h, variant: ph.variant, ...(ph.color ? { color: ph.color } : {}) });
  }
  // снятые в окне фото (были при открытии и убраны) удаляем; появившиеся за это время у других людей — сохраняем в конце
  const inPayload = new Set(p.photos.map((x) => x.id));
  const known = new Set(p.known);
  const removed = oldPhotos.filter((x) => known.has(x.id) && !inPayload.has(x.id));
  const extra = oldPhotos.filter((x) => !known.has(x.id) && !inPayload.has(x.id));
  next.push(...extra);
  if (next.length > PHOTOS_PER_ARTICLE_MAX) return { ok: false, error: `Не больше ${PHOTOS_PER_ARTICLE_MAX} фото на артикул` };

  // ссылки: у цвета заменяется первая ссылка; та же ссылка сохраняет код страницы магазина, остальные ссылки цвета не трогаем
  const nextLinks: ShopLink[] = [];
  const handled = new Set<string>();
  for (const l of oldLinks) {
    const row = p.rows.find((r) => r.key.toLowerCase() === l.variant.toLowerCase());
    if (!row) continue; // цвет убран в окне — ссылка уходит вместе с ним
    const key = row.key;
    if (handled.has(key)) { nextLinks.push(l); continue; }
    handled.add(key);
    const u = urls.get(key);
    if (u) nextLinks.push(u === l.url ? l : { variant: key, itemId: "", url: u, ...(l.color ? { color: l.color } : {}) });
  }
  for (const [key, u] of urls) if (!handled.has(key)) nextLinks.push({ variant: key, itemId: "", url: u, ...(p.rows.find((r) => r.key === key)?.label ? { color: p.rows.find((r) => r.key === key)!.label } : {}) });

  // PLU-свойства: заменяем все «PLU…», остальные свойства не трогаем
  const oldPlu = cur.params.filter((x) => isPluParam(x.name));
  const nextParams: ArticleParam[] = [...cur.params.filter((x) => !isPluParam(x.name)), ...newPlu];
  if (nextParams.length > PARAMS_MAX) return { ok: false, error: `Не больше ${PARAMS_MAX} параметров у артикула` };
  const pluChanged = !sameJson(oldPlu.map((x) => [x.name, x.value]).sort(), newPlu.map((x) => [x.name, x.value]).sort());
  const linksChanged = !sameJson(oldLinks, nextLinks);
  const orderChanged = !sameJson(oldPhotos.map((x) => x.id), next.filter((x) => oldById.has(x.id)).map((x) => x.id));
  const photosChanged = added > 0 || removed.length > 0 || recolored > 0 || orderChanged;
  if (!pluChanged && !linksChanged && !photosChanged) return { ok: true, changed: false };

  const parts: string[] = [];
  if (pluChanged) parts.push("PLU");
  if (linksChanged) parts.push("ссылка");
  if (photosChanged) parts.push("фото");
  const labelOf = (k: string) => p.rows.find((r) => r.key === k)?.label || k || "Цвет не определён";
  const changes = {
    article: model.name,
    ...(pluChanged ? { plu: { before: oldPlu.map((x) => `${x.name}: ${x.value}`), after: newPlu.map((x) => `${x.name}: ${x.value}`) } } : {}),
    // адреса ссылок в журнал не пишем: только по каким цветам ссылка поставлена, изменена или убрана
    ...(linksChanged ? { links: { colors: [...new Set([...oldLinks, ...nextLinks].map((l) => labelOf(l.variant)))], before: oldLinks.length, after: nextLinks.length } } : {}),
    ...(photosChanged ? { photos: { added, removed: removed.length, recolored, reordered: orderChanged, total: next.length } } : {}),
  };
  const label = `Изменены ${parts.join("/")} артикула ${model.name}`;
  await db.$transaction(async (tx) => {
    if (photosChanged) {
      if (next.length) await tx.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: pKey } }, create: { organizationId: orgId, key: pKey, value: { photos: next } as unknown as Prisma.InputJsonValue }, update: { value: { photos: next } as unknown as Prisma.InputJsonValue } });
      else await tx.systemState.deleteMany({ where: { organizationId: orgId, key: pKey } });
    }
    if (linksChanged) {
      if (nextLinks.length) await tx.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: lKey } }, create: { organizationId: orgId, key: lKey, value: { links: nextLinks } as unknown as Prisma.InputJsonValue }, update: { value: { links: nextLinks } as unknown as Prisma.InputJsonValue } });
      else await tx.systemState.deleteMany({ where: { organizationId: orgId, key: lKey } });
    }
    if (pluChanged) await writeArticleParams(tx, orgId, modelId, nextParams, cur.legacy);
    await tx.auditLog.create({
      data: { organizationId: orgId, actorId: actor.id, actorName: actor.name, actorRole: actor.role, source: "ui", model: "ArticlePhoto", recordId: modelId, action: "update", label, changes: changes as unknown as Prisma.InputJsonValue },
    });
  });
  // файлы убранных фото — после записи в базе (сбой оставит лишний файл, но не битую ссылку)
  await removeStoredFiles(removed.flatMap((x) => [x.file, x.thumb]).filter((f) => photoDirOk(f, orgId, modelId)));
  if (!next.length) {
    const dir = resolveInside(path.join("article-photos", orgId, modelId));
    if (dir) await rmdir(dir).catch(() => {});
  }
  return { ok: true, changed: true };
}

/** Убрать загруженные, но не сохранённые файлы (кнопка «Отмена»). Трогает только файлы каталога артикула, которых нет в записи. */
export async function discardStaged(db: PrismaClient, orgId: string, modelId: string, ids: unknown): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(modelId) || !Array.isArray(ids)) return;
  const model = await db.productModel.findFirst({ where: { id: modelId, organizationId: orgId }, select: { id: true } });
  if (!model) return;
  const rec = new Set(readPhotos((await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PHOTOS_KEY + modelId } }, select: { value: true } }))?.value).map((x) => x.id));
  const files: string[] = [];
  for (const id of ids.slice(0, PHOTOS_PER_ARTICLE_MAX).map(String)) {
    if (!UUID.test(id) || rec.has(id)) continue;
    files.push(photoRel(orgId, modelId, id), photoRel(orgId, modelId, id, true));
  }
  await removeStoredFiles(files.filter((f) => photoDirOk(f, orgId, modelId)));
}
