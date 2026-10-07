import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { registryCsv } from "@/lib/registry-coverage";
import { computeDocCoverage, filterCovRows, parseCovFilters } from "@/lib/doc-coverage";

/**
 * «Список недостающих документов» — CSV (UTF-8 с BOM, чтобы Excel открыл кириллицу).
 * Берёт те же фильтры, что и страница /documents (section, year, auction, q); только записи с пробелами.
 * Читать могут все роли, как и саму страницу.
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const params: Record<string, string[]> = {};
  for (const [k, v] of url.searchParams) (params[k] ??= []).push(v);
  const filters = parseCovFilters(params);
  const cov = await computeDocCoverage(prisma, session.user.organizationId);
  const rows = filterCovRows(cov.rows, { ...filters, gaps: true });

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = `${proto}://${host}`;

  // Защита от формул Excel: ячейка, начинающаяся с = + - @, получает апостроф.
  const cell = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [["Сущность", "Номер", "Чего нет", "Что приложить", "Реестр", "Ссылка"].map(cell).join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.title.startsWith(r.entity) ? r.title : `${r.entity}: ${r.title}`,
        r.number,
        r.gaps.map((g) => g.label).join("; "),
        r.gaps.map((g) => g.attach).join("; "),
        registryCsv(r.registry),
        `${origin}${r.href}`,
      ]
        .map(cell)
        .join(";")
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nedostayushchie-dokumenty-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
