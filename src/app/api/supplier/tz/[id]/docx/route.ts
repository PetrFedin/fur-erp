import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { buildTzDocx } from "@/lib/tz-docx-vendor";
import type { TzPayload } from "@/lib/tz-vendor";

export const dynamic = "force-dynamic";

/** Word ТЗ из входящего: поставщик — только своё, владелец/админ — любое в организации. Для несохранённой формы — POST с JSON. */
async function authorize() {
  const session = await getFreshSession({ allowSupplier: true });
  if (!session?.user) return null;
  const role = session.user.role;
  if (role !== "SUPPLIER" && role !== "OWNER" && role !== "ADMIN") return null;
  return session;
}
function reply(buf: Buffer, number: string) {
  const name = `ПРИЛОЖЕНИЕ ${number}.docx`;
  const enc = encodeURIComponent(name);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="tz.docx"; filename*=UTF-8''${enc}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(_req: Request, ctx: RouteContext<"/api/supplier/tz/[id]/docx">) {
  const session = await authorize();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await prisma.supplierInbox.findFirst({
    where: { id, kind: "TZ", organizationId: session.user.organizationId, ...(session.user.role === "SUPPLIER" ? { supplierId: session.user.supplierId ?? "-" } : {}) },
    select: { payload: true },
  });
  if (!row) return new Response("Not found", { status: 404 });
  const p = row.payload as unknown as TzPayload;
  return reply(await buildTzDocx(p), p.number);
}

/** Скачать Word по данным формы (ещё не сохранённым). Ничего не пишет в базу. */
export async function POST(req: Request, ctx: RouteContext<"/api/supplier/tz/[id]/docx">) {
  const session = await authorize();
  if (!session) return new Response("Unauthorized", { status: 401 });
  await ctx.params;
  try {
    const p = (await req.json()) as TzPayload;
    if (p?.v !== 1 || !Array.isArray(p.items) || !Array.isArray(p.materials)) return new Response("Bad request", { status: 400 });
    return reply(await buildTzDocx(p), String(p.number ?? ""));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
}
