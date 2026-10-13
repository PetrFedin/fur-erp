import "server-only";
import type { ProductModel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { candidatesFromList, resolveFromList, searchArticleList, type ArticleHit, type ArticleLite } from "@/lib/article-key";

/**
 * Серверный доступ к справочнику артикулов (ProductModel как запись справочника).
 *   resolveArticle(text)  — точное совпадение с наш код / SKU / код в продажах / другое написание → модель или null
 *                           (null и при неоднозначности: два артикула с одним написанием);
 *   searchArticles(q)     — подбор для выпадающих списков (поиск по всем написаниям и названию).
 * Без orgId берётся организация текущего пользователя.
 */

export async function loadArticleList(orgId: string): Promise<ArticleLite[]> {
  const rows = await prisma.productModel.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, sku: true, category: true, salesCode: true, salesName: true, aliases: true, isActive: true, lengthClass: true },
    orderBy: { name: "asc" },
  });
  return rows;
}

async function orgOf(orgId?: string): Promise<string | null> {
  if (orgId) return orgId;
  const s = await getFreshSession();
  return s?.user?.organizationId ?? null;
}

export async function resolveArticle(input: string, orgId?: string): Promise<ProductModel | null> {
  const org = await orgOf(orgId);
  if (!org || !input?.trim()) return null;
  const hit = resolveFromList(await loadArticleList(org), input);
  if (!hit) return null;
  return prisma.productModel.findFirst({ where: { id: hit.id, organizationId: org } });
}

/** Артикулы, которые подходят под текст точно (для показа «неоднозначно»). */
export async function articleCandidates(input: string, orgId?: string): Promise<ArticleLite[]> {
  const org = await orgOf(orgId);
  if (!org || !input?.trim()) return [];
  return candidatesFromList(await loadArticleList(org), input);
}

export async function searchArticles(q: string, orgId?: string, limit = 30): Promise<ArticleHit[]> {
  const org = await orgOf(orgId);
  if (!org) return [];
  return searchArticleList(await loadArticleList(org), q, limit);
}
