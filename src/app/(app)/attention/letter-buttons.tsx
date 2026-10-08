"use client";

import { useState } from "react";

/** «Копировать» и «Скачать .md» для готового письма. */
export function LetterButtons({ text, filename, label }: { text: string; filename: string; label: string }) {
  const [done, setDone] = useState(false);
  const cls = "inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-100";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={cls}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          } catch {
            /* буфер недоступен — есть «Скачать» */
          }
        }}
      >
        {done ? "Скопировано" : `${label}: копировать`}
      </button>
      <button
        type="button"
        className={cls}
        onClick={() => {
          const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        Скачать .md
      </button>
    </span>
  );
}
