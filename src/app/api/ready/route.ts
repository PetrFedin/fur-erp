import { getProductionAdmission } from "@/lib/production-admission";
import { getFreshSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Готовность. Без входа — только «готово / не готово» (ничего про базу, счётчики и причины).
 * ?details=1 — подробности (счётчики, миграции, сверка) только вошедшему владельцу или администратору.
 */
export async function GET(request: Request) {
  const result = await getProductionAdmission();
  const wantsDetails = new URL(request.url).searchParams.get("details") === "1";
  const headers = { "Cache-Control": "no-store" };

  if (wantsDetails) {
    const session = await getFreshSession();
    if (!session?.user) {
      return Response.json({ error: "authentication_required" }, { status: 401, headers });
    }
    if (session.user.role !== "OWNER" && session.user.role !== "ADMIN") {
      return Response.json({ error: "forbidden" }, { status: 403, headers });
    }
    return Response.json(result, { status: result.production_ready ? 200 : 503, headers });
  }

  return Response.json({ production_ready: result.production_ready }, { status: result.production_ready ? 200 : 503, headers });
}
