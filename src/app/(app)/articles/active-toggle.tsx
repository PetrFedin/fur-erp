"use client";

import { useState, useTransition } from "react";
import { setModelActive } from "./active-actions";

/** Переключатель «Вкл / Выкл» модели: выкл — нет в наличии, строка приглушена. Без права правки — только подпись. */
export function ActiveToggle({ modelId, active, canEdit }: { modelId: string; active: boolean; canEdit: boolean }) {
  const [on, setOn] = useState(active);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const label = on ? "Вкл" : "Выкл";
  if (!canEdit) return <span className={on ? "text-emerald-800" : "text-neutral-500"}>{label}</span>;
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button" role="switch" aria-checked={on} aria-label={`Модель ${on ? "включена" : "выключена"}`} disabled={pending}
        onClick={() => { const next = !on; setOn(next); setErr(""); start(async () => { const r = await setModelActive(modelId, next); if (r.error) { setOn(!next); setErr(r.error); } }); }}
        className="inline-flex min-h-11 items-center gap-2 rounded-full px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 md:min-h-9"
      >
        <span aria-hidden className={"relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors " + (on ? "bg-emerald-600" : "bg-neutral-300")}>
          <span className={"absolute top-0.5 size-4 rounded-full bg-white shadow transition-all " + (on ? "left-[1.125rem]" : "left-0.5")} />
        </span>
        <span className={"text-xs font-medium " + (on ? "text-emerald-800" : "text-neutral-500")}>{label}</span>
      </button>
      {err ? <span role="alert" className="text-xs text-red-700">{err}</span> : null}
    </span>
  );
}
