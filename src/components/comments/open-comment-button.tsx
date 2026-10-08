"use client";

/** Открывает панель «Комментарий» сразу в режиме «к записи» (панель живёт в шапке раздела, см. comment-widget.tsx). */
export function OpenCommentButton({ mode = "entity", children }: { mode?: "page" | "entity"; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("fur-comment-open", { detail: { mode } }))}
      className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-neutral-50"
    >
      {children}
    </button>
  );
}
