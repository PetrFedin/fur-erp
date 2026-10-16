import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadArticlePhotos, readPhotoFile } from "@/lib/article-photos";
import { ACCESS, hasRole } from "@/lib/access";
import { photoRel } from "@/lib/article-photo-upload";

/**
 * Выдача фото артикула: /api/article-photos/<артикул>/<фото>?size=thumb|full. Путь берётся только из записи в БД,
 * доступ — любому вошедшему пользователю организации (фото изделий без цен видит и подрядчик; ссылок магазина тут нет).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/article-photos/[modelId]/[photoId]">) {
  const session = await getFreshSession({ allowSupplier: true });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { modelId, photoId } = await ctx.params;
  const photo = (await loadArticlePhotos(prisma, session.user.organizationId, modelId)).find((p) => p.id === photoId);
  const thumb = new URL(request.url).searchParams.get("size") === "thumb";
  // Загруженное, но ещё не сохранённое фото (окно «Магазин и фото») видят только те, кто его загружает; путь собираем сами из uuid.
  const staged = !photo && hasRole(session.user.role, ACCESS.models) && /^[0-9a-f-]{36}$/i.test(photoId) && /^[A-Za-z0-9_-]{1,64}$/.test(modelId);
  if (!photo && !staged) return new Response("Not found", { status: 404 });
  const buf = await readPhotoFile(photo ? (thumb ? photo.thumb : photo.file) : photoRel(session.user.organizationId, modelId, photoId, thumb));
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(buf.length), "Cache-Control": "private, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
