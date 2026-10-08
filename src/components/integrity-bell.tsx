"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { IntegritySummary } from "@/lib/integrity/types";

const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.abs(v));

/**
 * Колокольчик самопроверки в шапке: число расхождений (красных и жёлтых), выпадающий список «что не сходится / на сколько / где исправить».
 * Подгружается после отрисовки страницы через /api/integrity (кэш на сервере 60 с) — страницы не ждут.
 */
export function IntegrityBell() {
  const [s, setS] = useState<IntegritySummary | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      fetch("/api/integrity", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => live && j && setS(j as IntegritySummary))
        .catch(() => {});
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const red = (s?.failingErrors ?? 0) > 0;
  const n = s?.failing ?? 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={s ? (n ? `Самопроверка: расхождений ${n}` : "Самопроверка: всё сходится") : "Самопроверка"}
        title={s ? (n ? `Не сходится: ${n}` : "Всё сходится") : "Самопроверка данных"}
        className="relative flex size-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {n > 0 && (
          <span className={cn("absolute -right-1.5 -top-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums", red ? "bg-red-600" : "bg-amber-500")}>{n > 99 ? "99+" : n}</span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 z-50 max-h-[75vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[26rem]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold text-neutral-900">Самопроверка данных</div>
            <Link href="/integrity" onClick={() => setOpen(false)} className="text-xs text-blue-700 hover:underline">Все проверки</Link>
          </div>
          {!s && <div className="py-3 text-neutral-500">Проверяем…</div>}
          {s && n === 0 && <div className="py-3 text-emerald-700">Всё сходится{s.knownCount ? ` (известных расхождений: ${s.knownCount})` : ""}.</div>}
          {s && n > 0 && (
            <ul className="space-y-2">
              {s.items.map((it, i) => (
                <li key={i} className="rounded-md border border-neutral-100 p-2">
                  <div className="flex items-start gap-2">
                    <span className={cn("mt-1 size-2 shrink-0 rounded-full", it.severity === "error" ? "bg-red-600" : "bg-amber-500")} aria-hidden />
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500">{it.title}</div>
                      <div className="text-neutral-900">{it.message}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                        {it.delta != null && <span className="font-medium tabular-nums text-neutral-700">на {fmt(it.delta)} {it.unit}</span>}
                        <Link href={it.href} onClick={() => setOpen(false)} className="text-blue-700 hover:underline">Исправить: {it.entityLabel}</Link>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {s.more > 0 && <li className="text-xs text-neutral-500">…и ещё {s.more}. <Link href="/integrity" onClick={() => setOpen(false)} className="text-blue-700 hover:underline">Показать все</Link></li>}
            </ul>
          )}
          {s && <div className="mt-2 text-[11px] text-neutral-400">Проверено {new Date(s.checkedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}{s.knownCount ? ` · известных (не в счёт): ${s.knownCount}` : ""}</div>}
        </div>
      )}
    </div>
  );
}
