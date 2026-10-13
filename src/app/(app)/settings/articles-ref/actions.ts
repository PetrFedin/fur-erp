"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { isUniqueViolation } from "@/lib/input";
import { loadArticleList } from "@/lib/article-ref";
import { articleKey, candidatesFromList, parseAliases, spellingsOf, type ArticleLite } from "@/lib/article-key";
import { parseTableFile } from "@/lib/table-file";
import { parseLength } from "@/lib/length-class";
import { saveArticleCore, articleDeleteBlocker } from "@/lib/article-save";

const ROLES = ACCESS.models;

export type ArticleInput = {
  name: string;
  sku: string;
  category: string;
  categoryRefId?: string;
  salesCode: string;
  salesName: string;
  aliases: string;
  sellingPrice: string;
  /** Short / Regular / Long или пусто. */
  lengthClass: string;
  isActive: boolean;
};
export type Res = { error?: string; ok?: true; id?: string };

const t = (s: string | undefined | null, max: number) => (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Какие написания (ключи) уже заняты другими артикулами: «ключ → артикул». */
function takenKeys(list: ArticleLite[], exceptId: string | null) {
  const m = new Map<string, ArticleLite>();
  for (const a of list) {
    if (a.id === exceptId) continue;
    for (const sp of spellingsOf(a)) if (!m.has(sp.key)) m.set(sp.key, a);
  }
  return m;
}

function conflictOf(list: ArticleLite[], exceptId: string | null, own: { name: string; sku: string; salesCode: string; aliases: string[] }): string | null {
  const taken = takenKeys(list, exceptId);
  const check = (label: string, text: string) => {
    const k = articleKey(text);
    if (!k) return null;
    const o = taken.get(k);
    return o ? `${label} «${text}» уже записан у артикула ${o.name}` : null;
  };
  return (
    check("Код", own.name) ??
    (own.sku ? check("SKU", own.sku) : null) ??
    (own.salesCode ? check("Код в продажах", own.salesCode) : null) ??
    own.aliases.map((a) => check("Написание", a)).find(Boolean) ??
    null
  );
}

/** Тонкая обёртка: запись артикула — ЕДИНЫЙ код saveArticleCore (src/lib/article-save.ts), тот же, что у формы артикула. */
export async function saveArticle(id: string | null, input: ArticleInput): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const r = await saveArticleCore(orgId, session.user.role, id, {
    name: input.name, sku: input.sku, salesCode: input.salesCode, salesName: input.salesName, aliases: input.aliases,
    category: input.category, categoryRefId: input.categoryRefId || null, sellingPrice: input.sellingPrice,
    lengthClass: input.lengthClass, isActive: input.isActive,
  });
  if (r.error) return { error: r.error };
  revalidateAll(orgId);
  return { ok: true, id: r.id };
}

/** Удалить артикул можно, только если на нём ничего нет (ТЗ, план, остатки готовой продукции); иначе — «Активный» выключается. */
export async function deleteArticle(id: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const m = await prisma.productModel.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!m) return { error: "Артикул не найден" };
  const why = await articleDeleteBlocker(orgId, id);
  if (why) return { error: why };
  try {
    await prisma.productModel.deleteMany({ where: { id, organizationId: orgId } });
  } catch {
    return { error: "Артикул связан с другими записями — деактивируйте его (галочка «Активный»)" };
  }
  revalidateAll(orgId);
  return { ok: true };
}

/** Быстрое добавление нового артикула из формы выбора (только код и, если есть, название). */
export async function createArticleQuick(code: string, title?: string): Promise<Res & { article?: ArticleLite }> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const name = t(code, 100);
  if (name.length < 2) return { error: "Укажите код артикула" };
  const list = await loadArticleList(orgId);
  const bad = conflictOf(list, null, { name, sku: "", salesCode: "", aliases: [] });
  if (bad) return { error: bad };
  try {
    const m = await prisma.productModel.create({
      data: { organizationId: orgId, name, category: t(title, 300) || null },
      select: { id: true, name: true, sku: true, category: true, salesCode: true, salesName: true, aliases: true, isActive: true },
    });
    revalidateAll(orgId);
    return { ok: true, id: m.id, article: m };
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Артикул с таким кодом уже есть" };
    throw e;
  }
}

/**
 * Объединение дублей: всё, что связано с «лишним» артикулом (ТЗ, плановые поставки, остатки и движения готовой продукции,
 * нормы расхода), переезжает в «основной»; код, SKU, код продаж и написания лишнего становятся написаниями основного;
 * пустые поля основного заполняются из лишнего. Одна транзакция; лишний артикул удаляется.
 */
export async function mergeArticles(sourceId: string, targetId: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  if (!sourceId || !targetId || sourceId === targetId) return { error: "Выберите два разных артикула" };
  try {
    await prisma.$transaction(async (tx) => {
      const [src, dst] = await Promise.all([
        tx.productModel.findFirst({ where: { id: sourceId, organizationId: orgId } }),
        tx.productModel.findFirst({ where: { id: targetId, organizationId: orgId } }),
      ]);
      if (!src || !dst) throw new Error("Артикул не найден");

      await tx.productionOrder.updateMany({ where: { productModelId: src.id, organizationId: orgId }, data: { productModelId: dst.id } });
      await tx.supplyPlanEntry.updateMany({ where: { productModelId: src.id, organizationId: orgId }, data: { productModelId: dst.id } });
      await tx.finishedGoodsMovement.updateMany({ where: { productModelId: src.id, organizationId: orgId }, data: { productModelId: dst.id } });

      // Остатки готовой продукции: уникально (склад, артикул) — при совпадении склада складываем, средняя себестоимость взвешенная.
      const stocks = await tx.finishedGoodsStock.findMany({ where: { productModelId: src.id, organizationId: orgId } });
      for (const s of stocks) {
        const same = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: s.warehouseId, productModelId: dst.id } } });
        if (!same) {
          await tx.finishedGoodsStock.update({ where: { id: s.id }, data: { productModelId: dst.id } });
        } else {
          const qty = same.quantity.add(s.quantity);
          const avg = qty.greaterThan(0) ? same.quantity.mul(same.avgUnitCost).add(s.quantity.mul(s.avgUnitCost)).div(qty).toDecimalPlaces(2) : same.avgUnitCost;
          await tx.finishedGoodsStock.update({ where: { id: same.id }, data: { quantity: qty, avgUnitCost: avg } });
          await tx.finishedGoodsStock.delete({ where: { id: s.id } });
        }
      }
      // Нормы расхода: уникально (артикул, материал) — у основного уже есть такой материал, норму лишнего отбрасываем.
      const boms = await tx.productModelMaterial.findMany({ where: { productModelId: src.id } });
      for (const b of boms) {
        const has = await tx.productModelMaterial.findUnique({ where: { productModelId_rawMaterialId: { productModelId: dst.id, rawMaterialId: b.rawMaterialId } } });
        if (has) await tx.productModelMaterial.delete({ where: { id: b.id } });
        else await tx.productModelMaterial.update({ where: { id: b.id }, data: { productModelId: dst.id } });
      }

      const aliasSet = new Map<string, string>();
      for (const a of [...dst.aliases, src.name, src.sku, src.salesCode, ...src.aliases]) {
        const k = articleKey(a);
        if (a && k && k !== articleKey(dst.name) && !aliasSet.has(k)) aliasSet.set(k, a);
      }
      await tx.productModel.delete({ where: { id: src.id } });
      await tx.productModel.update({
        where: { id: dst.id },
        data: {
          aliases: Array.from(aliasSet.values()),
          sku: dst.sku ?? src.sku,
          category: dst.category ?? src.category,
          salesCode: dst.salesCode ?? src.salesCode,
          salesName: dst.salesName ?? src.salesName,
          sellingPrice: dst.sellingPrice ?? src.sellingPrice,
          description: dst.description ?? src.description,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Артикул не найден") return { error: e.message };
    throw e;
  }
  revalidateAll(orgId);
  return { ok: true };
}

// ───────────────────────── импорт из системы продаж ─────────────────────────

export type ImportRow = {
  line: number;
  ourCode: string;
  ourName: string;
  salesCode: string;
  salesName: string;
  extra: string;
  /** Длина из файла (Short/Regular/Long) или пусто. */
  length: string;
  /** ok — сопоставлено однозначно; same — уже так записано; none — наш артикул не найден; ambiguous — несколько; conflict — код продаж занят другим */
  status: "ok" | "same" | "none" | "ambiguous" | "conflict";
  note: string;
  candidates: { id: string; name: string; category: string | null }[];
  articleId: string | null;
};
export type ImportPreview = { error?: string; rows?: ImportRow[]; header?: string[] };

const HEAD = {
  ourCode: /(наш.*(код|артикул)|^артикул$|^код$|^модель$|артикул \(модель\)|our.*code|^article$)/i,
  ourName: /(наш.*(назв|наимен)|наименование$|our.*name)/i,
  salesCode: /(код.*продаж|артикул.*продаж|продаж.*(код|артикул)|sales.*(code|article)|код в продажах|^sku$)/i,
  salesName: /(назв.*продаж|наимен.*продаж|продаж.*(назв|наимен)|sales.*name|розничн.*назв)/i,
  extra: /(синоним|написан|alias|прочие)/i,
  length: /(^длин|^length)/i,
};

export async function previewArticleImport(formData: FormData): Promise<ImportPreview> {
  const session = await requireRole(...ROLES);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите файл CSV или Excel (.xlsx)" };
  if (file.size > 5_000_000) return { error: "Файл больше 5 МБ" };
  let table: string[][];
  try {
    table = await parseTableFile(Buffer.from(await file.arrayBuffer()), file.name);
  } catch {
    return { error: "Не удалось прочитать файл. Сохраните его как CSV (разделитель «;») или Excel .xlsx" };
  }
  if (table.length < 2) return { error: "В файле нет строк с данными" };
  const header = table[0].map((h) => h.trim());
  const idx = (re: RegExp, skip: number[] = []) => header.findIndex((h, i) => !skip.includes(i) && re.test(h));
  const iSalesCode = idx(HEAD.salesCode);
  const iSalesName = idx(HEAD.salesName, [iSalesCode]);
  const iOurCode = idx(HEAD.ourCode, [iSalesCode, iSalesName]);
  const iOurName = idx(HEAD.ourName, [iSalesCode, iSalesName, iOurCode]);
  const iExtra = idx(HEAD.extra);
  const iLen = idx(HEAD.length);
  if (iSalesCode < 0 && iSalesName < 0 && iLen < 0) return { error: "Не найдены колонки «Код в продажах» / «Название в продажах» / «Длина». Первая строка файла должна быть заголовком.", header };
  if (iOurCode < 0 && iOurName < 0) return { error: "Не найдена колонка «Наш код» (или «Наше название»).", header };

  const list = await loadArticleList(session.user.organizationId);
  const salesOwner = new Map<string, ArticleLite>();
  for (const a of list) if (a.salesCode && articleKey(a.salesCode)) salesOwner.set(articleKey(a.salesCode), a);
  const cell = (r: string[], i: number) => (i >= 0 ? t(r[i], 500) : "");

  const rows: ImportRow[] = [];
  const seenSales = new Map<string, string>();
  for (let n = 1; n < table.length; n++) {
    const r = table[n];
    const ourCode = cell(r, iOurCode);
    const ourName = cell(r, iOurName);
    const salesCode = cell(r, iSalesCode);
    const salesName = cell(r, iSalesName);
    if (!ourCode && !ourName) continue;
    const base: ImportRow = { line: n + 1, ourCode, ourName, salesCode, salesName, extra: cell(r, iExtra), length: parseLength(cell(r, iLen)) ?? "", status: "none", note: "", candidates: [], articleId: null };
    let cands: ArticleLite[] = ourCode ? candidatesFromList(list, ourCode) : [];
    if (cands.length === 0 && ourName) {
      const k = ourName.toLowerCase().replace(/ё/g, "е");
      cands = list.filter((a) => (a.category ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim() === k);
      if (cands.length > 1) base.note = "по названию подходит несколько артикулов";
    }
    base.candidates = cands.slice(0, 8).map((a) => ({ id: a.id, name: a.name, category: a.category }));
    if (cands.length === 0) {
      base.note = "в справочнике нет такого артикула";
    } else if (cands.length > 1) {
      base.status = "ambiguous";
      base.note ||= "несколько артикулов с таким написанием — выберите нужный";
    } else {
      const a = cands[0];
      base.articleId = a.id;
      const full = list.find((x) => x.id === a.id)!;
      const sk = articleKey(salesCode);
      const owner = sk ? salesOwner.get(sk) : undefined;
      const dupFile = sk ? seenSales.get(sk) : undefined;
      if (owner && owner.id !== a.id) {
        base.status = "conflict";
        base.note = `код продаж «${salesCode}» уже записан у артикула ${owner.name}`;
      } else if (dupFile && dupFile !== a.id) {
        base.status = "conflict";
        base.note = `код продаж «${salesCode}» в файле встречается у разных артикулов`;
      } else if ((salesCode ? articleKey(full.salesCode) === sk : true) && (salesName ? (full.salesName ?? "") === salesName : true) && !base.extra && (!base.length || full.lengthClass === base.length)) {
        base.status = "same";
        base.note = "уже записано";
      } else {
        base.status = "ok";
        const was = [full.salesCode && `код: ${full.salesCode}`, full.salesName && `название: ${full.salesName}`].filter(Boolean).join("; ");
        if (was) base.note = `заменит: ${was}`;
      }
      if (sk && base.status !== "conflict") seenSales.set(sk, a.id);
    }
    rows.push(base);
  }
  if (rows.length === 0) return { error: "Не нашлось ни одной строки с кодом или названием" };
  return { rows, header };
}

export type ImportApplyRow = { articleId: string; salesCode: string; salesName: string; extra: string; length?: string };

export async function applyArticleImport(items: ImportApplyRow[]): Promise<Res & { updated?: number; skipped?: string[] }> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  if (!Array.isArray(items) || items.length === 0) return { error: "Нечего применять" };
  const list = await loadArticleList(orgId);
  const byId = new Map(list.map((a) => [a.id, a]));
  const owner = new Map<string, string>();
  for (const a of list) if (a.salesCode && articleKey(a.salesCode)) owner.set(articleKey(a.salesCode), a.id);
  const skipped: string[] = [];
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const it of items.slice(0, 5000)) {
      const a = byId.get(it.articleId);
      if (!a) {
        skipped.push(`артикул не найден`);
        continue;
      }
      const sc = t(it.salesCode, 100);
      const sn = t(it.salesName, 500);
      const sk = articleKey(sc);
      if (sk && owner.has(sk) && owner.get(sk) !== a.id) {
        skipped.push(`${a.name}: код продаж «${sc}» занят`);
        continue;
      }
      const extra = parseAliases(it.extra);
      const taken = takenKeys(list, a.id);
      const aliases = [...a.aliases];
      for (const x of extra) {
        const k = articleKey(x);
        if (k && k !== articleKey(a.name) && !taken.has(k) && !aliases.some((y) => articleKey(y) === k)) aliases.push(x);
      }
      const data: { salesCode?: string; salesName?: string; aliases?: string[]; lengthClass?: string } = {};
      const len = parseLength(it.length);
      if (len && len !== a.lengthClass) data.lengthClass = len;
      if (sc) data.salesCode = sc;
      if (sn) data.salesName = sn;
      if (aliases.length !== a.aliases.length) data.aliases = aliases;
      if (Object.keys(data).length === 0) continue;
      await tx.productModel.update({ where: { id: a.id }, data });
      if (sk) owner.set(sk, a.id);
      updated++;
    }
  });
  revalidateAll(orgId);
  return { ok: true, updated, skipped };
}
