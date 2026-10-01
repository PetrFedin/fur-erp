import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/fitting-files";
import { fixFileNameExt } from "@/lib/purchase-files";
import { safeViewUrl } from "@/lib/drive-docs";

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/**
 * Выдача документа Drive по id. Есть файл в приложении — отдаём его (PDF и картинки открываются
 * во вкладке, xlsx/docx скачиваются; ?download=1 — всегда скачивание). Файла нет — 302 на ссылку Google Drive.
 * Путь берётся только из БД, доступ — только своей организации.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/drive-docs/[id]">) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  // NUL и прочие управляющие символы в id роняют запрос к Postgres — такого документа не бывает.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const doc = await prisma.driveDocument.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { storagePath: true, storedName: true, storedMime: true, viewUrl: true, title: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });

  if (!doc.storagePath || !doc.storedMime || !(doc.storedMime in MIME_EXT)) {
    const url = safeViewUrl(doc.viewUrl);
    if (!url) return new Response("Not found", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  }
  const buf = await readStoredFile(doc.storagePath);
  if (!buf) {
    // Файл пропал с диска — не ломаем открытие документа, если есть ссылка на Drive.
    const url = safeViewUrl(doc.viewUrl);
    if (url) return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
    return new Response("Not found", { status: 404 });
  }
  const ext = MIME_EXT[doc.storedMime];
  const fileName = fixFileNameExt((doc.storedName || doc.title || "документ").replace(/["\u0000-\u001f]/g, "'"), ext);
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const forceDownload = new URL(request.url).searchParams.get("download") === "1";
  const inline = !forceDownload && (doc.storedMime === "application/pdf" || doc.storedMime.startsWith("image/"));
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.storedMime,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    },
  });
}
