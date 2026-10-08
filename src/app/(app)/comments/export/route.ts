import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { buildTasksCsv, buildTasksMarkdown, commentOrder, commentWhere, parseCommentFilters, type ExportComment } from "@/lib/comments-core";

/**
 * Выгрузка «задач на доработку» по тем же фильтрам, что и /comments:
 *   ?format=md (по умолчанию) — Markdown для разработчика/агента; ?format=csv — таблица для Excel;
 *   &inline=1 — отдать текстом без скачивания (для «Скопировать как задачи»).
 * Только вошедшие, только своя организация; не больше 5000 комментариев; имя файла — латиницей.
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!("comment" in prisma)) return new Response("Комментарии не подключены к работающему серверу: перезапустите сервер после обновления схемы.", { status: 503 });

  const url = new URL(request.url);
  const params: Record<string, string[]> = {};
  for (const [k, v] of url.searchParams) (params[k] ??= []).push(v);
  const f = parseCommentFilters(params);
  const rows = (await prisma.comment.findMany({
    where: commentWhere(session.user.organizationId, f),
    orderBy: commentOrder(f.sort || "new"),
    take: 5000,
    include: { replies: { orderBy: { createdAt: "asc" } } },
  })) as unknown as ExportComment[];

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const stamp = new Date().toISOString().slice(0, 10);
  const csv = url.searchParams.get("format") === "csv";
  const active = [f.status.length ? `статус: ${f.status.join(",")}` : "", f.kind.length ? `тип: ${f.kind.join(",")}` : "", f.priority.length ? `приоритет: ${f.priority.join(",")}` : "", f.q ? `поиск: «${f.q}»` : ""].filter(Boolean);
  const body = csv ? buildTasksCsv(rows, origin) : buildTasksMarkdown(rows, { origin, filterNote: active.length ? `Фильтры: ${active.join("; ")}.` : undefined });
  const inline = url.searchParams.get("inline") === "1";
  return new Response(body, {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : inline ? "text/plain; charset=utf-8" : "text/markdown; charset=utf-8",
      ...(inline ? {} : { "Content-Disposition": `attachment; filename="comments-tasks-${stamp}.${csv ? "csv" : "md"}"` }),
      "Cache-Control": "private, no-store",
    },
  });
}
