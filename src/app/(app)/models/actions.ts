"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { parsePrice } from "@/lib/input";
import { composeSupplierDescription } from "@/lib/supplier-article";
import { saveArticleCore, propagateArticlePrice } from "@/lib/article-save";

const EDIT_ROLES = ACCESS.models;

export type ModelFormState = { error?: string };

// Применяется только к незавершённым ТЗ (PLANNED/IN_PROGRESS): у завершённых и отменённых цена не меняется. Розничная цена в самом ТЗ
// правится отдельно (retailPatch в production/actions.ts).
export async function updateSellingPrice(modelId: string, formData: FormData): Promise<ModelFormState> {
  const session = await requireRole(...EDIT_ROLES);
  // Пустое поле — цену убрать (модель без розничной цены); иначе число больше 0.
  const rawPrice = String(formData.get("sellingPrice") ?? "").replace(/[\s\u00a0\u202f]/g, "");
  let price: number | null = null;
  if (rawPrice !== "") {
    const parsed = parsePrice(formData.get("sellingPrice"));
    if ("error" in parsed) return { error: parsed.error };
    price = parsed.value;
  }

  const model = await prisma.productModel.findFirst({
    where: { id: modelId, organizationId: session.user.organizationId },
  });
  if (!model) return { error: "Модель не найдена" };

  await prisma.productModel.update({ where: { id: modelId }, data: { sellingPrice: price } });
  await propagateArticlePrice(session.user.organizationId, modelId, price);

  revalidateAll(session.user.organizationId);
  return {};
}

// ───────────────────────── артикул от внешнего поставщика ─────────────────────────

/**
 * Новый артикул из кабинета поставщика (Веллмех): без цены (sellingPrice всегда пусто), сразу активный, только создание —
 * чужие артикулы и цены поставщик не меняет. В журнале изменений виден актёр с ролью SUPPLIER.
 */
export async function createArticleBySupplier(_prev: ArticleSaveState, formData: FormData): Promise<ArticleSaveState> {
  const session = await requireRole("SUPPLIER");
  const orgId = session.user.organizationId;
  const g = (k: string) => String(formData.get(k) ?? "");
  // Только то, что поставщик реально присылает: код, наименование изделия, категория, длина, мех, подкладка, размеры, цвета,
  // расценка работы и расход шкур. SKU, коды продаж, синонимы и цену он не задаёт. Мех/подкладка/размеры/цвета уходят строками в описание.
  const r = await saveArticleCore(orgId, session.user.role, null, {
    name: g("name"), salesName: g("salesName"),
    category: g("category"), categoryRefId: g("categoryRefId") || null, group: "",
    sellingPrice: null, lengthClass: g("lengthClass"),
    description: composeSupplierDescription({ fur: g("fur"), lining: g("lining"), sizes: g("sizes"), colors: g("colors"), note: g("note") }),
    supplierWorkPrice: g("supplierWorkPrice"), supplierFurPerUnit: g("supplierFurPerUnit"), isActive: true,
  });
  if (r.error) return { error: r.error, fields: r.fields };
  revalidateAll(orgId);
  if (formData.get("intent") === "again") return { created: { id: r.id!, name: one(formData.get("name"), 100), at: Date.now() } };
  redirect("/articles");
}

// ───────────────────────── единая форма артикула (новый + правка по месту) ─────────────────────────

export type ArticleSaveState = {
  error?: string;
  /** Ошибки по полям (имя поля формы → сообщение). */
  fields?: Record<string, string>;
  /** Правка сохранена. */
  saved?: { at: number };
  /** Новый артикул заведён (intent=again — остаёмся на форме). */
  created?: { id: string; name: string; at: number };
};

const one = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Сохранение артикула одной формой. id = null — новый артикул (intent «open» ведёт в карточку, «again» оставляет пустую форму).
 * Правка возможна в любом состоянии артикула. Категория — из справочника или своя (если права позволяют, сразу заводится в справочник
 * с выбранной группой). Цена продажи при изменении переносится на ТЗ в плане и в работе (как «Розничная цена» в списке).
 */
export async function saveArticleForm(id: string | null, _prev: ArticleSaveState, formData: FormData): Promise<ArticleSaveState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const g = (k: string) => String(formData.get(k) ?? "");
  if (id) {
    const cur = await prisma.productModel.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
    if (!cur) return { error: "Артикул не найден" };
  }
  const r = await saveArticleCore(orgId, session.user.role, id, {
    name: g("name"), sku: g("sku"), salesCode: g("salesCode"), salesName: g("salesName"), aliases: g("aliases"),
    category: g("category"), categoryRefId: g("categoryRefId") || null, group: g("group"),
    sellingPrice: formData.get("sellingPrice"), lengthClass: g("lengthClass"), description: g("description"),
    supplierWorkPrice: formData.has("supplierWorkPrice") ? g("supplierWorkPrice") : undefined,
    supplierFurPerUnit: formData.has("supplierFurPerUnit") ? g("supplierFurPerUnit") : undefined,
    isActive: id ? formData.get("isActive") !== "0" : undefined,
  });
  if (r.error) return { error: r.error, fields: r.fields };
  revalidateAll(orgId);
  if (!id) {
    if (formData.get("intent") === "again") return { created: { id: r.id!, name: one(formData.get("name"), 100), at: Date.now() } };
    redirect(`/models/${r.id}`);
  }
  return { saved: { at: Date.now() } };
}
