import { getFreshSession } from "@/lib/session";
import { rawPrisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { stageArticlePhoto } from "@/lib/article-photo-upload";
import { PHOTO_MAX_BYTES } from "@/lib/article-shop-core";

/**
 * Загрузка одного фото артикула: POST /api/article-photos/<артикул> (multipart, поле «file»).
 * Только владелец, администратор и технолог своей организации (подрядчику — 403). Файл проверяется по содержимому,
 * обрабатывается sharp и ждёт кнопки «Сохранить» в окне «Магазин и фото»; в записи артикула появится только при сохранении.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/article-photos/[modelId]">) {
  const session = await getFreshSession({ allowSupplier: true });
  if (!session?.user) return Response.json({ error: "Войдите заново" }, { status: 401 });
  if (!hasRole(session.user.role, ACCESS.models)) return Response.json({ error: "Нет прав на загрузку фото" }, { status: 403 });
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > PHOTO_MAX_BYTES + 1024 * 1024) return Response.json({ error: `Файл больше ${PHOTO_MAX_BYTES / 1024 / 1024} МБ` }, { status: 413 });
  let file: FormDataEntryValue | null = null;
  try { file = (await request.formData()).get("file"); } catch { return Response.json({ error: "Не удалось прочитать файл" }, { status: 400 }); }
  if (!file || typeof file === "string") return Response.json({ error: "Файл не выбран" }, { status: 400 });
  const { modelId } = await ctx.params;
  const r = await stageArticlePhoto(rawPrisma, session.user.organizationId, modelId, Buffer.from(await file.arrayBuffer()));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.error === "Артикул не найден" ? 404 : 422 });
  return Response.json({ photo: r.photo });
}
