"use client";

import { useEffect, useRef, useState } from "react";
import { createArticleQuick } from "@/app/(app)/settings/articles-ref/actions";
import { articleKey, SPELLING_LABEL, type ArticleLite, type SpellingKind } from "@/lib/article-key";
import { cn } from "@/lib/utils";

/**
 * Выбор артикула из справочника (ProductModel) с поиском по ЛЮБОМУ написанию: наш код (M012 / М012), SKU, код или название
 * в системе продаж, другие написания, часть названия. Если нужного артикула нет — «+ Ввести новый артикул».
 *
 * Использование (форма с обычным <form action>):
 *   <ArticleSelect name="productModelId" defaultValue={model?.id} required />
 * Значение (id артикула) уходит в скрытое поле `name`. Для клиентской логики: onChange(article | null).
 * Права на создание нового — те же, что у справочника артикулов (владелец, администратор, технолог); без прав кнопка просто не сработает с сообщением.
 */
type Item = ArticleLite & { via: { text: string; kind: SpellingKind } | null };

export function ArticleSelect({
  name = "productModelId",
  defaultValue,
  required,
  disabled,
  allowCreate = true,
  onlyActive = false,
  placeholder = "Артикул: код, код в продажах, название…",
  className,
  onChange,
}: {
  name?: string;
  defaultValue?: string | null;
  required?: boolean;
  disabled?: boolean;
  allowCreate?: boolean;
  onlyActive?: boolean;
  placeholder?: string;
  className?: string;
  onChange?: (article: ArticleLite | null) => void;
}) {
  const [value, setValue] = useState<string>(defaultValue ?? "");
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Подпись выбранного значения по умолчанию.
  useEffect(() => {
    if (!defaultValue) return;
    let off = false;
    fetch(`/api/article-ref?id=${encodeURIComponent(defaultValue)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j: { items: Item[] }) => {
        if (!off && j.items[0]) setText(j.items[0].name);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [defaultValue]);

  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    const h = setTimeout(() => {
      const qs = new URLSearchParams({ q: value ? "" : text, limit: "12" });
      if (onlyActive) qs.set("active", "1");
      fetch(`/api/article-ref?${qs}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((j: { items: Item[] }) => {
          if (my === seq.current) setItems(j.items);
        })
        .catch(() => {});
    }, 150);
    return () => clearTimeout(h);
  }, [text, open, value, onlyActive]);

  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  function choose(a: ArticleLite | null) {
    setValue(a?.id ?? "");
    setText(a?.name ?? "");
    setOpen(false);
    setErr("");
    onChange?.(a);
  }

  const q = text.trim();
  const exact = items.some((i) => articleKey(i.name) === articleKey(q));
  const canCreate = allowCreate && !value && q.length >= 2 && !exact;

  return (
    <div ref={box} className={cn("relative", className)}>
      <input type="hidden" name={name} value={value} />
      <input
        type="text"
        value={text}
        disabled={disabled}
        required={required && !value}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          if (value) {
            setValue("");
            onChange?.(null);
          }
          setOpen(true);
        }}
        className="flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm shadow-sm placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-50"
      />
      {open && !disabled && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full min-w-72 overflow-auto rounded-md border border-neutral-200 bg-white text-sm shadow-lg">
          {items.map((a) => (
            <li key={a.id}>
              <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100" onClick={() => choose(a)}>
                <span className="font-medium">{a.name}</span>
                {!a.isActive && <span className="ml-1 text-xs text-neutral-400">(не активен)</span>}
                <span className="ml-2 text-neutral-500">{(a.category ?? "").replace(/\s+/g, " ").slice(0, 50)}</span>
                {(a.salesCode || (a.via && a.via.kind !== "name")) && (
                  <span className="block text-xs text-neutral-400">
                    {a.salesCode ? `в продажах: ${a.salesCode}` : ""}
                    {a.via && a.via.kind !== "name" ? `${a.salesCode ? " · " : ""}найдено по: ${SPELLING_LABEL[a.via.kind]} «${a.via.text}»` : ""}
                  </span>
                )}
              </button>
            </li>
          ))}
          {items.length === 0 && !canCreate && <li className="px-3 py-2 text-neutral-400">Ничего не найдено</li>}
          {canCreate && (
            <li className="border-t border-neutral-100">
              <button
                type="button"
                disabled={busy}
                className="block w-full px-3 py-2 text-left text-blue-700 hover:bg-neutral-100"
                onClick={async () => {
                  setBusy(true);
                  setErr("");
                  const r = await createArticleQuick(q);
                  setBusy(false);
                  if (r.error || !r.article) setErr(r.error ?? "Не удалось создать");
                  else choose(r.article);
                }}
              >
                + Ввести новый артикул «{q}»
              </button>
            </li>
          )}
          {err && <li className="px-3 py-2 text-red-700">{err}</li>}
        </ul>
      )}
    </div>
  );
}
