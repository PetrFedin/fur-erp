import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/fitting-files";
import { extractDocx, extractXlsx, type DocContent } from "@/lib/doc-text";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Отрисованный текст/таблицы DOCX и XLSX для окна просмотра: ?src=drive|purchase&id=… Только своя организация. */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const u = new URL(request.url);
  const src = u.searchParams.get("src");
  const id = u.searchParams.get("id") ?? "";
  if ((src !== "drive" && src !== "purchase") || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Bad request", { status: 400 });
  const orgId = session.user.organizationId;
  const doc =
    src === "drive"
      ? await prisma.driveDocument
          .findFirst({ where: { id, organizationId: orgId }, select: { storagePath: true, storedMime: true } })
          .then((d) => d && { path: d.storagePath, mime: d.storedMime })
      : await prisma.purchaseDocument
          .findFirst({ where: { id, organizationId: orgId }, select: { storagePath: true, mimeType: true } })
          .then((d) => d && { path: d.storagePath, mime: d.mimeType });
  if (!doc) return new Response("Not found", { status: 404 });
  if (!doc.path || (doc.mime !== DOCX && doc.mime !== XLSX)) return Response.json({ error: "Для этого типа файла текстовый вид недоступен" }, { status: 415 });
  const buf = await readStoredFile(doc.path);
  if (!buf) return Response.json({ error: "Файл пропал с диска" }, { status: 404 });
  let content: DocContent;
  try {
    content = doc.mime === DOCX ? await extractDocx(buf) : await extractXlsx(buf);
  } catch {
    return Response.json({ error: "Не удалось прочитать файл — скачайте его и откройте в Word/Excel" }, { status: 422 });
  }
  return Response.json(content, { headers: { "Cache-Control": "private, max-age=60" } });
}
