import { getFreshSession } from "@/lib/session";
import { cleanSearch } from "@/lib/input";
import { loadArticleList } from "@/lib/article-ref";
import { searchArticleList } from "@/lib/article-key";

/**
 * Подбор артикулов для ArticleSelect: GET /api/article-ref?q=…&active=1&limit=30 или ?id=<id артикула>
 * Пустой q — первые артикулы по порядку. Поиск по всем написаниям (наш код, SKU, код в продажах, другие написания) и названию.
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const q = cleanSearch(url.searchParams.get("q"));
  const onlyActive = url.searchParams.get("active") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
  const id = cleanSearch(url.searchParams.get("id"), 50);
  if (id) {
    const one = (await loadArticleList(session.user.organizationId)).find((a) => a.id === id);
    return Response.json({ items: one ? [{ ...one, via: null }] : [] }, { headers: { "Cache-Control": "no-store" } });
  }
  let list = await loadArticleList(session.user.organizationId);
  if (onlyActive) list = list.filter((a) => a.isActive);
  const items = q
    ? searchArticleList(list, q, limit).map((h) => ({ ...h.article, via: h.via ? { text: h.via.text, kind: h.via.kind } : null }))
    : list.slice(0, limit).map((a) => ({ ...a, via: null }));
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
