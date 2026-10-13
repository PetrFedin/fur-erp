"use client";

import { useState } from "react";

/** Длинная заметка в таблице: первые `max` знаков + «ещё» (раскрывается по клику, полный текст в title). Только показ. */
export function ClampText({ text, max = 120, className }: { text: string; max?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  if (text.length <= max + 20) return <span className={className}>{text}</span>;
  return (
    <span className={className} title={open ? undefined : text}>
      {open ? text : `${text.slice(0, max).trimEnd()}…`}{" "}
      <button type="button" className="text-blue-700 hover:underline" onClick={() => setOpen(!open)}>{open ? "свернуть" : "ещё"}</button>
    </span>
  );
}
