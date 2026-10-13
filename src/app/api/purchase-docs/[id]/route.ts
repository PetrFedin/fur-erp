import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/fitting-files";
import { fixFileNameExt } from "@/lib/purchase-files";
import { fileNotLoaded } from "@/lib/stored-file-check";

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** Выдача документа закупки по id; путь берётся из БД, доступ — только своей организации. */
export async function GET(request: Request, ctx: RouteContext<"/api/purchase-docs/[id]">) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  // NUL и прочие управляющие символы в id роняют запрос к Postgres — такого документа не бывает.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const doc = await prisma.purchaseDocument.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { storagePath: true, mimeType: true, originalName: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });
  const buf = await readStoredFile(doc.storagePath);
  if (!buf || buf.length === 0) return fileNotLoaded("Файл не загружен: на диске его нет");
  // RFC 5987: кодируем и «'», «(», «)», «*»; для старых клиентов — ASCII-запасной filename без кавычек.
  // Расширение — по реальному типу файла (у старых документов имя могло быть с подменённым расширением).
  const ext = MIME_EXT[doc.mimeType];
  const fileName = ext ? fixFileNameExt(doc.originalName, ext) : doc.originalName;
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
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
