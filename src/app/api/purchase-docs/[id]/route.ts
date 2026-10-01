import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/fitting-files";

/** Выдача документа закупки по id; путь берётся из БД, доступ — только своей организации. */
export async function GET(request: Request, ctx: RouteContext<"/api/purchase-docs/[id]">) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const doc = await prisma.purchaseDocument.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { storagePath: true, mimeType: true, originalName: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });
  const buf = await readStoredFile(doc.storagePath);
  if (!buf) return new Response("Not found", { status: 404 });
  // RFC 5987: кодируем и «'», «(», «)», «*»; для старых клиентов — ASCII-запасной filename без кавычек.
  const encoded = encodeURIComponent(doc.originalName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const fallback = doc.originalName.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  // ?download=1 — всегда скачивание (attachment), иначе PDF/картинки открываются во вкладке.
  const forceDownload = new URL(request.url).searchParams.get("download") === "1";
  const inline = !forceDownload && (doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/"));
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    },
  });
}
