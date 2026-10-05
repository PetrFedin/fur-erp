import { getProductionAdmission } from "@/lib/production-admission";
import { getFreshSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await getProductionAdmission();
  const url = new URL(request.url);
  const wantsDetails = url.searchParams.get("details") === "1";

  if (wantsDetails) {
    const session = await getFreshSession();
    if (!session?.user) {
      return Response.json(
        {
          production_ready: result.production_ready,
          checked_at: result.checked_at,
          blockers: result.blockers,
          details: "authentication_required",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  const body = wantsDetails
    ? result
    : {
        production_ready: result.production_ready,
        checked_at: result.checked_at,
        blockers: result.blockers,
      };

  return Response.json(body, {
    status: result.production_ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
