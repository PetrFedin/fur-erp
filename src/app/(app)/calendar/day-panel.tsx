"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { removeEvent, setEventDone } from "./actions";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Раскрытый день как окно: Esc закрывает, фокус при открытии уходит на «Закрыть», Tab/Shift+Tab ходят по кругу внутри панели,
 * после закрытия фокус возвращается на элемент-источник; пока окно открыто, страница под ним не прокручивается.
 */
export function DayKeys({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = () => document.getElementById("day-panel");
    const first = panel()?.querySelector<HTMLElement>("[data-autofocus]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) { router.push(closeHref, { scroll: false }); return; }
      if (e.key !== "Tab") return;
      const p = panel();
      if (!p) return;
      const items = [...p.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (!p.contains(document.activeElement)) { e.preventDefault(); firstEl.focus(); }
      else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (opener && document.contains(opener)) opener.focus();
    };
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
      <Link href={editHref} scroll={false} className="btn btn-accent inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium hover:bg-neutral-50 max-md:min-h-10">Править</Link>
      <Button type="button" variant="outline" size="sm" disabled={pending} className="btn-accent font-medium" onClick={() => run(() => setEventDone(id, !done))}>{done ? "Вернуть в план" : "Выполнено"}</Button>
      <Button type="button" variant="outline" size="sm" disabled={pending} className="btn-accent font-medium text-red-600" onClick={async () => { if (await ask(`Удалить событие «${label}»?`, { ok: "Удалить", danger: true })) run(() => removeEvent(id)); }}>Удалить</Button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      {node}
    </div>
  );
}
