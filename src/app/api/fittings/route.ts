import { revalidatePath } from "next/cache";
import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { FITTING_DATE_ERROR, isFittingStatus, parseFittingDate } from "@/lib/fittings";
import { readPhotoFiles, writePhotoFiles, removeStoredFiles } from "@/lib/fitting-files";

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

/** Создание примерки вместе с фото (multipart). Ответ — JSON {id} или {error}. */
export async function POST(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return Response.json({ error: "Нужно войти в систему" }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role)) {
    return Response.json({ error: "Недостаточно прав для добавления примерок" }, { status: 403 });
  }
  const orgId = session.user.organizationId;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Не удалось прочитать форму" }, { status: 400 });
  }
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string).trim() : "");

  const orderId = str("orderId");
  const order = orderId
    ? await prisma.productionOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: { id: true } })
    : null;
  if (!order) return Response.json({ error: "Выберите ТЗ из списка" }, { status: 400 });
  const date = parseFittingDate(str("date"));
  if (!date) return Response.json({ error: FITTING_DATE_ERROR }, { status: 400 });
  const status = str("status");
  if (!isFittingStatus(status)) return Response.json({ error: "Выберите итог примерки" }, { status: 400 });

  const read = await readPhotoFiles(form.getAll("photos"));
  if ("error" in read) return Response.json({ error: read.error }, { status: 400 });

  const fitting = await prisma.fitting.create({
    data: {
      organizationId: orgId,
      productionOrderId: order.id,
      fittingDate: date,
      size: str("size").slice(0, 100) || null,
      status,
      comment: str("comment").slice(0, 5000) || null,
      createdById: session.user.id,
    },
  });

  if (read.files.length > 0) {
    try {
      const stored = await writePhotoFiles(orgId, fitting.id, read.files);
      try {
        await prisma.fittingPhoto.createMany({ data: stored.map((s) => ({ ...s, fittingId: fitting.id })) });
      } catch (e) {
        await removeStoredFiles(stored.map((s) => s.storagePath));
        throw e;
      }
    } catch (e) {
      console.error("Сохранение фото примерки не удалось", e);
      await prisma.fitting.delete({ where: { id: fitting.id } });
      return Response.json({ error: "Не удалось сохранить фото на сервере. Примерка не создана — попробуйте ещё раз" }, { status: 500 });
    }
  }

  revalidatePath("/fittings");
  revalidatePath(`/production/${order.id}`);
  return Response.json({ id: fitting.id });
}
