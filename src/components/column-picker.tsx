"use client";

import { useEffect, useId, useState } from "react";

export type PickerColumn = {
  /** Значение атрибута data-col у ячеек (<Th data-col="qty"> / <Td data-col="qty">). */
  key: string;
  label: string;
  /** Показывать по умолчанию. Колонки без этого флага убраны в «Колонки ▾». */
  on?: boolean;
  /** Всегда видна, в списке не показывается. */
  fixed?: boolean;
};

const storageKey = (id: string) => `cols:${id}`;

/**
 * «Колонки ▾» — выпадающий список настроек широкой таблицы: основные колонки на виду, остальные включаются галочками.
 * Выбор помнится в браузере (localStorage). Таблица помечается `data-colset={id}`, ячейки — `data-col={key}`; скрытие — CSS, данные те же.
 * До чтения сохранённого выбора (и без JS) показаны колонки по умолчанию: разметка сервера и клиента совпадает.
 */
export function ColumnPicker({ id, columns }: { id: string; columns: PickerColumn[] }) {
  const defaults = columns.filter((c) => c.fixed || c.on).map((c) => c.key);
  const [shown, setShown] = useState<string[]>(defaults);
  const uid = useId();

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(id));
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) setShown(columns.filter((c) => c.fixed || saved.includes(c.key)).map((c) => c.key));
    } catch {
      /* нет доступа к хранилищу — остаются колонки по умолчанию */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const save = (next: string[]) => {
    setShown(next);
    try {
      window.localStorage.setItem(storageKey(id), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const toggle = (key: string) => save(shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key]);
  const hidden = columns.filter((c) => !c.fixed && !shown.includes(c.key));
  const css = hidden.map((c) => `[data-colset="${id}"] [data-col="${c.key}"]{display:none!important}`).join("");
  const optional = columns.filter((c) => !c.fixed);

  return (
    <details className="relative print:hidden">
      {css ? <style>{css}</style> : null}
      <summary
        className="inline-flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-50 max-md:min-h-11 [&::-webkit-details-marker]:hidden"
        title="Какие колонки показывать в таблице"
      >
        Колонки <span aria-hidden className="text-neutral-500">▾</span>
        {hidden.length > 0 ? <span className="text-xs font-normal text-neutral-500">· скрыто {hidden.length}</span> : null}
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg" role="group" aria-label="Колонки таблицы">
        <ul className="max-h-80 overflow-y-auto">
          {optional.map((c) => {
            const fid = `${uid}-${c.key}`;
            return (
              <li key={c.key}>
                <label htmlFor={fid} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-neutral-50">
                  <input id={fid} type="checkbox" className="accent-neutral-900" checked={shown.includes(c.key)} onChange={() => toggle(c.key)} />
                  {c.label}
                </label>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => save(defaults)} className="mt-1 min-h-9 w-full rounded px-2 text-left text-xs text-blue-700 hover:underline">
          Основные колонки
        </button>
      </div>
    </details>
  );
}
