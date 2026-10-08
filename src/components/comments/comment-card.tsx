"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { COMMENT_KINDS, COMMENT_PRIORITIES, COMMENT_STATUSES, KIND_LABEL, MAX_TEXT, PRIORITY_LABEL, STATUS_LABEL, commentHref, contextText, fmtMsk, type CommentContext } from "@/lib/comments-core";
import type { CommentDto } from "@/lib/comments-service";
import { addReplyAction, deleteCommentAction, setStatusAction, updateCommentAction } from "@/app/(app)/comments/actions";
import { KindBadge, PriorityBadge, StatusBadge } from "./comment-badges";

export type CardComment = CommentDto & { pageTitle?: string; context?: CommentContext };

/**
 * Одна ветка: текст, автор, место, ответы, смена статуса, правка и удаление (по правам из dto).
 * Текст выводится как текст React (экранируется), переносы строк сохраняются.
 */
export function CommentCard({
  c,
  selected,
  onSelect,
  showPage = false,
  onChanged,
  compact = false,
}: {
  c: CardComment;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  showPage?: boolean;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);
  const [kind, setKind] = useState(c.kind);
  const [prio, setPrio] = useState(c.priority);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState(c.status);
  const [note, setNote] = useState(c.resolutionNote ?? "");
  const [statusOpen, setStatusOpen] = useState(false);

  const done = () => {
    onChanged?.();
    router.refresh();
  };
  const run = (f: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setErr("");
      const r = await f();
      if (!r.ok) setErr(r.error ?? "Не получилось.");
      else {
        after?.();
        done();
      }
    });

  const ctxLine = c.context ? contextText(c.context) : "";
  const field = "rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm";

  return (
    <article id={`c-${c.id}`} className={cn("rounded-lg border bg-white p-3 text-sm", c.status === "OPEN" ? "border-neutral-300" : "border-neutral-200 opacity-90")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {onSelect && <input type="checkbox" checked={!!selected} onChange={(e) => onSelect(e.target.checked)} aria-label="Выбрать комментарий" className="size-4" />}
        <StatusBadge status={c.status} />
        <KindBadge kind={c.kind} />
        <PriorityBadge priority={c.priority} />
        <span className="text-xs text-neutral-500">
          {c.authorName} ({c.authorRole}) · {fmtMsk(new Date(c.createdAt))}
        </span>
      </div>

      {showPage && (
        <div className="mt-1 text-xs text-neutral-500">
          {c.pageTitle ? `${c.pageTitle} · ` : ""}
          <span className="font-mono">{c.pagePath}</span>
          {c.anchor ? ` · блок: ${c.anchorLabel ?? c.anchor}` : ""}
          {c.entityLabel ? ` · запись: ${c.entityLabel}` : ""}
        </div>
      )}
      {!showPage && (c.anchor || c.entityLabel) && (
        <div className="mt-1 text-xs text-neutral-500">
          {c.anchor ? `Блок: ${c.anchorLabel ?? c.anchor}` : ""}
          {c.anchor && c.entityLabel ? " · " : ""}
          {c.entityLabel ? `Запись: ${c.entityLabel}` : ""}
        </div>
      )}

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_TEXT} rows={4} className={cn(field, "w-full")} aria-label="Текст комментария" />
          <div className="flex flex-wrap gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={field} aria-label="Тип">
              {COMMENT_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
            <select value={prio} onChange={(e) => setPrio(e.target.value as typeof prio)} className={field} aria-label="Приоритет">
              {COMMENT_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
            <button type="button" disabled={pending} onClick={() => run(() => updateCommentAction(c.id, text, kind, prio), () => setEditing(false))} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">
              Сохранить
            </button>
            <button type="button" onClick={() => { setEditing(false); setText(c.text); }} className="rounded-md border border-neutral-300 px-3 py-1 text-sm">
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words">{c.text}</p>
      )}
      {c.quote && <blockquote className="mt-2 border-l-2 border-neutral-300 pl-2 text-xs italic text-neutral-600">«{c.quote}»</blockquote>}
      {c.resolutionNote && c.status !== "OPEN" && (
        <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-900">Как учтено: {c.resolutionNote}</p>
      )}
      {ctxLine && !compact && (
        <details className="mt-2 text-xs text-neutral-500">
          <summary className="cursor-pointer select-none">Контекст при создании</summary>
          <p className="mt-1 break-words">{ctxLine}</p>
        </details>
      )}

      {c.replies.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5 border-t border-neutral-100 pt-2">
          {c.replies.map((r) => (
            <li key={r.id} className="text-xs">
              <span className="font-medium text-neutral-700">{r.authorName}</span> <span className="text-neutral-400">({r.authorRole}) · {fmtMsk(new Date(r.createdAt))}</span>
              <p className="whitespace-pre-wrap break-words text-neutral-800">{r.text}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={commentHref(c)}
          onClick={(e) => {
            // Та же страница с теми же фильтрами: не перезагружаем, а прокручиваем и подсвечиваем блок.
            if (c.pagePath === window.location.pathname + window.location.search) {
              e.preventDefault();
              if (c.anchor) window.dispatchEvent(new CustomEvent("fur-comment-flash", { detail: { anchor: c.anchor } }));
            }
          }}
          className="font-medium text-blue-700 hover:underline"
        >
          Открыть место
        </Link>
        {c.canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-neutral-600 hover:underline">
            Править
          </button>
        )}
        {c.canDelete && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Удалить комментарий вместе с ответами?")) run(() => deleteCommentAction(c.id));
            }}
            className="text-red-700 hover:underline"
          >
            Удалить
          </button>
        )}
        {c.canManage && (
          <button type="button" onClick={() => setStatusOpen((v) => !v)} className="text-neutral-600 hover:underline">
            Статус…
          </button>
        )}
      </div>

      {statusOpen && c.canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 p-2">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={field} aria-label="Статус">
            {COMMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          {status !== "OPEN" && (
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Как учтено (необязательно)" className={cn(field, "min-w-0 flex-1")} aria-label="Как учтено" />
          )}
          <button type="button" disabled={pending} onClick={() => run(() => setStatusAction([c.id], status, note), () => setStatusOpen(false))} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">
            Применить
          </button>
        </div>
      )}

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reply.trim()) return;
          run(() => addReplyAction(c.id, reply), () => setReply(""));
        }}
      >
        <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} placeholder="Ответить…" aria-label="Ответ на комментарий" className={cn(field, "min-w-0 flex-1")} />
        <button type="submit" disabled={pending || !reply.trim()} className="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50">
          Ответить
        </button>
      </form>
      {err && <p role="alert" className="mt-1 text-xs text-red-700">{err}</p>}
    </article>
  );
}
