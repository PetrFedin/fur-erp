import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { buildTzDocx } from "@/lib/tz-docx-vendor";
import type { TzPayload } from "@/lib/tz-vendor";

export const dynamic = "force-dynamic";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * «Финальный Word» ТЗ — одна ссылка для карточки артикула, списка ТЗ и карточки производства.
 * По порядку: 1) сохранённый Word приложения к ТЗ (присланный Веллмехом или собранный при приёме ТЗ из кабинета);
 * 2) ТЗ принято из кабинета Веллмеха — Word в его формате собирается из принятых данных (tz-docx-vendor);
 * 3) иначе печатная форма, которую система формирует по ТЗ (/api/production/[id]/docx). Ничего не пишет в базу.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/production/[id]/word">) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const orgId = session.user.organizationId;
  const order = await prisma.productionOrder.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!order) return new Response("Not found", { status: 404 });
  const saved = await prisma.driveDocument.findFirst({
    where: { organizationId: orgId, productionOrderId: id, docType: "TZ_APPENDIX", storagePath: { not: null }, storedMime: DOCX },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  if (!saved) {
    const inbox = await prisma.supplierInbox.findFirst({
      where: { organizationId: orgId, kind: "TZ", status: "ACCEPTED", createdEntityType: "ProductionOrder", createdEntityId: { contains: id } },
      select: { payload: true, createdEntityId: true },
    });
    if (inbox && (inbox.createdEntityId ?? "").split(",").includes(id)) {
      const p = inbox.payload as unknown as TzPayload;
      const buf = await buildTzDocx(p);
      const enc = encodeURIComponent(`ПРИЛОЖЕНИЕ ${p.number}.docx`);
      return new Response(new Uint8Array(buf), {
        headers: { "Content-Type": DOCX, "Content-Disposition": `attachment; filename="tz.docx"; filename*=UTF-8''${enc}`, "Cache-Control": "private, no-store" },
      });
    }
  }
  const target = saved ? `/api/drive-docs/${saved.id}?download=1` : `/api/production/${id}/docx`;
  // Относительный адрес: за прокси и на другом хосте перенаправление остаётся на том же сайте.
  return new Response(null, { status: 307, headers: { Location: target, "Cache-Control": "private, no-store" } });
}
