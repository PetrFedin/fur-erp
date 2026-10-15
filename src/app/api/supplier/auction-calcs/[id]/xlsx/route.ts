import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { buildCalcXlsx, calcXlsxName } from "@/lib/calc-xlsx";
import { ensureRowIds, syncLetters, type CalcPayload } from "@/lib/supplier-calc";

export const dynamic = "force-dynamic";

/** Excel «детальный расчёт стоимости сырья»: поставщик — только свои расчёты, владелец/админ — любые в организации. Для несохранённой формы — POST с JSON. */
async function authorize() {
  const session = await getFreshSession({ allowSupplier: true });
  if (!session?.user) return null;
  const role = session.user.role;
  if (role !== "SUPPLIER" && !hasRole(role, ACCESS.inbox)) return null;
  return session;
}
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function reply(buf: Buffer, name: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="calc.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(_req: Request, ctx: RouteContext<"/api/supplier/auction-calcs/[id]/xlsx">) {
  const session = await authorize();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await prisma.supplierInbox.findFirst({
    where: { id, kind: "AUCTION_CALC", organizationId: session.user.organizationId, ...(session.user.role === "SUPPLIER" ? { supplierId: session.user.supplierId ?? "-" } : session.user.role === "OWNER" || session.user.role === "ADMIN" ? {} : { status: { not: "DRAFT" as const } }) },
    select: { payload: true, title: true },
  });
  if (!row) return new Response("Not found", { status: 404 });
  const p = syncLetters(ensureRowIds(row.payload as unknown as CalcPayload));
  return reply(await buildCalcXlsx(p, row.title), calcXlsxName(p, row.title));
}

/** Скачать Excel по данным формы (ещё не сохранёнными). Ничего не пишет в базу. */
export async function POST(req: Request, ctx: RouteContext<"/api/supplier/auction-calcs/[id]/xlsx">) {
  const session = await authorize();
  if (!session) return new Response("Unauthorized", { status: 401 });
  await ctx.params;
  try {
    const p = (await req.json()) as CalcPayload;
    if (p?.v !== 1 || !Array.isArray(p.rows) || !p.header || p.rows.length > 3000) return new Response("Bad request", { status: 400 });
    const q = syncLetters(ensureRowIds(p));
    return reply(await buildCalcXlsx(q), calcXlsxName(q, "расчёт"));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
}
