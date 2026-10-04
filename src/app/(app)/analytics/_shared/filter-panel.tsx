import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { InfoHint } from "@/components/info-hint";
import { VAT_LABEL, type Options, type SharedFilters } from "@/lib/analytics-filters";

/** Мультивыбор без JavaScript: раскрывающийся список флажков внутри GET-формы. */
function MultiPick({ name, label, values, options, wide, fmt }: { name: string; label: string; values: string[]; options: string[]; wide?: boolean; fmt?: (v: string) => string }) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-neutral-500">
      {label}
      <details className="relative">
        <summary className={`flex h-9 cursor-pointer select-none items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 ${wide ? "w-48" : "w-40"}`}>
          <span className="truncate">{values.length === 0 ? "Все" : values.length === 1 ? (fmt ? fmt(values[0]) : values[0]) : `Выбрано: ${values.length}`}</span>
          <span aria-hidden className="text-neutral-400">▾</span>
        </summary>
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-64 max-w-[85vw] overflow-auto rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 rounded px-1 py-1.5 text-sm text-neutral-900 hover:bg-neutral-50">
              <input type="checkbox" name={name} value={o} defaultChecked={values.includes(o)} className="size-4" />
              <span className="break-words">{fmt ? fmt(o) : o}</span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * Общая панель фильтров «Изделий» и «Цен». Всё уходит в адрес страницы (GET), год и режимы 4% / НДС берутся из шапки.
 * hidden — параметры, которые форма должна сохранить (вид, сортировка, колонки, группировка …); lead — поля страницы перед общими.
 */
export function FilterPanel({
  action,
  hidden,
  f,
  opts,
  lead,
  active,
  resetHref,
  submitLabel = "Показать",
}: {
  action: string;
  hidden: [string, string][];
  f: SharedFilters;
  opts: Options;
  lead?: ReactNode;
  active: boolean;
  resetHref: string;
  submitLabel?: string;
}) {
  const sources = opts.auc.length > 0 || opts.py.length > 0 || opts.lc.length > 0;
  return (
    <form method="get" action={action} className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3">
      {hidden.map(([k, v], i) => (
        <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
      ))}
      <div className="flex flex-wrap items-end gap-2">
        {lead}
        <MultiPick name="color" label="Цвет" values={f.color} options={opts.color} />
        <MultiPick name="fur" label="Вид меха" values={f.fur} options={opts.fur} wide />
        <MultiPick name="cat" label="Категория" values={f.cat} options={opts.cat} />
        <MultiPick name="size" label="Размер" values={f.size} options={opts.size} />
        <MultiPick name="batch" label="Партия" values={f.batch} options={opts.batch} fmt={(v) => `Партия ${v}`} />
        <MultiPick name="season" label="Сезон" values={f.season} options={opts.season} />
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Ставка НДС
          <Select name="vat" defaultValue={f.vat} className="h-9 w-40">
            <option value="">Любая</option>
            {(Object.keys(VAT_LABEL) as (keyof typeof VAT_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {VAT_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Модель, артикул
          <Input name="q" defaultValue={f.q} placeholder="Код, название, № ТЗ, синоним" className="h-9 w-52" list="analytics-models" />
          <datalist id="analytics-models">
            {opts.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <div className="flex flex-col gap-1 text-xs text-neutral-500">
          <span className="flex items-center">
            Себестоимость за ед., ₽
            <InfoHint label="О фильтре себестоимости">Себестоимость единицы по ТЗ с НДС (мех + подкладка + 4% по режиму + расходы, без работы). Показываются ТЗ, попавшие в диапазон; ТЗ без себестоимости при заданном диапазоне скрываются.</InfoHint>
          </span>
          <span className="flex items-center gap-1">
            <Input name="cmin" defaultValue={f.cmin} placeholder="от" inputMode="decimal" className="h-9 w-24" />
            <span aria-hidden>–</span>
            <Input name="cmax" defaultValue={f.cmax} placeholder="до" inputMode="decimal" className="h-9 w-24" />
          </span>
        </div>
      </div>
      {sources && (
        <details className="text-sm" open={!!(f.auc.length || f.py.length || f.lc.length)}>
          <summary className="cursor-pointer select-none text-xs text-neutral-500">Откуда сырьё: аукцион, год закупки, цвет лота</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <MultiPick name="auc" label="Аукцион / сессия закупки" values={f.auc} options={opts.auc} wide />
            <MultiPick name="py" label="Год закупки сырья" values={f.py} options={opts.py} />
            <MultiPick name="lc" label="Цвет лота" values={f.lc} options={opts.lc} />
            <InfoHint label="О фильтрах по сырью" wide>ТЗ попадает в выборку, если хотя бы один из списанных в нём лотов меха подходит: аукцион (сессия) и год — по закупке лота, цвет — по справочнику цветов лота.</InfoHint>
          </div>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="onlyH" value="1" defaultChecked={f.onlyH} className="size-4" />
          только с молотком
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="onlyL" value="1" defaultChecked={f.onlyL} className="size-4" />
          только с подкладкой
        </label>
        <Button type="submit" size="sm" className="h-9">
          {submitLabel}
        </Button>
        {active && (
          <Link href={resetHref} className="text-sm text-neutral-500 underline underline-offset-2">
            Сбросить
          </Link>
        )}
      </div>
    </form>
  );
}
