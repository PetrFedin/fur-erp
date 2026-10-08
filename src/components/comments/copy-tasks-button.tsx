"use client";

import { useState } from "react";

/** «Скопировать как задачи для разработчика»: берёт Markdown выгрузки по текущим фильтрам и кладёт в буфер обмена. */
export function CopyTasksButton({ query }: { query: string }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  return (
    <button
      type="button"
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          const res = await fetch(`/comments/export?format=md&inline=1${query ? "&" + query : ""}`, { credentials: "same-origin" });
          if (!res.ok) throw new Error(String(res.status));
          await navigator.clipboard.writeText(await res.text());
          setState("ok");
        } catch {
          setState("err");
        }
        setTimeout(() => setState("idle"), 3000);
      }}
      className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
    >
      {state === "ok" ? "Скопировано" : state === "err" ? "Не удалось скопировать" : "Скопировать как задачи для разработчика"}
    </button>
  );
}
