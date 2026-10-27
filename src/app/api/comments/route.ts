import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { basePath, cleanAnchor, entityFromPath, normalizePagePath } from "@/lib/comments-core";
import { pageCounts, pageThread, resolveEntity, type CommentActor } from "@/lib/comments-service";

/**
 * GET /api/comments?mode=counts&path=/lots?tab=fur  — счётчики страницы для меток на блоках (лёгкий запрос, кэш 15 с);
 * GET /api/comments?mode=thread&path=…[&anchor=…][&scope=entity] — ветки комментариев страницы, блока или записи.
 * Только вошедшие пользователи; данные только своей организации.
 */
export async function GET(request: Request) {
  const s = await getFreshSession();
  if (!s?.user) return new Response("Unauthorized", { status: 401 });
  if (!("comment" in prisma)) return Response.json({ ready: false });
  const url = new URL(request.url);
  const path = normalizePagePath(url.searchParams.get("path"));
  if (!path) return new Response("Bad path", { status: 400 });
  const actor: CommentActor = { id: s.user.id, name: s.user.name ?? "–", role: s.user.role, organizationId: s.user.organizationId };
  const ef = entityFromPath(basePath(path));
  const entity = ef ? await resolveEntity(prisma, actor.organizationId, ef.type, ef.key) : null;
  const ent = ef && entity ? { type: ef.type, id: entity.id } : null;
  const headers = { "Cache-Control": "private, no-store" };
  if (url.searchParams.get("mode") === "thread") {
    const anchor = cleanAnchor(url.searchParams.get("anchor"));
    const scope = url.searchParams.get("scope");
    const items = await pageThread(prisma, actor, path, scope === "entity" ? { entity: ent } : { anchor });
    return Response.json({ ready: true, items }, { headers });
  }
  const counts = await pageCounts(prisma, actor.organizationId, path, ent);
  return Response.json({ ready: true, record: ef && entity ? { type: ef.type, key: ef.key, label: entity.label } : null, ...counts }, { headers });
}
