"use client";
import { useState } from "react";
import { emptyFilters } from "@/lib/lot-table";
import { AddFieldButton, MobileFieldsManager } from "../custom-field-controls";
import { FilterPanel } from "../lots-filters";
import { ALL_SCOPE, useLots, useScope } from "../lots-state";
import { MobileSummary } from "./totals";

/** Панель над таблицей: «Фильтр», выбор лотов, «Только выбранные», «Сбросить», «+ Столбец». */
export function LotsControls({ scope }: { scope: string }) {
  const { setFilters, setSelected, canEdit } = useLots();
  const view = useScope(scope);
  const [open, setOpen] = useState(false);
  const f = view.filters;
  const selectedAll = view.selectedAll;
  const allVisibleSelected = view.visible.length > 0 && view.selectedVisible.length === view.visible.length;
  return (
    <div className="flex flex-col gap-2">
      <MobileSummary view={view} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-filter-toggle
          className="ui-field inline-flex h-8 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium"
        >
          Фильтр{view.filterCount > 0 ? ` (${view.filterCount})` : ""} <span className="text-neutral-500">{open ? "▴" : "▾"}</span>
        </button>
        <button
          type="button"
          className="ui-field inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs"
          onClick={() => setSelected(view.visible.map((r) => r.id), !allVisibleSelected)}
        >
          {allVisibleSelected ? "Снять выбор" : "Выбрать все"}
        </button>
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" className="h-5 w-5 sm:h-4 sm:w-4" checked={f.onlySelected} onChange={(e) => setFilters(scope, { ...f, onlySelected: e.target.checked })} />
          Только выбранные
        </label>
        {view.filterCount > 0 && (
          <button type="button" className="inline-flex h-8 items-center text-xs text-blue-600 hover:underline" onClick={() => setFilters(scope, emptyFilters())}>
            Сбросить
          </button>
        )}
        {selectedAll > 0 && (
          <button type="button" className="inline-flex h-8 items-center text-xs text-blue-600 hover:underline" onClick={() => setSelected(view.all.map((r) => r.id), false)}>
            Снять выбор ({selectedAll})
          </button>
        )}
        {canEdit && <AddFieldButton label="Столбец" />}
        <span className="text-xs text-neutral-500" data-selection-label>
          {view.label}
        </span>
      </div>
      <MobileFieldsManager />
      {view.hiddenSelected > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-amber-700" data-hidden-selection>
          <span>
            Выбрано {selectedAll} (из них скрыто фильтром {view.hiddenSelected})
          </span>
          <button type="button" className="inline-flex h-8 items-center text-blue-600 hover:underline" onClick={() => setSelected(view.all.map((r) => r.id), false)}>
            Снять выбор
          </button>
        </p>
      )}
      {scope !== ALL_SCOPE && view.globalFilterCount > 0 && (
        <p className="text-xs text-amber-700">Действует общий фильтр аукциона ({view.globalFilterCount}) — часть лотов скрыта.</p>
      )}
      {open && <FilterPanel scope={scope} />}
    </div>
  );
}
