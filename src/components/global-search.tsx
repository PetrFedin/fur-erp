"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Item = { href: string; title: string; sub?: string };
type Group = { key: string; label: string; all: string; items: Item[] };

/**
 * Простой глобальный поиск по номерам в шапке: ТЗ, лоты, закупки, оплаты, артикулы, контрагенты (GET /api/search).
 * «/» и Ctrl/Cmd+K — в поле; набор (250 мс) или Enter — результаты; Esc закрывает. На телефоне — иконка, поле раскрывается.
 */
export function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback(async (text: string) => {
    const my = ++seq.current;
    if (text.trim().length < 2) {
      setGroups(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(text.trim())}`, { cache: "no-store" });
      if (my !== seq.current) return;
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { groups: Group[] };
      setGroups(data.groups);
      setFailed(false);
    } catch {
      if (my === seq.current) {
        setGroups(null);
        setFailed(true);
      }
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void run(q), 250);
    return () => clearTimeout(t);
  }, [q, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (ctrlK || (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        setMobileOpen(true);
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const close = () => {
    setOpen(false);
    setMobileOpen(false);
  };
  const shown = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative print:hidden">
      <button
        type="button"
        aria-label="Найти по номеру"
        onClick={() => {
          setMobileOpen(true);
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={"flex min-h-8 min-w-8 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-600 md:hidden " + (mobileOpen ? "hidden" : "")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </button>
      <div className={(mobileOpen ? "max-md:fixed max-md:inset-x-2 max-md:top-2 max-md:z-50 max-md:block" : "max-md:hidden") + " md:block"}>
        <input
          ref={inputRef}
          type="search"
          value={q}
          role="combobox"
          aria-expanded={shown}
          aria-label="Найти по номеру"
          placeholder="Найти по номеру…  ( / )"
          autoComplete="off"
          maxLength={60}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              close();
              inputRef.current?.blur();
            } else if (e.key === "Enter") {
              void run(q);
            }
          }}
          className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-900 placeholder:text-neutral-400 md:w-40 lg:w-48 min-[1360px]:w-72"
        />
        {shown && (
          <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 text-sm shadow-lg max-md:fixed max-md:inset-x-2 max-md:top-12 max-md:w-auto md:w-[26rem]">
            {loading && !groups && <p className="px-3 py-2 text-neutral-500">Ищу…</p>}
            {failed && <p className="px-3 py-2 text-red-700">Не удалось выполнить поиск</p>}
            {groups && groups.length === 0 && !loading && <p className="px-3 py-2 text-neutral-500">Ничего не найдено</p>}
            {groups?.map((g) => (
              <div key={g.key} className="py-1">
                <div className="flex items-center justify-between px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  <span>{g.label}</span>
                  <Link href={g.all} onClick={close} className="normal-case tracking-normal text-blue-700 hover:underline">Все результаты</Link>
                </div>
                {g.items.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => {
                      close();
                      router.prefetch(it.href);
                    }}
                    className="block rounded-md px-3 py-1.5 hover:bg-neutral-100"
                  >
                    <div className="truncate font-medium text-neutral-900">{it.title}</div>
                    {it.sub ? <div className="truncate text-xs text-neutral-500">{it.sub}</div> : null}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
