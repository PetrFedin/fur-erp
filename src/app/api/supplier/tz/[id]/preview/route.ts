import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { tzPreviewHtml } from "@/lib/tz-docx-vendor";
import type { TzPayload } from "@/lib/tz-vendor";
import { ACCESS, hasRole } from "@/lib/access";

export const dynamic = "force-dynamic";

async function authorize() {
  const session = await getFreshSession({ allowSupplier: true });
  if (!session?.user) return null;
  const role = session.user.role;
  if (role !== "SUPPLIER" && !hasRole(role, ACCESS.inbox)) return null;
  return session;
}
const html = (h: string) => new Response(h, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });

/** Предпросмотр сохранённого ТЗ: поставщик — только своё (organizationId + supplierId), владелец/админ — любое в организации. */
export async function GET(_req: Request, ctx: RouteContext<"/api/supplier/tz/[id]/preview">) {
  const session = await authorize();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await prisma.supplierInbox.findFirst({
    where: { id, kind: "TZ", organizationId: session.user.organizationId, ...(session.user.role === "SUPPLIER" ? { supplierId: session.user.supplierId ?? "-" } : session.user.role === "OWNER" || session.user.role === "ADMIN" ? {} : { status: { not: "DRAFT" as const } }) },
    select: { payload: true },
  });
  if (!row) return new Response("Not found", { status: 404 });
  return html(await tzPreviewHtml(row.payload as unknown as TzPayload));
}

/** Предпросмотр по данным формы (ещё не сохранённым). Ничего не пишет в базу. */
export async function POST(req: Request, ctx: RouteContext<"/api/supplier/tz/[id]/preview">) {
  const session = await authorize();
  if (!session) return new Response("Unauthorized", { status: 401 });
  await ctx.params;
  try {
    const p = (await req.json()) as TzPayload;
    if (p?.v !== 1 || !Array.isArray(p.items) || !Array.isArray(p.materials)) return new Response("Bad request", { status: 400 });
    return html(await tzPreviewHtml(p));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
}
