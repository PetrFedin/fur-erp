import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { MODEL_TITLES } from "@/lib/audit-core";
import { ACTION_LABEL, detailLines, fmtAt, historyWhere, parseHistoryFilters, recordHref, snapshotText, type LogRow } from "@/lib/audit-query";

/** CSV журнала изменений (UTF-8 с BOM) по тем же фильтрам, что и /history; не больше 20 000 записей. Только владелец, администратор, бухгалтер. */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!hasRole(session.user.role, ACCESS.history)) return new Response("Forbidden", { status: 403 });

  if (!("auditLog" in prisma)) return new Response("Журнал не подключён к работающему серверу: перезапустите сервер после обновления схемы.", { status: 503 });

  const url = new URL(request.url);
  const f = parseHistoryFilters(Object.fromEntries(url.searchParams));
  const rows = (await prisma.auditLog.findMany({
    where: historyWhere(session.user.organizationId, f),
    orderBy: { at: "desc" },
    take: 20_000,
  })) as LogRow[];

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const cell = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [["Когда (МСК)", "Кто", "Источник", "Сущность", "Запись", "Действие", "Изменение", "Ссылка"].map(cell).join(";")];
  for (const r of rows) {
    const href = r.action === "delete" ? null : recordHref(r.model, r.recordId, r.label);
    const change = r.action === "update" ? detailLines(r).join("; ") : snapshotText(r.changes).replace(/\s*\n\s*/g, " ");
    lines.push(
      [fmtAt(r.at), r.actorName ?? "", r.source, MODEL_TITLES[r.model] ?? r.model, r.label ?? r.recordId, ACTION_LABEL[r.action] ?? r.action, change, href ? `${origin}${href}` : ""]
        .map(cell)
        .join(";"),
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="istoriya-izmeneniy-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
