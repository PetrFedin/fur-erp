"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeModelCode } from "@/lib/model-code";
import { createArticleInline } from "@/app/(app)/plan/actions";

export type ArticleOption = {
  id: string;
  name: string;
  category: string | null;
  salesCode: string | null;
  salesName: string | null;
  aliases: string[];
};

export type ArticleValue = { code: string; modelId: string | null };

const norm = (s: string | null | undefined) => normalizeModelCode((s ?? "").trim()).toLowerCase();

/**
 * Выбор артикула из справочника с поиском (по коду, названию, коду продаж, синонимам) ИЛИ ввод нового.
 * Нет в справочнике — подпись «будет сохранён как введённый» и кнопка «Завести в справочник артикулов».
 * Временный простой выбор: общий компонент выбора артикула заменит его.
 */
export function PlanArticlePicker({
  options,
  value,
  onChange,
  canCreate = false,
  id,
  placeholder = "Артикул: выберите или введите",
  inputRef,
}: {
  options: ArticleOption[];
  value: ArticleValue;
  onChange: (v: ArticleValue) => void;
  canCreate?: boolean;
  id?: string;
  placeholder?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extra, setExtra] = useState<ArticleOption[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const all = useMemo(() => [...options, ...extra.filter((e) => !options.some((o) => o.id === e.id))], [options, extra]);

  useEffect(() => {
    const close = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const q = norm(value.code);
  const hay = (o: ArticleOption) => [o.name, o.salesCode, o.salesName, o.category, ...o.aliases].map(norm);
  const found = all.filter((o) => !q || hay(o).some((h) => h.includes(q))).slice(0, 15);
  const exact = q ? all.find((o) => [o.name, o.salesCode, ...o.aliases].some((v) => norm(v) === q)) : undefined;

  return (
    <div ref={wrap} className="relative">
      <input
        id={id}
        ref={inputRef}
        value={value.code}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setError("");
          setOpen(true);
          onChange({ code: e.target.value, modelId: null });
        }}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm shadow-sm placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
      />
      {open && found.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full min-w-56 overflow-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg">
          {found.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-neutral-100"
                onClick={() => {
                  onChange({ code: o.name, modelId: o.id });
                  setOpen(false);
                }}
              >
                <span className="font-medium">{o.name}</span>
                {(o.category || o.salesName) && <span className="ml-2 text-xs text-neutral-500">{(o.salesName || o.category || "").replace(/\s+/g, " ").slice(0, 40)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.code.trim() && (
        <p className="mt-1 text-xs text-neutral-500">
          {value.modelId || exact ? (
            <span className="text-emerald-700">Есть в справочнике артикулов{exact && !value.modelId ? ": будет привязан" : ""}</span>
          ) : (
            <>
              Нет в справочнике — сохранится как введённый.
              {canCreate && (
                <button
                  type="button"
                  disabled={busy}
                  className="ml-1 text-blue-600 hover:underline disabled:opacity-50"
                  onClick={async () => {
                    setBusy(true);
                    const r = await createArticleInline(value.code, "");
                    setBusy(false);
                    if (!r.ok) return setError(r.error);
                    setExtra((p) => [...p, { id: r.id, name: r.name, category: null, salesCode: null, salesName: null, aliases: [] }]);
                    onChange({ code: r.name, modelId: r.id });
                  }}
                >
                  Завести в справочник артикулов
                </button>
              )}
            </>
          )}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
