"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatQty } from "@/lib/utils";
import type { Commission4Mode } from "@/lib/commission4-mode";

type Row = {
  id: string;
  species?: string;
  color?: string;
  auction?: string;
  year?: number;
  purchasedQty?: number;
  purchasedValue?: number;
  usedQty?: number;
  usedValueBase?: number;
  usedValueWith4?: number;
  remainingQty?: number;
  remainingValue?: number | string;
  usdQty?: number;
  usdSubtotal?: number;
  name?: string;
  unit?: string;
  purchased?: string;
  remaining?: string;
  remainingValueExclVat?: string;
};

type ViewMode = "qty" | "money" | "all";

function FilterMenu({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group relative">
      <summary className="flex min-w-[150px] cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-400">
        <span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
          <span className="block max-w-[180px] truncate font-medium text-neutral-900">{summary}</span>
        </span>
        <span className="text-neutral-400 transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="absolute left-0 z-40 mt-1 min-w-[230px] max-w-[320px] rounded-xl border border-neutral-200 bg-white p-2 shadow-xl">
        {children}
      </div>
    </details>
  );
}

function filterSummary(selectedCount: number, totalCount: number, allLabel = "Все") {
  if (totalCount === 0) return "Нет вариантов";
  if (selectedCount === 0 || selectedCount === totalCount) return allLabel;
  if (selectedCount === 1) return "1 выбран";
  return String(selectedCount) + " выбрано";
}

export function FurSelectionTotal({ rows, c4Mode = "off" }: { rows: Row[]; c4Mode?: Commission4Mode }) {
  const normalized = useMemo(() => rows.map((r) => {
    const purchasedQty = r.purchasedQty ?? Number(r.purchased ?? 0);
    const remainingQty = r.remainingQty ?? Number(r.remaining ?? 0);
    const remainingValue = Number(r.remainingValue ?? 0);
    return {
      id: r.id,
      species: r.species ?? r.name ?? "Без названия",
      color: r.color ?? "Не указан",
      auction: r.auction ?? "Все партии",
      year: r.year ?? 0,
      purchasedQty,
      purchasedValue: r.purchasedValue ?? remainingValue,
      usedQty: r.usedQty ?? Math.max(0, purchasedQty - remainingQty),
      usedValueBase: r.usedValueBase ?? 0,
      usedValueWith4: r.usedValueWith4 ?? 0,
      remainingQty,
      remainingValue,
      usdQty: r.usdQty ?? 0,
      usdSubtotal: r.usdSubtotal ?? 0,
    };
  }), [rows]);

  const species = useMemo(
    () => Array.from(new Set(normalized.map((r) => r.species))).sort((a, b) => a.localeCompare(b, "ru")),
    [normalized],
  );

  const [selectedSpecies, setSelectedSpecies] = useState<string[]>(species);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [selectedAuctions, setSelectedAuctions] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("all");

  const selectedSet = useMemo(() => new Set(selectedSpecies), [selectedSpecies]);
  const speciesRows = normalized.filter((r) => selectedSet.has(r.species));

  const years = Array.from(new Set(speciesRows.map((r) => r.year).filter(Boolean))).sort((a, b) => b - a);
  const validSelectedYears = selectedYears.filter((y) => years.includes(y));
  const yearSet = new Set(validSelectedYears);
  const yearFiltered = yearSet.size ? speciesRows.filter((r) => yearSet.has(r.year)) : speciesRows;

  const colors = Array.from(new Set(yearFiltered.map((r) => r.color))).sort((a, b) => a.localeCompare(b, "ru"));
  const validSelectedColors = selectedColors.filter((c) => colors.includes(c));
  const colorSet = new Set(validSelectedColors);
  const colorFiltered = colorSet.size ? yearFiltered.filter((r) => colorSet.has(r.color)) : yearFiltered;

  const auctions = Array.from(new Set(colorFiltered.map((r) => r.auction))).sort((a, b) => a.localeCompare(b, "ru"));
  const validSelectedAuctions = selectedAuctions.filter((a) => auctions.includes(a));
  const auctionSet = new Set(validSelectedAuctions);
  const filtered = auctionSet.size ? colorFiltered.filter((r) => auctionSet.has(r.auction)) : colorFiltered;

  const groups = species
    .filter((name) => selectedSet.has(name))
    .map((name) => {
      const rr = filtered.filter((r) => r.species === name);
      return {
        name,
        purchasedQty: rr.reduce((s, r) => s + r.purchasedQty, 0),
        purchasedValue: rr.reduce((s, r) => s + r.purchasedValue, 0),
        usedQty: rr.reduce((s, r) => s + r.usedQty, 0),
        usedValueBase: rr.reduce((s, r) => s + r.usedValueBase, 0),
        usedValueWith4: rr.reduce((s, r) => s + r.usedValueWith4, 0),
        remainingQty: rr.reduce((s, r) => s + r.remainingQty, 0),
        remainingValue: rr.reduce((s, r) => s + r.remainingValue, 0),
        usdQty: rr.reduce((s, r) => s + r.usdQty, 0),
        usdSubtotal: rr.reduce((s, r) => s + r.usdSubtotal, 0),
      };
    })
    .filter((g) => g.purchasedQty || g.remainingQty || g.usedQty);

  const total = groups.reduce(
    (a, g) => ({
      purchasedQty: a.purchasedQty + g.purchasedQty,
      purchasedValue: a.purchasedValue + g.purchasedValue,
      usedQty: a.usedQty + g.usedQty,
      usedValueBase: a.usedValueBase + g.usedValueBase,
      usedValueWith4: a.usedValueWith4 + g.usedValueWith4,
      remainingQty: a.remainingQty + g.remainingQty,
      remainingValue: a.remainingValue + g.remainingValue,
      usdQty: a.usdQty + g.usdQty,
      usdSubtotal: a.usdSubtotal + g.usdSubtotal,
    }),
    { purchasedQty: 0, purchasedValue: 0, usedQty: 0, usedValueBase: 0, usedValueWith4: 0, remainingQty: 0, remainingValue: 0, usdQty: 0, usdSubtotal: 0 },
  );

  const currentUsed = c4Mode === "on" ? total.usedValueWith4 : total.usedValueBase;
  const altUsed = c4Mode === "on" ? total.usedValueBase : total.usedValueWith4;
  const avgFinal = total.purchasedQty ? total.purchasedValue / total.purchasedQty : 0;
  const avgUsd = total.usdQty ? total.usdSubtotal / total.usdQty : 0;

  const clearDependent = () => {
    setSelectedYears([]);
    setSelectedColors([]);
    setSelectedAuctions([]);
  };

  const toggleSpecies = (name: string) => {
    setSelectedSpecies((prev) => {
      const has = prev.includes(name);
      if (has && prev.length === 1) return prev;
      return has ? prev.filter((v) => v !== name) : [...prev, name];
    });
    clearDependent();
  };

  const toggleOptionalString = (
    current: string[],
    setCurrent: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
    options: string[],
  ) => {
    if (current.length === 0) {
      const next = options.filter((x) => x !== value);
      if (next.length > 0) setCurrent(next);
      return;
    }
    const has = current.includes(value);
    const next = has ? current.filter((x) => x !== value) : [...current, value];
    if (next.length === 0) return;
    setCurrent(next.length === options.length ? [] : next);
  };

  const toggleOptionalNumber = (value: number) => {
    if (selectedYears.length === 0) {
      const next = years.filter((x) => x !== value);
      if (next.length > 0) setSelectedYears(next);
    } else {
      const has = selectedYears.includes(value);
      const next = has ? selectedYears.filter((x) => x !== value) : [...selectedYears, value];
      if (next.length > 0) setSelectedYears(next.length === years.length ? [] : next);
    }
    setSelectedColors([]);
    setSelectedAuctions([]);
  };

  const effectiveYearSelected = (year: number) => selectedYears.length === 0 || validSelectedYears.includes(year);
  const effectiveColorSelected = (color: string) => selectedColors.length === 0 || validSelectedColors.includes(color);
  const effectiveAuctionSelected = (auction: string) => selectedAuctions.length === 0 || validSelectedAuctions.includes(auction);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-neutral-50/70 p-2.5">
        <FilterMenu label="Мех" summary={filterSummary(selectedSpecies.length, species.length, "Все виды")}>
          <div className="max-h-72 overflow-auto">
            {species.map((name) => (
              <label key={name} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-neutral-50">
                <input type="checkbox" checked={selectedSet.has(name)} onChange={() => toggleSpecies(name)} className="size-4 accent-neutral-900" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </label>
            ))}
          </div>
          <div className="mt-1 border-t pt-2">
            <button type="button" onClick={() => { setSelectedSpecies(species); clearDependent(); }} className="text-xs font-medium text-neutral-600 underline">Выбрать все</button>
          </div>
        </FilterMenu>

        <FilterMenu label="Год" summary={filterSummary(validSelectedYears.length, years.length, "Все годы")}>
          {years.map((year) => (
            <label key={year} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-neutral-50">
              <input type="checkbox" checked={effectiveYearSelected(year)} onChange={() => toggleOptionalNumber(year)} className="size-4 accent-neutral-900" />
              <span>{year}</span>
            </label>
          ))}
          <div className="mt-1 border-t pt-2"><button type="button" onClick={() => { setSelectedYears([]); setSelectedColors([]); setSelectedAuctions([]); }} className="text-xs font-medium text-neutral-600 underline">Все годы</button></div>
        </FilterMenu>

        <FilterMenu label="Цвет" summary={filterSummary(validSelectedColors.length, colors.length, "Все цвета")}>
          <div className="max-h-72 overflow-auto">
            {colors.map((color) => (
              <label key={color} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-neutral-50">
                <input type="checkbox" checked={effectiveColorSelected(color)} onChange={() => { toggleOptionalString(selectedColors, setSelectedColors, color, colors); setSelectedAuctions([]); }} className="size-4 accent-neutral-900" />
                <span className="min-w-0 flex-1 truncate">{color}</span>
              </label>
            ))}
          </div>
          <div className="mt-1 border-t pt-2"><button type="button" onClick={() => { setSelectedColors([]); setSelectedAuctions([]); }} className="text-xs font-medium text-neutral-600 underline">Все цвета</button></div>
        </FilterMenu>

        <FilterMenu label="Партия закупки" summary={filterSummary(validSelectedAuctions.length, auctions.length, "Все партии")}>
          <div className="max-h-72 overflow-auto">
            {auctions.map((auction) => (
              <label key={auction} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-neutral-50">
                <input type="checkbox" checked={effectiveAuctionSelected(auction)} onChange={() => toggleOptionalString(selectedAuctions, setSelectedAuctions, auction, auctions)} className="size-4 accent-neutral-900" />
                <span className="min-w-0 flex-1 truncate">{auction}</span>
              </label>
            ))}
          </div>
          <div className="mt-1 border-t pt-2"><button type="button" onClick={() => setSelectedAuctions([])} className="text-xs font-medium text-neutral-600 underline">Все партии</button></div>
        </FilterMenu>

        <div className="ml-auto inline-flex rounded-lg border border-neutral-300 bg-white p-0.5 text-xs">
          {([["qty","Шт."],["money","₽"],["all","Все"]] as const).map(([key,label]) => (
            <button key={key} type="button" onClick={() => setView(key)} className={"rounded-md px-3 py-2 " + (view === key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50")}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs text-neutral-500">
        <span>Ср цена закупки: <b className="text-neutral-900">{"$"}{avgUsd.toLocaleString("ru-RU",{maximumFractionDigits:2})}</b></span>
        <span>Ср финальная цена: <b className="text-neutral-900">{formatMoney(avgFinal)}/ед.</b></span>
        <span>Выбрано: <b className="text-neutral-900">{selectedSpecies.length}</b> из {species.length} видов</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-300 bg-neutral-50">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Тотал</th>
              {view !== "money" && <><th className="px-3 py-2 text-right">Куплено, шт.</th><th className="px-3 py-2 text-right">Использовано, шт.</th><th className="px-3 py-2 text-right">Остаток, шт.</th></>}
              {view !== "qty" && <><th className="px-3 py-2 text-right">Куплено, ₽</th><th className="px-3 py-2 text-right">Использовано, ₽</th><th className="px-3 py-2 text-right">Остаток, ₽</th></>}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-neutral-200 text-base font-semibold">
              <td className="px-3 py-3">Итого выбранное</td>
              {view !== "money" && <><td className="px-3 py-3 text-right tabular-nums">{formatQty(total.purchasedQty)}</td><td className="px-3 py-3 text-right tabular-nums">{formatQty(total.usedQty)}</td><td className="px-3 py-3 text-right tabular-nums">{formatQty(total.remainingQty)}</td></>}
              {view !== "qty" && <>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(total.purchasedValue)}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  <div>{formatMoney(currentUsed)}</div>
                  <div className="text-[11px] font-normal text-neutral-400">{c4Mode === "on" ? "без 4%" : "с 4%"}: {formatMoney(altUsed)}</div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(total.remainingValue)}</td>
              </>}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500"><tr>
            <th className="px-3 py-2">Мех</th>
            {view !== "money" && <><th className="px-3 py-2 text-right">Куплено, шт.</th><th className="px-3 py-2 text-right">Использовано, шт.</th><th className="px-3 py-2 text-right">Остаток, шт.</th></>}
            {view !== "qty" && <><th className="px-3 py-2 text-right">Куплено, ₽</th><th className="px-3 py-2 text-right">Использовано, ₽</th><th className="px-3 py-2 text-right">Остаток, ₽</th></>}
          </tr></thead>
          <tbody>
            {groups.map((g) => {
              const used = c4Mode === "on" ? g.usedValueWith4 : g.usedValueBase;
              const alt = c4Mode === "on" ? g.usedValueBase : g.usedValueWith4;
              return (
                <tr key={g.name} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-medium">{g.name}</td>
                  {view !== "money" && <><td className="px-3 py-2 text-right tabular-nums">{formatQty(g.purchasedQty)}</td><td className="px-3 py-2 text-right tabular-nums">{formatQty(g.usedQty)}</td><td className="px-3 py-2 text-right tabular-nums">{formatQty(g.remainingQty)}</td></>}
                  {view !== "qty" && <>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(g.purchasedValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums"><div>{formatMoney(used)}</div><div className="text-[11px] text-neutral-400">{c4Mode === "on" ? "без 4%" : "с 4%"}: {formatMoney(alt)}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(g.remainingValue)}</td>
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
