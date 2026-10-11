"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { removeEvent, setEventDone } from "./actions";

/** Esc закрывает раскрытый день; пока он открыт, страница под ним не прокручивается. */
export function DayKeys({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) router.push(closeHref, { scroll: false }); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [closeHref, router]);
  return null;
}

/** Кнопки события в раскрытом дне: править, выполнено / вернуть, удалить (с подтверждением приложения). */
export function DayEventActions({ id, done, editHref, label }: { id: string; done: boolean; editHref: string; label: string }) {
  const { ask, node } = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setError(r.error ?? ""); });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link href={editHref} scroll={false} className="inline-flex min-h-9 items-center rounded-md border border-neutral-300 px-3 text-xs hover:bg-neutral-100">Править</Link>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => setEventDone(id, !done))}>{done ? "Вернуть в план" : "Выполнено"}</Button>
      <Button type="button" variant="outline" size="sm" disabled={pending} className="text-red-600" onClick={async () => { if (await ask(`Удалить событие «${label}»?`, { ok: "Удалить", danger: true })) run(() => removeEvent(id)); }}>Удалить</Button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      {node}
    </div>
  );
}
