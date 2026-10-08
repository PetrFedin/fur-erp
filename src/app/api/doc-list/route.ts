import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { DOC_ENTITIES, listDocs, type DocEntity } from "@/lib/doc-links";

/** Список документов строки для DocViewer: ?entity=purchase|lot|payment|productionPayment|order|batch&id=… (грузится по клику). */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const u = new URL(request.url);
  const entity = u.searchParams.get("entity") as DocEntity;
  const id = u.searchParams.get("id") ?? "";
  if (!DOC_ENTITIES.includes(entity) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Bad request", { status: 400 });
  const docs = await listDocs(session.user.organizationId, entity, id);
  // Куда загружать файл, если у строки нет документов (лот — в его закупку).
  let upload: { entity: string; id: string } | null = entity === "lot" ? null : { entity, id };
  if (entity === "lot") {
    const lot = await prisma.rawMaterialLot.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { purchaseId: true } });
    if (lot?.purchaseId) upload = { entity: "purchase", id: lot.purchaseId };
  }
  return Response.json({ docs, upload }, { headers: { "Cache-Control": "private, no-store" } });
}
