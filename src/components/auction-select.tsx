"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { auctionKey } from "@/lib/auction-key";
import { createAuctionInline } from "@/app/(app)/settings/auctions/actions";

export type AuctionSelectOption = { id: string; name: string; fullName?: string | null; house?: string | null; year?: number | null; aliases: string[] };

/**
 * Выбор аукциона из справочника (Настройки → Аукционы) с поиском по короткому имени, прежним написаниям и дому.
 * В форму уходят два поля: `auctionId` (запись справочника) и `auctionSession` (кэш-текст = короткое имя) —
 * сервер сверяет их и записывает в закупку. Свободный текст не принимается: вводимое — только строка поиска.
 * Если у закупки старый текст, которого нет в справочнике, он остаётся как есть, пока не выбран аукцион.
 * «+ Добавить аукцион» (если есть право) создаёт запись в справочнике и выбирает её.
 */
export function AuctionSelect({
  refs,
  id,
  name = "auctionSession",
  idName = "auctionId",
  defaultId = null,
  legacyText = "",
  canCreate = false,
}: {
  refs: AuctionSelectOption[];
  id?: string;
  name?: string;
  idName?: string;
  defaultId?: string | null;
  /** Текст закупки, не найденный в справочнике (сохраняется, если аукцион не выбирали). */
  legacyText?: string;
  canCreate?: boolean;
}) {
  const [extra, setExtra] = useState<AuctionSelectOption[]>([]);
  const all = useMemo(() => [...refs, ...extra.filter((e) => !refs.some((r) => r.id === e.id))], [refs, extra]);
  const [selId, setSelId] = useState(defaultId ?? "");
  const [text, setText] = useState(defaultId ? (refs.find((r) => r.id === defaultId)?.name ?? "") : legacyText);
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
        setTyping(false);
        // не выбрали — возвращаем показ выбранного
        setText((t) => (selId ? (all.find((r) => r.id === selId)?.name ?? t) : legacyText ? legacyText : ""));
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [selId, all, legacyText]);

  const q = typing ? auctionKey(text) : "";
  const filtered = all.filter((r) => !q || [r.name, ...r.aliases, r.house ?? "", r.fullName ?? ""].some((v) => auctionKey(v).includes(q))).slice(0, 14);
  const exact = q ? all.find((r) => [r.name, ...r.aliases].some((v) => auctionKey(v) === q)) : undefined;
  const sel = all.find((r) => r.id === selId);

  const pick = (r: AuctionSelectOption | null) => {
    setSelId(r?.id ?? "");
    setText(r?.name ?? "");
    setTyping(false);
    setOpen(false);
    setError("");
  };

  return (
    <div ref={wrap} className="relative">
      <input
        id={id}
        value={text}
        autoComplete="off"
        placeholder="Выберите аукцион из справочника"
        onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
        onChange={(e) => { setText(e.target.value); setTyping(true); setOpen(true); setError(""); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setTyping(false); }
          if (e.key === "Enter" && open) {
            e.preventDefault();
            if (filtered[0]) pick(filtered[0]);
          }
        }}
        className="flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
      />
      {/* кэш-текст: короткое имя выбранного; если не выбран — прежний текст закупки (он не из справочника) или пусто */}
      <input type="hidden" name={name} value={sel ? sel.name : legacyText} />
      <input type="hidden" name={idName} value={selId} />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg">
          <li>
            <button type="button" onClick={() => pick(null)} className="w-full px-3 py-1.5 text-left text-neutral-500 hover:bg-neutral-100">Без аукциона</button>
          </li>
          {filtered.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => pick(r)} className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-neutral-100">
                <span className={r.id === selId ? "font-medium" : ""}>{r.name}</span>
                {(r.house || r.fullName) && <span className="text-xs text-neutral-500">{r.fullName ?? r.house}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-1.5 text-neutral-500">Такого аукциона нет в справочнике</li>}
        </ul>
      )}
      {!sel && legacyText && !typing && (
        <p className="mt-1 text-xs text-amber-700">Текущее значение «{legacyText}» не из справочника — выберите аукцион из списка.</p>
      )}
      {canCreate && typing && text.trim().length >= 2 && !exact && (
        <button
          type="button"
          disabled={busy}
          className="mt-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            const r = await createAuctionInline(text);
            setBusy(false);
            if (!r.ok) return setError(r.error);
            const opt = { id: r.id, name: r.name, aliases: [] as string[] };
            setExtra((p) => [...p, opt]);
            pick(opt);
          }}
        >
          + Добавить аукцион «{text.trim()}» в справочник
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
