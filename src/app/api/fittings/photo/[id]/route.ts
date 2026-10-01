import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/fitting-files";

/**
 * Выдача фото примерки. Путь берётся только из БД по id фото (из URL —
 * только id), доступ — авторизованному пользователю той же организации.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/fittings/photo/[id]">) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const photo = await prisma.fittingPhoto.findFirst({
    where: { id, fitting: { organizationId: session.user.organizationId } },
    select: { storagePath: true, mimeType: true, originalName: true },
  });
  if (!photo) return new Response("Not found", { status: 404 });
  const buf = await readStoredFile(photo.storagePath);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(photo.originalName)}`,
    },
  });
}
