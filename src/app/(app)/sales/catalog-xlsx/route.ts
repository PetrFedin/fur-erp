import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * Готовые Excel «Отчёт: продажи» и «Отчёт: поставки» (листы «Данные», «Пивот», «Отчёт») — кнопка «Excel» в окнах отчётов каталога.
 * Файлы собирает scripts/gen-two-reports.sh и кладёт в SystemState `report-xlsx:sales` / `report-xlsx:supply` (scripts/publish-report-xlsx.ts): { name, at, base64 }.
 * Нет файла — 404 (кнопка в окне тогда не показывается).
 */
export async function GET(req: Request) {
  const session = await getFreshSession();
  if (!session?.user || session.user.role === "SUPPLIER") return new Response("Unauthorized", { status: 401 });
  const tab = new URL(req.url).searchParams.get("tab") === "supply" ? "supply" : "sales";
  const st = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: session.user.organizationId, key: `report-xlsx:${tab}` } }, select: { value: true } });
  const v = st?.value as { name?: string; at?: string; base64?: string } | null;
  if (!v?.base64) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(v.base64, "base64")), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="report-${tab}.xlsx"; filename*=UTF-8''${encodeURIComponent(v.name ?? `report-${tab}.xlsx`)}`,
      "Cache-Control": "no-store",
    },
  });
}
