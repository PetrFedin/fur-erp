import "server-only";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { isUniqueViolation, normalizeNumberInput } from "@/lib/input";
import { loadArticleList } from "@/lib/article-ref";
import { articleKey, parseAliases } from "@/lib/article-key";
import { articleConflict } from "@/lib/article-conflict";
import { resolveCategoryInput } from "@/lib/categories";
import { CATEGORY_GROUPS } from "@/lib/category-groups";
import { parseLength } from "@/lib/length-class";

export type ArticleSaveInput = {
  name: string;
  sku?: string;
  salesCode?: string;
  salesName?: string;
  /** Через запятую или с новой строки. */
  aliases?: string;
  category?: string;
  categoryRefId?: string | null;
  /** Группа новой категории (если у выбранной категории группы ещё нет). */
  group?: string;
  /** Розничная цена с НДС; пусто — без цены. */
  sellingPrice?: FormDataEntryValue | string | number | null;
  /** Short / Regular / Long или пусто. */
  lengthClass?: string;
  description?: string;
  /** Данные от поставщика: расценка работы за единицу, ₽, и расход шкур на изделие. undefined — не менять; пусто — очистить. */
  supplierWorkPrice?: FormDataEntryValue | string | number | null;
  supplierFurPerUnit?: FormDataEntryValue | string | number | null;
  /** undefined — не менять (для нового артикула true). */
  isActive?: boolean;
};
export type ArticleSaveResult = { error?: string; fields?: Record<string, string>; id?: string };

const one = (v: string | undefined | null, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * ЕДИНАЯ запись артикула: и «+ Новый артикул» (/models/new), и «Изменить» в карточке артикула и в справочнике артикулов.
 * id = null — новый. Цена продажи при изменении переносится на ТЗ в плане и в работе (у завершённых и отменённых не меняется).
 */
export async function saveArticleCore(orgId: string, role: string, id: string | null, input: ArticleSaveInput): Promise<ArticleSaveResult> {
  const fields: Record<string, string> = {};
  const name = one(input.name, 100);
  const sku = one(input.sku, 100);
  const salesCode = one(input.salesCode, 100);
  const salesName = one(input.salesName, 500);
  const category = one(input.category, 300);
  const group = one(input.group, 40);
  const description = String(input.description ?? "").trim().slice(0, 5000);
  const aliases = parseAliases(String(input.aliases ?? "")).filter((a) => articleKey(a) !== articleKey(name));
  const rawPrice = normalizeNumberInput(input.sellingPrice as never);
  if (name.length < 2) fields.name = "Укажите код артикула (не короче 2 символов)";
  let price: number | null = null;
  if (rawPrice !== undefined) {
    if (typeof rawPrice !== "number" || !Number.isFinite(rawPrice) || rawPrice <= 0 || rawPrice > 999_999_999_999) fields.sellingPrice = "Цена продажи: число больше 0 (или оставьте пустой)";
    else price = rawPrice;
  }
  const lengthRaw = (input.lengthClass ?? "").trim();
  if (lengthRaw && !parseLength(lengthRaw)) fields.lengthClass = "Длина: Short, Regular или Long";
  const num = (v: ArticleSaveInput["supplierWorkPrice"], key: string, label: string, max: number): number | null | undefined => {
    if (v === undefined) return undefined;
    const n = normalizeNumberInput(v as never);
    if (n === undefined) return null;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > max) { fields[key] = `${label}: число больше 0 (или оставьте пустым)`; return undefined; }
    return n;
  };
  const workPrice = num(input.supplierWorkPrice, "supplierWorkPrice", "Расценка работы", 999_999_999);
  const furPerUnit = num(input.supplierFurPerUnit, "supplierFurPerUnit", "Расход шкур", 99_999);
  if (Object.keys(fields).length) return { error: Object.values(fields)[0], fields };

  const list = await loadArticleList(orgId);
  if (id && !list.some((a) => a.id === id)) return { error: "Артикул не найден" };
  const bad = articleConflict(list, id, { name, sku, salesCode, aliases });
  if (bad) return { error: bad, fields: { name: bad } };

  const catInput = await resolveCategoryInput(prisma, orgId, { category, categoryRefId: input.categoryRefId || null });
  if (catInput.categoryRefId && (CATEGORY_GROUPS as readonly string[]).includes(group) && hasRole(role as never, ACCESS.categories)) {
    await prisma.categoryRef.updateMany({ where: { id: catInput.categoryRefId, organizationId: orgId, group: null }, data: { group } });
  }

  const data = {
    name,
    sku: sku || null,
    salesCode: salesCode || null,
    salesName: salesName || null,
    aliases,
    category: catInput.category,
    categoryRefId: catInput.categoryRefId,
    sellingPrice: price,
    lengthClass: parseLength(lengthRaw),
    description: description || null,
    ...(workPrice !== undefined ? { supplierWorkPrice: workPrice } : {}),
    ...(furPerUnit !== undefined ? { supplierFurPerUnit: furPerUnit } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  let savedId = id;
  try {
    if (id) {
      const before = await prisma.productModel.findFirst({ where: { id, organizationId: orgId }, select: { sellingPrice: true } });
      const r = await prisma.productModel.updateMany({ where: { id, organizationId: orgId }, data });
      if (r.count === 0) return { error: "Артикул не найден" };
      const was = before?.sellingPrice ? before.sellingPrice.toNumber() : null;
      if (was !== price) {
        await propagateArticlePrice(orgId, id, price);
      }
    } else {
      const m = await prisma.productModel.create({ data: { organizationId: orgId, ...data } });
      savedId = m.id;
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Артикул с таким кодом или SKU уже есть", fields: { name: "Артикул с таким кодом или SKU уже есть" } };
    throw e;
  }
  return { id: savedId! };
}

/** Новая цена артикула → ТЗ в плане и в работе (завершённые и отменённые не трогаем). Единое место переноса цены. */
export async function propagateArticlePrice(orgId: string, id: string, price: number | null) {
  await prisma.productionOrder.updateMany({
    where: { productModelId: id, organizationId: orgId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    data: { retailPrice: price },
  });
}

/**
 * Почему артикул нельзя удалить (null — можно): на нём не должно быть ТЗ, плановых поставок, остатков и движений готовой продукции.
 * Нормы расхода (ProductModelMaterial) удаляются вместе с артикулом.
 */
export async function articleDeleteBlocker(orgId: string, id: string): Promise<string | null> {
  const [tz, plan, stock, moves] = await Promise.all([
    prisma.productionOrder.count({ where: { organizationId: orgId, productModelId: id } }),
    prisma.supplyPlanEntry.count({ where: { organizationId: orgId, productModelId: id } }),
    prisma.finishedGoodsStock.count({ where: { productModelId: id } }),
    prisma.finishedGoodsMovement.count({ where: { productModelId: id } }),
  ]);
  if (tz > 0) return `По артикулу есть ТЗ (${tz}) — снимите галочку «Активный», чтобы убрать его из выбора`;
  if (plan > 0) return `Артикул стоит в плане поставок (${plan}) — снимите галочку «Активный»`;
  if (stock > 0 || moves > 0) return "По артикулу есть остатки или движения готовой продукции — снимите галочку «Активный»";
  return null;
}
