"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStatusAction } from "@/app/(app)/comments/actions";
import { CommentCard, type CardComment } from "./comment-card";

/** Список на странице «Комментарии»: карточки и массовая отметка «Учтено». */
export function CommentsList({ items, canManage }: { items: CardComment[]; canManage: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const bulk = (status: string) =>
    start(async () => {
      setErr("");
      const r = await setStatusAction([...sel], status, note);
      if (!r.ok) setErr(r.error ?? "Не получилось.");
      else {
        setSel(new Set());
        setNote("");
        router.refresh();
      }
    });

  if (items.length === 0) return <p className="rounded-md border border-dashed border-neutral-300 px-3 py-6 text-center text-sm text-neutral-500">Комментариев по этим фильтрам нет.</p>;

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={sel.size === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} className="size-4" />
            Выбрать все на странице
          </label>
          {sel.size > 0 && (
            <>
              <span className="text-neutral-500">Выбрано: {sel.size}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Как учтено (для всех выбранных)" aria-label="Как учтено" className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 sm:max-w-sm" />
              <button type="button" disabled={pending} onClick={() => bulk("DONE")} className="rounded-md bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">
                Отметить учтёнными
              </button>
              <button type="button" disabled={pending} onClick={() => bulk("OPEN")} className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-50">
                Вернуть в открытые
              </button>
            </>
          )}
          {err && <span role="alert" className="text-red-700">{err}</span>}
        </div>
      )}
      {items.map((c) => (
        <CommentCard key={c.id} c={c} showPage selected={sel.has(c.id)} onSelect={canManage ? (on) => toggle(c.id, on) : undefined} />
      ))}
    </div>
  );
}
