import { getFreshSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { buildFw26PlanFile } from "@/lib/fw26-plan-xlsx";

/** Excel «FW 26/27: заказано, пришло, приход по месяцам, план на ноябрь и декабрь» — кнопка «Скачать Excel» в «Приход по месяцам». */
export async function GET() {
  const session = await getFreshSession();
  if (!session?.user || session.user.role === "SUPPLIER") return new Response("Unauthorized", { status: 401 });
  const { name, buffer } = await buildFw26PlanFile(session.user.organizationId, await getCommission4Mode());
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="fw26-plan.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
