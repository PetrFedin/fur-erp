import { getProductionAdmission } from "@/lib/production-admission";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getProductionAdmission();
  return Response.json(result, {
    status: result.production_ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
