import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { fmtMsk, type CKind, type CPriority, type CStatus } from "@/lib/comments-core";
import { KindBadge, PriorityBadge, StatusBadge } from "./comment-badges";
import { OpenCommentButton } from "./open-comment-button";

/**
 * «Комментарии к записи» на карточке (закупка, ТЗ, партия, модель…): свёрнутый блок рядом с «История изменений».
 * Показывает комментарии, оставленные к этой записи с любой страницы; видят все вошедшие.
 */
export async function RecordComments({ entityType, entityId }: { entityType: string; entityId: string }) {
  const session = await getFreshSession();
  if (!session) return null;
  if (!("comment" in prisma)) return null;
  const rows = await prisma.comment.findMany({
    where: { organizationId: session.user.organizationId, entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { _count: { select: { replies: true } } },
  });
  const open = rows.filter((r) => r.status === "OPEN").length;
  return (
    <details className="rounded-md border border-neutral-200 bg-white text-sm" data-record-comments data-comment-anchor="record-comments" data-comment-label="Комментарии к записи">
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-neutral-700">
        Комментарии к записи {rows.length > 0 ? `(${rows.length}${rows.length === 20 ? "+" : ""}${open ? `, открытых ${open}` : ""})` : "— пока нет"}
      </summary>
      <div className="flex flex-col gap-2 border-t border-neutral-100 px-3 py-2">
        {rows.map((c) => (
          <div key={c.id} className="flex flex-col gap-1 border-b border-neutral-100 pb-2 last:border-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
              <StatusBadge status={c.status as CStatus} />
              <KindBadge kind={c.kind as CKind} />
              <PriorityBadge priority={c.priority as CPriority} />
              <span>
                {c.authorName} ({c.authorRole}) · {fmtMsk(c.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words">{c.text}</p>
            {c.resolutionNote && c.status !== "OPEN" && <p className="text-xs text-emerald-800">Как учтено: {c.resolutionNote}</p>}
            <div className="flex gap-3 text-xs">
              {c._count.replies > 0 && <span className="text-neutral-500">ответов: {c._count.replies}</span>}
              <Link href={`/comments?q=${encodeURIComponent(c.entityLabel ?? "")}#c-${c.id}`} className="text-blue-700 hover:underline">
                открыть в списке
              </Link>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <OpenCommentButton mode="entity">Оставить комментарий к записи</OpenCommentButton>
          <Link href={`/comments?entity=${encodeURIComponent(entityType)}`} className="text-xs text-blue-700 hover:underline">
            все комментарии к записям этого типа
          </Link>
        </div>
      </div>
    </details>
  );
}
