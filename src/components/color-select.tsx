"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { colorKey, suggestColorRef } from "@/lib/color-ref";
import { createColorInline } from "@/app/(app)/settings/colors/actions";

export type ColorSelectOption = { id: string; name: string; aliases: string[]; proposed?: boolean };

/**
 * Выбор цвета из справочника с поиском. В форму уходят два поля: `color` (текст) и `colorRefId` (ссылка).
 * Свободный ввод разрешён: сервер сам привяжет его к цвету по названию/синониму, а если такого нет —
 * сохранит текст, и он появится в блоке «Не сопоставлено» на /settings/colors. Кнопка «Добавить в справочник»
 * (если есть право) сразу создаёт новый цвет и выбирает его.
 */
export function ColorSelect({
  refs,
  name = "color",
  refName = "colorRefId",
  id,
  defaultValue = "",
  defaultRefId = null,
  canCreate = false,
  placeholder = "Выберите или введите цвет",
  className = "",
  onChange,
}: {
  refs: ColorSelectOption[];
  name?: string;
  refName?: string;
  id?: string;
  defaultValue?: string | null;
  defaultRefId?: string | null;
  canCreate?: boolean;
  placeholder?: string;
  className?: string;
  onChange?: (text: string, refId: string) => void;
}) {
  const [text, setText] = useState(defaultValue ?? "");
  const [refId, setRefId] = useState(defaultRefId ?? "");
  const [extra, setExtra] = useState<ColorSelectOption[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  const all = useMemo(() => [...refs, ...extra.filter((e) => !refs.some((r) => r.id === e.id))], [refs, extra]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const q = colorKey(text);
  const filtered = all.filter((r) => !q || [r.name, ...r.aliases].some((v) => colorKey(v).includes(q))).slice(0, 12);
  const exact = q ? all.find((r) => [r.name, ...r.aliases].some((v) => colorKey(v) === q)) : undefined;
  const sug = q && !exact ? suggestColorRef(text, all) : null;

  const pick = (r: ColorSelectOption) => {
    setText(r.name);
    setRefId(r.id);
    setOpen(false);
    setError("");
    onChange?.(r.name, r.id);
  };

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <input
        id={id}
        name={name}
        value={text}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const same = all.find((r) => r.id === refId);
          if (!same || colorKey(same.name) !== colorKey(v)) setRefId("");
          setError("");
          setOpen(true);
          onChange?.(v, same && colorKey(same.name) === colorKey(v) ? refId : "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
      />
      <input type="hidden" name={refName} value={refId} />
      {open && filtered.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full min-w-48 overflow-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg">
          {filtered.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => pick(r)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-neutral-100">
                <span>{r.name}</span>
                {r.proposed && <span className="text-xs text-amber-600">предложено</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {sug && (
        <p className="mt-1 text-xs text-neutral-500">
          Такого цвета нет в справочнике. Похоже:{" "}
          <button type="button" className="text-blue-600 hover:underline" onClick={() => pick(sug.ref)}>
            {sug.ref.name}
          </button>
        </p>
      )}
      {canCreate && q && !exact && (
        <button
          type="button"
          disabled={busy}
          className="mt-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            const r = await createColorInline(text);
            setBusy(false);
            if (!r.ok) return setError(r.error);
            const opt = { id: r.id, name: r.name, aliases: [] as string[] };
            setExtra((p) => [...p, opt]);
            pick(opt);
          }}
        >
          + Добавить «{text.trim()}» в справочник цветов
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
