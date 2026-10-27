import { Breadcrumbs } from "@/components/breadcrumbs";
import { InfoHint } from "@/components/info-hint";
import Link from "next/link";
import { ControlTabs } from "@/components/control-tabs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { FilterBar } from "@/components/filters/filter-bar";
import { buttonVariants } from "@/components/ui/button";
import { filterEntries, filterHref } from "@/lib/filters";
import {
  COMMENT_KINDS,
  COMMENT_PRIORITIES,
  COMMENT_STATUSES,
  ENTITY_TITLES,
  KIND_LABEL,
  PAGE_SIZE,
  PRIORITY_LABEL,
  SORT_OPTIONS,
  STATUS_LABEL,
  basePath,
  commentFilterSchema,
  commentOrder,
  commentWhere,
  parseCommentFilters,
} from "@/lib/comments-core";
import { canManage, toDto } from "@/lib/comments-service";
import { CommentsList } from "@/components/comments/comments-list";
import { CopyTasksButton } from "@/components/comments/copy-tasks-button";

export const metadata = { title: "Комментарии" };

export default async function CommentsPage({ searchParams }: PageProps<"/history/comments">) {
  const session = await requireSession();
  if (!("comment" in prisma)) {
    return (
      <div className="flex flex-col gap-3">
        <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "История", href: "/history" }, { label: "Комментарии" }]} />
        <ControlTabs active="history" />
        <h1 className="text-xl font-semibold">Комментарии</h1>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Комментарии ещё не подключены к работающему серверу: после обновления схемы сервер нужно перезапустить.</p>
      </div>
    );
  }
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const f = parseCommentFilters(sp);
  const pageNo = Math.max(1, Number(f.page) || 1);
  const where = commentWhere(orgId, f);
  const actor = { id: session.user.id, name: session.user.name ?? "–", role: session.user.role, organizationId: orgId };

  const [total, rows, authors, pages, openCount] = await Promise.all([
    prisma.comment.count({ where }),
    prisma.comment.findMany({ where, orderBy: commentOrder(f.sort || "new"), skip: (pageNo - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { replies: { orderBy: { createdAt: "asc" }, take: 50 } } }),
    prisma.comment.groupBy({ by: ["authorId", "authorName"], where: { organizationId: orgId } }),
    prisma.comment.findMany({ where: { organizationId: orgId }, distinct: ["pagePath"], select: { pagePath: true, pageTitle: true }, take: 1000 }),
    prisma.comment.count({ where: { organizationId: orgId, status: "OPEN" } }),
  ]);
  const items = rows.map((c) => toDto(c, actor));

  const sections = new Map<string, string>();
  for (const p of pages) {
    const b = basePath(p.pagePath);
    if (!sections.has(b)) sections.set(b, p.pageTitle || b);
  }
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportQs = new URLSearchParams(filterEntries(commentFilterSchema, { ...f, page: "", limit: "" })).toString();
  const href = (n: number) => filterHref(commentFilterSchema, "/history/comments", f, { page: n > 1 ? String(n) : "" });

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "История", href: "/history" }, { label: "Комментарии" }]} />
      <ControlTabs active="history" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Комментарии</h1>
          <div className="text-sm text-neutral-500">
            Открытых: {openCount} · найдено: {total}
            <InfoHint wide label="О комментариях">
              <p>Замечания, ошибки, идеи и вопросы к частям проекта: кнопка «Комментарий» справа внизу на любой странице. Общий год из шапки здесь не применяется.</p>
            </InfoHint>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/comments/export?format=md${exportQs ? "&" + exportQs : ""}`} className={buttonVariants({ variant: "outline" })}>
            Скачать .md
          </a>
          <a href={`/comments/export?format=csv${exportQs ? "&" + exportQs : ""}`} className={buttonVariants({ variant: "outline" })}>
            Скачать .csv
          </a>
          <CopyTasksButton query={exportQs} />
        </div>
      </div>

      <FilterBar
        title="Фильтры комментариев"
        oneRow
        hideChips
        className="print:hidden"
        controls={[
          { type: "text", name: "q", label: "Поиск по тексту", aliases: ["dq"], placeholder: "текст, запись, автор…" },
          { type: "multi", name: "status", label: "Статус", options: COMMENT_STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v] })), allLabel: "Любой" },
          { type: "multi", name: "kind", label: "Тип", options: COMMENT_KINDS.map((v) => ({ value: v, label: KIND_LABEL[v] })), allLabel: "Любой" },
          { type: "multi", name: "priority", label: "Приоритет", more: true, options: COMMENT_PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABEL[v] })), allLabel: "Любой" },
          { type: "multi", name: "author", label: "Автор", options: authors.map((a) => ({ value: a.authorId, label: a.authorName })), allLabel: "Все" },
          { type: "multi", name: "section", label: "Страница", more: true, options: [...sections].map(([value, label]) => ({ value, label: `${label} (${value})` })), allLabel: "Все" },
          { type: "multi", name: "entity", label: "Запись", more: true, options: Object.entries(ENTITY_TITLES).map(([value, label]) => ({ value, label })), allLabel: "Любая" },
          { type: "date", name: "from", label: "С даты", more: true },
          { type: "date", name: "to", label: "По дату", more: true },
          { type: "multi", name: "sort", label: "Сортировка", single: true, state: true, options: SORT_OPTIONS, allLabel: "Сначала новые" },
        ]}
      />

      <CommentsList items={items} canManage={canManage(session.user.role)} />

      <div className="flex items-center justify-between text-sm">
        <span className="text-neutral-500">
          Страница {pageNo} из {pageCount}
        </span>
        <div className="flex gap-2">
          {pageNo > 1 && (
            <Link href={href(pageNo - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              ← Назад
            </Link>
          )}
          {pageNo < pageCount && (
            <Link href={href(pageNo + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Дальше →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
