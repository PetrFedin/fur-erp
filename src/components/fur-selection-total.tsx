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
  // Совместимость со страницей /lots, где компонент раньше получал агрегат материала.
  name?: string;
  unit?: string;
  purchased?: string;
  remaining?: string;
  remainingValueExclVat?: string;
};

type ViewMode = "qty" | "money" | "all";

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
  const species = useMemo(() => Array.from(new Set(normalized.map((r) => r.species))).sort((a, b) => a.localeCompare(b, "ru")), [normalized]);
  const [selectedSpecies, setSelectedSpecies] = useState<string[]>(species);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [selectedAuctions, setSelectedAuctions] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("all");

  const selectedSet = useMemo(() => new Set(selectedSpecies), [selectedSpecies]);
  const speciesRows = normalized.filter((r) => selectedSet.has(r.species));
  const years = Array.from(new Set(speciesRows.map((r) => r.year).filter(Boolean))).sort((a, b) => b - a);
  const yearSet = new Set(selectedYears.filter((y) => years.includes(y)));
  const yearFiltered = yearSet.size ? speciesRows.filter((r) => yearSet.has(r.year)) : speciesRows;
  const colors = Array.from(new Set(yearFiltered.map((r) => r.color))).sort((a, b) => a.localeCompare(b, "ru"));
  const colorSet = new Set(selectedColors.filter((c) => colors.includes(c)));
  const colorFiltered = colorSet.size ? yearFiltered.filter((r) => colorSet.has(r.color)) : yearFiltered;
  const auctions = Array.from(new Set(colorFiltered.map((r) => r.auction))).sort((a, b) => a.localeCompare(b, "ru"));
  const auctionSet = new Set(selectedAuctions.filter((a) => auctions.includes(a)));
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

  const toggleSpecies = (name: string, checked: boolean) => {
    setSelectedSpecies((prev) => checked ? [...prev, name] : prev.filter((v) => v !== name));
    setSelectedColors([]);
    setSelectedYears([]);
    setSelectedAuctions([]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[230px] flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Мех</div>
              <button type="button" onClick={() => { setSelectedSpecies(selectedSpecies.length === species.length ? [] : species); setSelectedColors([]); setSelectedYears([]); setSelectedAuctions([]); }} className="text-xs font-medium text-neutral-600 underline">
                {selectedSpecies.length === species.length ? "Снять все" : "Выбрать все"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {species.map((name) => {
                const active = selectedSet.has(name);
                return (
                  <label key={name} className={"flex cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs transition " + (active ? "border-neutral-900 bg-white text-neutral-900" : "border-neutral-300 bg-neutral-100 text-neutral-500")}>
                    <input type="checkbox" checked={active} onChange={(e) => toggleSpecies(name, e.target.checked)} className="size-3.5 accent-neutral-900" />
                    <span className="font-medium">{name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {years.length > 1 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Год</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {years.map((year) => {
                  const active = yearSet.has(year);
                  return <button key={year} type="button" onClick={() => { setSelectedYears((prev) => active ? prev.filter((x) => x !== year) : [...prev, year]); setSelectedColors([]); setSelectedAuctions([]); }} className={"rounded-full border px-2.5 py-1.5 text-xs " + (active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700")}>{year}</button>;
                })}
              </div>
            </div>
          ) : null}

          {colors.length > 1 ? (
            <div className="min-w-[180px]">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Цвет</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {colors.map((color) => {
                  const active = colorSet.has(color);
                  return <button key={color} type="button" onClick={() => { setSelectedColors((prev) => active ? prev.filter((x) => x !== color) : [...prev, color]); setSelectedAuctions([]); }} className={"rounded-full border px-2.5 py-1.5 text-xs " + (active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700")}>{color}</button>;
                })}
              </div>
            </div>
          ) : null}
        </div>

        {auctions.length > 0 ? (
          <div className="mt-3 border-t border-neutral-200 pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Партия закупки</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {auctions.map((a) => {
                const active = auctionSet.has(a);
                return <button key={a} type="button" onClick={() => setSelectedAuctions((prev) => active ? prev.filter((x) => x !== a) : [...prev, a])} className={"rounded-full border px-2.5 py-1 text-xs " + (active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700")}>{a}</button>;
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-neutral-500">Выбрано видов меха: <b className="text-neutral-900">{selectedSpecies.length}</b> из {species.length}</div>
        <div className="inline-flex rounded-md border border-neutral-300 bg-white p-0.5 text-xs">
          {([["qty","Шт."],["money","₽"],["all","Все"]] as const).map(([key,label]) => (
            <button key={key} type="button" onClick={() => setView(key)} className={"rounded px-2.5 py-1 " + (view === key ? "bg-neutral-900 text-white" : "text-neutral-600")}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 p-3"><div className="text-xs text-neutral-500">Количество сырья</div><div className="mt-1 text-xl font-semibold">{formatQty(total.purchasedQty)} ед.</div></div>
        <div className="rounded-lg border border-neutral-200 p-3"><div className="text-xs text-neutral-500">Ср цена закупки, $</div><div className="mt-1 text-xl font-semibold">{"$"}{avgUsd.toLocaleString("ru-RU",{maximumFractionDigits:2})}</div></div>
        <div className="rounded-lg border border-neutral-200 p-3"><div className="text-xs text-neutral-500">Ср финальная цена, ₽/ед.</div><div className="mt-1 text-xl font-semibold">{formatMoney(avgFinal)}</div></div>
        <div className="rounded-lg border border-neutral-200 p-3"><div className="text-xs text-neutral-500">Себестоимость всего сырья</div><div className="mt-1 text-xl font-semibold">{formatMoney(total.purchasedValue)}</div></div>
        <div className="rounded-lg border border-neutral-200 p-3"><div className="text-xs text-neutral-500">Неиспользованный остаток</div><div className="mt-1 text-xl font-semibold">{formatQty(total.remainingQty)} ед.</div></div>
        <div className="rounded-lg border border-neutral-200 p-3"><div className="text-xs text-neutral-500">Остаток в деньгах</div><div className="mt-1 text-xl font-semibold">{formatMoney(total.remainingValue)}</div></div>
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
            <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
              <td className="px-3 py-2">Итого выбранное</td>
              {view !== "money" && <><td className="px-3 py-2 text-right">{formatQty(total.purchasedQty)}</td><td className="px-3 py-2 text-right">{formatQty(total.usedQty)}</td><td className="px-3 py-2 text-right">{formatQty(total.remainingQty)}</td></>}
              {view !== "qty" && <>
                <td className="px-3 py-2 text-right">{formatMoney(total.purchasedValue)}</td>
                <td className="px-3 py-2 text-right"><div>{formatMoney(currentUsed)}</div><div className="text-[11px] font-normal text-neutral-400">{c4Mode === "on" ? "без 4%" : "с 4%"}: {formatMoney(altUsed)}</div></td>
                <td className="px-3 py-2 text-right">{formatMoney(total.remainingValue)}</td>
              </>}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
