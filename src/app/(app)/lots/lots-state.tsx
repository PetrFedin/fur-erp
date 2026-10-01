"use client";

// Общее состояние таблиц лотов режима «Аукцион»: выбор лотов (общий для всех счетов и итога аукциона),
// фильтры (у каждого счёта свои + общий фильтр аукциона) и локальные значения своих столбцов.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import type { CustomFieldDef, ExtraValue } from "@/lib/custom-fields";
import {
  activeFilterCount,
  computeTotals,
  emptyFilters,
  rowMatches,
  type Filters,
  type LotRow,
  type PurchaseMeta,
  type Totals,
} from "@/lib/lot-table";
import { aggregateCostParts, type CostBreakdownResult, type PartsPurchase } from "@/lib/auction-cost-parts";

export const ALL_SCOPE = "ALL";

type Ctx = {
  rows: LotRow[];
  purchases: Map<string, PurchaseMeta>;
  fields: CustomFieldDef[];
  canEdit: boolean;
  selected: ReadonlySet<string>;
  setSelected: (ids: string[], on: boolean) => void;
  filters: Record<string, Filters>;
  setFilters: (scope: string, f: Filters) => void;
  extraOf: (row: LotRow, fieldId: string) => ExtraValue | undefined;
  setExtra: (itemId: string, fieldId: string, v: ExtraValue | null) => void;
};

const LotsCtx = createContext<Ctx | null>(null);

export function LotsProvider({
  rows,
  purchases,
  fields,
  canEdit,
  children,
}: {
  rows: LotRow[];
  purchases: PurchaseMeta[];
  fields: CustomFieldDef[];
  canEdit: boolean;
  children: ReactNode;
}) {
  const [selected, setSel] = useState<ReadonlySet<string>>(() => new Set());
  const [filters, setFiltersState] = useState<Record<string, Filters>>({});
  // Значения, которые пользователь уже сохранил: перекрывают серверные, пока страница не перечитана.
  const [overlay, setOverlay] = useState<Record<string, ExtraValue | null>>({});

  const purchaseMap = useMemo(() => new Map(purchases.map((p) => [p.id, p])), [purchases]);

  const setSelected = useCallback((ids: string[], on: boolean) => {
    setSel((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const setFilters = useCallback((scope: string, f: Filters) => setFiltersState((p) => ({ ...p, [scope]: f })), []);
  const extraOf = useCallback(
    (row: LotRow, fieldId: string): ExtraValue | undefined => {
      const k = `${row.id}:${fieldId}`;
      if (k in overlay) return overlay[k] ?? undefined;
      return row.extra[fieldId];
    },
    [overlay],
  );
  const setExtra = useCallback(
    (itemId: string, fieldId: string, v: ExtraValue | null) => setOverlay((p) => ({ ...p, [`${itemId}:${fieldId}`]: v })),
    [],
  );

  const value = useMemo<Ctx>(
    () => ({ rows, purchases: purchaseMap, fields, canEdit, selected, setSelected, filters, setFilters, extraOf, setExtra }),
    [rows, purchaseMap, fields, canEdit, selected, setSelected, filters, setFilters, extraOf, setExtra],
  );
  return <LotsCtx.Provider value={value}>{children}</LotsCtx.Provider>;
}

export function useLots(): Ctx {
  const c = useContext(LotsCtx);
  if (!c) throw new Error("useLots: нет LotsProvider");
  return c;
}

export type ScopeView = {
  scope: string;
  /** Все лоты области (счёта или всего аукциона) без фильтров */
  all: LotRow[];
  /** После общего и локального фильтров */
  visible: LotRow[];
  /** Выбранные среди видимых */
  selectedVisible: LotRow[];
  /** По чему считается «Итого»: выбранные, если выбор есть, иначе все видимые */
  basis: LotRow[];
  mode: "all" | "filtered" | "selected";
  totals: Totals;
  breakdown: CostBreakdownResult;
  filters: Filters;
  filterCount: number;
  globalFilterCount: number;
  /** Расходы закупок-черновиков вошли в итог (выбраны/видны все лоты их закупок) */
  label: string;
};

export function useScope(scope: string): ScopeView {
  const { rows, purchases, fields, selected, filters, extraOf } = useLots();
  const { mode: vat } = useVatDisplay();
  const global = filters[ALL_SCOPE] ?? EMPTY;
  const local = scope === ALL_SCOPE ? EMPTY : (filters[scope] ?? EMPTY);

  return useMemo(() => {
    const all =
      scope === ALL_SCOPE ? rows.filter((r) => purchases.get(r.purchaseId)?.counted) : rows.filter((r) => r.purchaseId === scope);
    const visible = all.filter(
      (r) =>
        rowMatches(r, global, fields, vat, extraOf, selected) &&
        (scope === ALL_SCOPE || rowMatches(r, local, fields, vat, extraOf, selected)),
    );
    const selectedVisible = visible.filter((r) => selected.has(r.id));
    const hasSel = selectedVisible.length > 0;
    const basis = hasSel ? selectedVisible : visible;
    const filtered = activeFilterCount(global) + activeFilterCount(local) > 0;
    const m: ScopeView["mode"] = hasSel ? "selected" : filtered ? "filtered" : "all";
    const totals = computeTotals(basis, fields, extraOf);
    const pm = new Map<string, PartsPurchase>(
      Array.from(purchases.values()).map((p) => [
        p.id,
        { id: p.id, unallocated: p.unallocated, expIncl: p.expIncl, expExcl: p.expExcl, expenses: p.expenses, lineCount: p.lineCount },
      ]),
    );
    const breakdown = aggregateCostParts(
      basis.map((r) => ({ totalIncl: r.totalIncl, totalExcl: r.totalExcl, parts: r.parts, expIncl: r.expIncl, purchaseId: r.purchaseId })),
      pm,
    );
    const word = (n: number) => `${n} ${plural(n)}`;
    const label =
      m === "selected"
        ? `Выбрано ${selectedVisible.length} из ${visible.length} лотов${visible.length < all.length ? ` (всего ${all.length})` : ""}`
        : m === "filtered"
          ? `Отфильтровано ${word(visible.length)} из ${all.length}`
          : `Все ${word(all.length)}`;
    return {
      scope,
      all,
      visible,
      selectedVisible,
      basis,
      mode: m,
      totals,
      breakdown,
      filters: scope === ALL_SCOPE ? global : local,
      filterCount: activeFilterCount(scope === ALL_SCOPE ? global : local),
      globalFilterCount: activeFilterCount(global),
      label,
    };
  }, [scope, rows, purchases, fields, selected, extraOf, vat, global, local]);
}

const EMPTY = emptyFilters();

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "лот";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "лота";
  return "лотов";
}
