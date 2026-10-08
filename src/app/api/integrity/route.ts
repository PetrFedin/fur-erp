import { getFreshSession } from "@/lib/session";
import { getIntegrityReport, summarize } from "@/lib/integrity";

export const dynamic = "force-dynamic";

/** Сводка самопроверки для колокольчика в шапке (кэш отчёта 60 с на сервере; `?force=1` — пересчитать сейчас). Только чтение. */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const force = new URL(request.url).searchParams.get("force") === "1";
  const report = await getIntegrityReport(session.user.organizationId, { force });
  if (!report) return Response.json({ error: "check_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return Response.json(summarize(report), { headers: { "Cache-Control": "no-store" } });
}
