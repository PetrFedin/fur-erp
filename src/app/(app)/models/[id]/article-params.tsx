"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { PARAM_NAME_MAX, PARAM_VALUE_MAX, type ArticleParam } from "@/lib/article-params";
import { removeArticleParam, saveArticleParam } from "../actions";

const CUSTOM = "__custom";

/**
 * Свои параметры артикула: «+ Добавить параметр» — выбрать из тех, что уже есть в фильтрах «Изделий» и у других артикулов, или вписать свой.
 * Сохраняется сразу; параметр появляется в фильтре «Параметры» списка артикулов.
 */
export function ArticleParams({
  modelId, params, nameOptions, valuesByName, canEdit,
}: {
  modelId: string;
  params: ArticleParam[];
  /** Названия для выпадающего списка: типовые + уже заданные у артикулов. */
  nameOptions: string[];
  /** Значения, уже использованные у других артикулов, по названию (подсказки). */
  valuesByName: Record<string, string[]>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(nameOptions[0] ?? CUSTOM);
  const [custom, setCustom] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const name = pick === CUSTOM ? custom : pick;
  const free = nameOptions.filter((n) => !params.some((p) => p.name.toLowerCase() === n.toLowerCase()));
  const run = (fn: () => Promise<{ error?: string }>, done?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) { setError(r.error); return; }
      done?.();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-neutral-700">Параметры</h3>
        {params.length === 0 && <span className="text-sm text-neutral-500">не заданы</span>}
        {params.map((p) => (
          <span key={p.name} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-neutral-300 bg-white py-0.5 pl-3 pr-1 text-sm">
            <span className="text-neutral-500">{p.name}:</span> <span className="font-medium">{p.value}</span>
            {canEdit && (
              <button type="button" disabled={pending} onClick={() => run(() => removeArticleParam(modelId, p.name))}
                aria-label={`Убрать параметр «${p.name}»`} title="Убрать параметр"
                className="inline-flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50">×</button>
            )}
          </span>
        ))}
        {canEdit && !open && (
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => { setOpen(true); setError(null); setPick(free[0] ?? CUSTOM); setValue(""); }}>
            + Добавить параметр
          </Button>
        )}
      </div>

      {canEdit && open && (
        <form
          className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 sm:flex-row sm:flex-wrap sm:items-end"
          onSubmit={(e) => { e.preventDefault(); run(() => saveArticleParam(modelId, name, value), () => { setOpen(false); setValue(""); setCustom(""); }); }}
        >
          <label className="flex flex-col gap-1 text-xs text-neutral-600 sm:w-56">
            Параметр
            <Select value={pick} onChange={(e) => { setPick(e.target.value); setValue(""); }}>
              {free.length > 0 && <optgroup label="Из фильтров и других артикулов">{free.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>}
              <option value={CUSTOM}>Свой параметр…</option>
            </Select>
          </label>
          {pick === CUSTOM && (
            <label className="flex flex-col gap-1 text-xs text-neutral-600 sm:w-56">
              Название
              <Input value={custom} maxLength={PARAM_NAME_MAX} onChange={(e) => setCustom(e.target.value)} placeholder="например, Застёжка" required />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-neutral-600 sm:w-64">
            Значение
            <Input value={value} maxLength={PARAM_VALUE_MAX} list={listId} onChange={(e) => setValue(e.target.value)} placeholder="например, Бежевый" required />
            <datalist id={listId}>{(valuesByName[name] ?? []).map((v) => <option key={v} value={v} />)}</datalist>
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="min-h-11 sm:min-h-9">Сохранить</Button>
            <Button type="button" variant="outline" disabled={pending} className="min-h-11 sm:min-h-9" onClick={() => setOpen(false)}>Отмена</Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
