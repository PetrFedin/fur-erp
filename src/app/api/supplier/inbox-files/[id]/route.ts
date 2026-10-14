import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/fitting-files";

/** Вложение входящего: поставщик — только свои, владелец/админ — любые в организации. */
export async function GET(_req: Request, ctx: RouteContext<"/api/supplier/inbox-files/[id]">) {
  const session = await getFreshSession({ allowSupplier: true });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const role = session.user.role;
  const isSup = role === "SUPPLIER";
  if (!isSup && role !== "OWNER" && role !== "ADMIN") return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const f = await prisma.supplierInboxFile.findFirst({
    where: { id, inbox: { organizationId: session.user.organizationId, ...(isSup ? { supplierId: session.user.supplierId ?? "-" } : {}) } },
  });
  if (!f) return new Response("Not found", { status: 404 });
  const buf = await readStoredFile(f.storagePath);
  if (!buf || buf.length === 0) return new Response("Файл не найден на диске", { status: 404 });
  const encoded = encodeURIComponent(f.originalName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encoded}`,
    },
  });
}
