import { revalidatePath } from "next/cache";
import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { readPhotoFiles, writePhotoFiles, removeStoredFiles } from "@/lib/fitting-files";

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

/** Добавить фото к существующей примерке (multipart, поле photos). */
export async function POST(request: Request, ctx: RouteContext<"/api/fittings/[id]/photos">) {
  const session = await getFreshSession();
  if (!session?.user) return Response.json({ error: "Нужно войти в систему" }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role)) {
    return Response.json({ error: "Недостаточно прав для добавления фото" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const fitting = await prisma.fitting.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true, productionOrderId: true },
  });
  if (!fitting) return Response.json({ error: "Примерка не найдена" }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Не удалось прочитать форму" }, { status: 400 });
  }
  const read = await readPhotoFiles(form.getAll("photos"));
  if ("error" in read) return Response.json({ error: read.error }, { status: 400 });
  if (read.files.length === 0) return Response.json({ error: "Выберите хотя бы одно фото" }, { status: 400 });

  try {
    const stored = await writePhotoFiles(session.user.organizationId, fitting.id, read.files);
    try {
      await prisma.fittingPhoto.createMany({ data: stored.map((s) => ({ ...s, fittingId: fitting.id })) });
    } catch (e) {
      await removeStoredFiles(stored.map((s) => s.storagePath));
      throw e;
    }
  } catch (e) {
    console.error("Сохранение фото примерки не удалось", e);
    return Response.json({ error: "Не удалось сохранить фото на сервере" }, { status: 500 });
  }

  revalidatePath("/fittings");
  revalidatePath(`/fittings/${fitting.id}`);
  revalidatePath(`/production/${fitting.productionOrderId}`);
  return Response.json({ ok: true });
}
