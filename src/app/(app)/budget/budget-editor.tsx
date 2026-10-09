"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "../dashboard/tile";
import {
  autoCalc, calcLine, furRank, reapplyParams, sumLines,
  type BudgetLine, type BudgetParams, type BudgetStat,
} from "@/lib/budget-calc";
import { refreshBudgetStats, resetBudget, saveBudget } from "./actions";

const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : formatMoney(Math.round(v)));
const qty = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: d }));
const pctDiff = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : (a / b - 1) * 100);
const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`);

/** Числовое поле: можно печатать запятую и точку, пустое = 0; значение извне (автоматический расчёт) подставляется сразу. */
function NumInput({ value, onChange, disabled, className = "", ariaLabel, width = "w-full" }: { value: number; onChange: (v: number) => void; disabled?: boolean; className?: string; ariaLabel: string; width?: string }) {
  const [text, setText] = useState(() => fmt(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) { last.current = value; setText(fmt(value)); }
  }, [value]);
  return (
    <input
      type="text" inputMode="decimal" aria-label={ariaLabel} disabled={disabled} value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t.replace(/\s/g, "").replace(",", "."));
        const v = t.trim() === "" ? 0 : Number.isFinite(n) ? n : last.current;
        last.current = v;
        onChange(v);
      }}
      onFocus={(e) => e.target.select()}
      className={`${width} rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus-visible:border-neutral-900 focus-visible:outline-none disabled:border-transparent disabled:bg-transparent ${className}`}
    />
  );
}
const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace(".", ",") : "0");

function Lock({ locked, onToggle, disabled }: { locked: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onToggle} disabled={disabled} aria-pressed={locked}
      title={locked ? "Замок закрыт: строка ручная, автоматический расчёт её не трогает. Нажмите, чтобы вернуть автоматический расчёт" : "Замок открыт: строка считается автоматически. Любое ручное изменение закроет замок"}
      className={"inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm " + (locked ? "border-amber-300 bg-amber-50 text-amber-800" : "border-neutral-200 bg-white text-neutral-400 hover:text-neutral-700")}>
      <span aria-hidden>{locked ? "🔒" : "🔓"}</span><span className="sr-only">{locked ? "Строка заблокирована" : "Строка автоматическая"}</span>
    </button>
  );
}

export function BudgetEditor({ season, initialParams, initialLines, initialStats, canEdit, savedAt, savedBy }: { season: string; initialParams: BudgetParams; initialLines: BudgetLine[]; initialStats: BudgetStat[]; canEdit: boolean; savedAt: string | null; savedBy: string | null }) {
  const [params, setParams] = useState(initialParams);
  const [lines, setLines] = useState(initialLines);
  const [stats, setStats] = useState(initialStats);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(savedAt ? "saved" : "idle");
  const [busy, startBusy] = useTransition();
  const first = useRef(true);

  // Автосохранение: через секунду после последнего изменения.
  useEffect(() => {
    if (!canEdit) return;
    if (first.current) { first.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(() => {
      saveBudget(season, params, lines).then((r) => setSaveState(r.ok ? "saved" : "error")).catch(() => setSaveState("error"));
    }, 900);
    return () => clearTimeout(t);
  }, [lines, params, season, canEdit]);

  const setParam = (k: keyof BudgetParams, v: number) => {
    const p = { ...params, [k]: v };
    setParams(p);
    setLines((ls) => reapplyParams(ls, p));
  };
  const patch = useCallback((id: string, p: Partial<BudgetLine>, lock = false) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p, ...(lock ? { locked: true } : {}) } : l))), []);
  const toggleLock = (id: string) => setLines((ls) => ls.map((l) => (l.id !== id ? l : l.locked ? autoCalc([{ ...l, locked: false }], stats, params)[0] : { ...l, locked: true })));
  const setStat = (id: string, key: string) => {
    const [statFur, statCat] = key.split("|");
    setLines((ls) => ls.map((l) => (l.id !== id ? l : l.locked ? { ...l, statFur, statCat } : autoCalc([{ ...l, statFur, statCat }], stats, params)[0])));
  };
  const addLine = (fur: string) => setLines((ls) => [...ls, { id: "n" + Math.random().toString(36).slice(2, 8), fur, cat: "Новая строка", pcs: 0, statFur: "", statCat: "", locked: true, hides: 0, hidePrice: 0, meters: 0, meterPrice: 0, work: 0, base: null, sample: 0 }]);
  const addFur = () => {
    const name = window.prompt("Тип меха для нового блока (например, Соболь):");
    if (name && name.trim()) addLine(name.trim());
  };
  const removeLine = (id: string) => { if (window.confirm("Удалить строку?")) setLines((ls) => ls.filter((l) => l.id !== id)); };

  const runAuto = () => startBusy(async () => {
    try {
      const fresh = await refreshBudgetStats();
      setStats(fresh);
      const before = lines;
      const next = autoCalc(before, fresh, params);
      setLines(next);
      const locked = before.filter((l) => l.locked).length;
      const nodata = next.filter((l) => !l.locked && l.sample <= 0).length;
      setMsg(`Пересчитано по данным системы: ${before.length - locked} строк.${locked ? ` С замком (ручные, не тронуты): ${locked}.` : ""}${nodata ? ` Нет данных в системе: ${nodata}.` : ""}`);
    } catch { setMsg("Не удалось получить данные системы. Попробуйте ещё раз."); }
  });
  const runReset = () => {
    if (!window.confirm("Вернуть бюджет к исходному (строки из PDF, автоматический расчёт, рысь вручную)? Ваши правки будут потеряны.")) return;
    startBusy(async () => { await resetBudget(season); window.location.reload(); });
  };

  const groups = useMemo(() => {
    const m = new Map<string, BudgetLine[]>();
    for (const l of lines) m.set(l.fur, [...(m.get(l.fur) ?? []), l]);
    return Array.from(m.entries()).sort((a, b) => furRank(a[0]) - furRank(b[0]));
  }, [lines]);
  const total = useMemo(() => sumLines(lines, params), [lines, params]);
  const totalPer = total.pcs > 0 ? total.total / total.pcs : null;
  const nowPer = total.nowPcs > 0 ? total.nowTotal / total.nowPcs : null;
  const compPer = total.nowPcs > 0 ? lines.reduce((s, l) => s + (calcLine(l, params).nowPerUnit != null ? calcLine(l, params).total : 0), 0) / total.nowPcs : null;
  const statOptions = stats.map((s) => ({ value: s.key, label: `${s.fur} · ${s.cat} (${s.qty} изд.)` }));
  const toggle = (f: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  const tiles = [
    { head: "Итого бюджет", value: money(total.total), cap: `${qty(total.pcs, 0)} изд. · на 1 изд. ${money(totalPer)}`, items: [["Сейчас на 1 изд.", money(nowPer)], ["Var к текущим ценам", pct(pctDiff(compPer, nowPer))]] },
    { head: "Мех", value: money(total.mex), cap: `${qty(total.hides, 0)} шкур`, items: [["Средняя цена шкуры", money(total.hides ? total.mex / total.hides : null)], ["Доля", pct0(total.mex, total.total)]] },
    { head: "Подкладка", value: money(total.lining), cap: `${qty(total.meters, 1)} м`, items: [["Средняя цена за м", money(total.meters ? total.lining / total.meters : null)], ["Доля", pct0(total.lining, total.total)]] },
    { head: "Работа", value: money(total.work), cap: `${qty(total.pcs, 0)} изд.`, items: [["На 1 изделие", money(total.pcs ? total.work / total.pcs : null)], ["Доля", pct0(total.work, total.total)]] },
    { head: `Надбавка ${qty(params.c4, 1)}%`, value: money(total.c4), cap: "на мех и подкладку", items: [["Доля", pct0(total.c4, total.total)]] },
  ];

  const field = (l: BudgetLine, k: keyof Pick<BudgetLine, "hides" | "hidePrice" | "meters" | "meterPrice" | "work">, label: string, w = "w-full") => (
    <NumInput value={l[k]} ariaLabel={`${label}: ${l.fur}, ${l.cat}`} disabled={!canEdit} width={w} onChange={(v) => patch(l.id, { [k]: v }, true)} />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Бюджет · {season}</h1>
          <p className="text-xs text-neutral-500">Прикидка расхода шкур, подкладки и работы по бюджету изделий (Budget PCS). Цены с НДС. Рысь — вручную, остальное — по данным системы.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-neutral-500" role="status">
            {saveState === "saving" ? "Сохраняю…" : saveState === "saved" ? `Сохранено${savedBy && saveState === "saved" ? "" : ""}` : saveState === "error" ? "Не удалось сохранить" : canEdit ? "Не сохранено" : "Только просмотр"}
          </span>
          {canEdit ? (
            <>
              <button type="button" onClick={runAuto} disabled={busy} className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700 disabled:opacity-60">{busy ? "Считаю…" : "Автоматический расчёт"}</button>
              <button type="button" onClick={addFur} className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">+ Тип меха</button>
              <button type="button" onClick={runReset} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50">Сбросить</button>
            </>
          ) : null}
        </div>
      </div>
      {msg ? <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700" role="status">{msg}</p> : null}

      <section aria-label="Параметры" className="rounded-lg border border-neutral-200 bg-white p-3">
        <div className="mb-2 flex items-center gap-1 text-sm font-medium">Надбавки, % <InfoHint label="Что такое надбавки" wide><p>Надбавка к средневзвешенной цене из статистики системы: цена шкуры, цена подкладки и стоимость работы увеличиваются на заданный процент (по умолчанию 10%). Можно ставить любой процент, например 5 или 0.</p><p className="mt-1">Надбавка 4% — как в системе, на мех и подкладку.</p></InfoHint></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["upFur", "К цене шкуры"], ["upLining", "К цене подкладки"], ["upWork", "К работе"], ["c4", "4% на мех и подкладку"]] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-neutral-500">
              {label}
              <span className="flex items-center gap-1"><NumInput value={params[k]} ariaLabel={label} disabled={!canEdit} onChange={(v) => setParam(k, v)} /><span className="text-neutral-500">%</span></span>
            </label>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-5 print:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.head} className={TILE_BOX + " shadow-sm"}>
            <TileHead>{t.head}</TileHead>
            <TileValue>{t.value}</TileValue>
            <TileCaption>{t.cap}</TileCaption>
            <dl className="mt-1 space-y-1 text-sm">
              {t.items.map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-3"><dt className="text-neutral-600">{k}</dt><dd className="whitespace-nowrap font-medium tabular-nums">{v}</dd></div>)}
            </dl>
          </div>
        ))}
      </div>

      {groups.map(([fur, ls]) => {
        const t = sumLines(ls, params);
        const per = t.pcs > 0 ? t.total / t.pcs : null;
        const open = !collapsed.has(fur);
        return (
          <section key={fur} aria-label={fur} className="rounded-lg border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <button type="button" onClick={() => toggle(fur)} aria-expanded={open} className="flex items-center gap-1 text-sm font-semibold">
                <span aria-hidden className={"inline-block w-4 text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}>›</span>{fur}
              </button>
              <span className="text-xs text-neutral-500">{qty(t.pcs, 0)} изд. · {qty(t.hides, 0)} шкур · {qty(t.meters, 1)} м</span>
              <span className="ml-auto text-sm font-semibold tabular-nums">{money(t.total)}</span>
              <span className="text-xs text-neutral-500 tabular-nums">на 1 изд. {money(per)}</span>
            </div>
            {open ? (
              <>
                {/* Планшет и компьютер: таблица */}
                <div className="hidden overflow-x-auto border-t border-neutral-100 lg:block">
                  <table className="w-full min-w-[1180px] text-left text-xs">
                    <thead>
                      <tr className="text-neutral-500">
                        <th className="w-9 py-1.5 pl-3 font-medium"><span className="sr-only">Замок</span></th>
                        <th className="py-1.5 pr-2 font-medium">Категория</th>
                        <th className="px-1 py-1.5 text-right font-medium">Бюджет, шт.</th>
                        <th className="px-1 py-1.5 font-medium">Данные системы</th>
                        <th className="px-1 py-1.5 text-right font-medium">Шкур на изд.</th>
                        <th className="px-1 py-1.5 text-right font-medium">Всего шкур</th>
                        <th className="px-1 py-1.5 text-right font-medium">Цена шкуры, ₽</th>
                        <th className="px-1 py-1.5 text-right font-medium">Мех, ₽</th>
                        <th className="px-1 py-1.5 text-right font-medium">Подкл. м/изд.</th>
                        <th className="px-1 py-1.5 text-right font-medium">Цена, ₽/м</th>
                        <th className="px-1 py-1.5 text-right font-medium">Подкладка, ₽</th>
                        <th className="px-1 py-1.5 text-right font-medium">Работа/изд., ₽</th>
                        <th className="px-1 py-1.5 text-right font-medium">Работа, ₽</th>
                        <th className="px-1 py-1.5 text-right font-medium">4%, ₽</th>
                        <th className="px-1 py-1.5 text-right font-medium">Итого, ₽</th>
                        <th className="px-1 py-1.5 text-right font-medium">На 1 изд.</th>
                        <th className="px-1 py-1.5 text-right font-medium">Сейчас</th>
                        <th className="px-1 py-1.5 text-right font-medium">Var</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody>
                      {ls.map((l) => {
                        const c = calcLine(l, params);
                        const v = pctDiff(c.perUnit, c.nowPerUnit);
                        return (
                          <tr key={l.id} className="border-t border-neutral-100 align-middle">
                            <td className="py-1 pl-3"><Lock locked={l.locked} disabled={!canEdit} onToggle={() => toggleLock(l.id)} /></td>
                            <td className="min-w-[130px] py-1 pr-2">
                              <input value={l.cat} disabled={!canEdit} aria-label="Название строки" onChange={(e) => patch(l.id, { cat: e.target.value })} className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm hover:border-neutral-300 focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:outline-none" />
                            </td>
                            <td className="w-20 px-1"><NumInput value={l.pcs} ariaLabel={`Бюджет, шт.: ${l.fur}, ${l.cat}`} disabled={!canEdit} onChange={(n) => patch(l.id, { pcs: n })} /></td>
                            <td className="min-w-[170px] px-1">
                              <select value={`${l.statFur}|${l.statCat}`} disabled={!canEdit} aria-label="Статистика системы" onChange={(e) => setStat(l.id, e.target.value)} className="w-full rounded-md border border-neutral-200 bg-white px-1 py-1 text-xs">
                                <option value="|">— вручную —</option>
                                {l.statFur && !statOptions.some((o) => o.value === `${l.statFur}|${l.statCat}`) ? <option value={`${l.statFur}|${l.statCat}`}>{l.statFur} · {l.statCat}</option> : null}
                                {statOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                              <span className={"mt-0.5 block text-[11px] " + (c.sampleLabel === "нет данных" ? "text-red-700" : c.sampleLabel === "малая выборка" ? "text-amber-700" : "text-neutral-500")}>{c.sampleLabel}{l.sample > 0 ? ` · ${l.sample} изд.` : ""}</span>
                            </td>
                            <td className="w-20 px-1">{field(l, "hides", "Шкур на изделие")}</td>
                            <td className="px-1 text-right tabular-nums">{qty(c.totalHides, 0)}</td>
                            <td className="w-28 px-1">{field(l, "hidePrice", "Цена шкуры")}</td>
                            <td className="whitespace-nowrap px-1 text-right tabular-nums">{money(c.mex)}</td>
                            <td className="w-20 px-1">{field(l, "meters", "Подкладка м на изделие")}</td>
                            <td className="w-24 px-1">{field(l, "meterPrice", "Цена подкладки за м")}</td>
                            <td className="whitespace-nowrap px-1 text-right tabular-nums">{money(c.lining)}</td>
                            <td className="w-28 px-1">{field(l, "work", "Работа на изделие")}</td>
                            <td className="whitespace-nowrap px-1 text-right tabular-nums">{money(c.workSum)}</td>
                            <td className="whitespace-nowrap px-1 text-right tabular-nums text-neutral-600">{money(c.c4)}</td>
                            <td className="whitespace-nowrap px-1 text-right text-sm font-medium tabular-nums">{money(c.total)}</td>
                            <td className="whitespace-nowrap px-1 text-right tabular-nums">{money(c.perUnit)}</td>
                            <td className="whitespace-nowrap px-1 text-right tabular-nums text-neutral-600">{money(c.nowPerUnit)}</td>
                            <td className="whitespace-nowrap px-1 text-right tabular-nums text-neutral-600">{pct(v)}</td>
                            <td className="pr-2 text-right">{canEdit ? <button type="button" onClick={() => removeLine(l.id)} aria-label="Удалить строку" className="text-neutral-400 hover:text-red-700">×</button> : null}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Телефон: карточки */}
                <div className="flex flex-col gap-2 border-t border-neutral-100 p-2 lg:hidden">
                  {ls.map((l) => {
                    const c = calcLine(l, params);
                    const v = pctDiff(c.perUnit, c.nowPerUnit);
                    const lab = "flex flex-col gap-0.5 text-[11px] text-neutral-500";
                    return (
                      <div key={l.id} className="rounded-lg border border-neutral-200 p-2">
                        <div className="mb-2 flex items-center gap-2">
                          <Lock locked={l.locked} disabled={!canEdit} onToggle={() => toggleLock(l.id)} />
                          <input value={l.cat} disabled={!canEdit} aria-label="Название строки" onChange={(e) => patch(l.id, { cat: e.target.value })} className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-sm font-medium focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:outline-none" />
                          {canEdit ? <button type="button" onClick={() => removeLine(l.id)} aria-label="Удалить строку" className="px-1 text-lg text-neutral-400">×</button> : null}
                        </div>
                        <label className={lab + " mb-2"}>Данные системы
                          <select value={`${l.statFur}|${l.statCat}`} disabled={!canEdit} onChange={(e) => setStat(l.id, e.target.value)} className="w-full rounded-md border border-neutral-200 bg-white px-1 py-1.5 text-xs text-neutral-900">
                            <option value="|">— вручную —</option>
                            {l.statFur && !statOptions.some((o) => o.value === `${l.statFur}|${l.statCat}`) ? <option value={`${l.statFur}|${l.statCat}`}>{l.statFur} · {l.statCat}</option> : null}
                            {statOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <span className={c.sampleLabel === "нет данных" ? "text-red-700" : c.sampleLabel === "малая выборка" ? "text-amber-700" : ""}>{c.sampleLabel}{l.sample > 0 ? ` · ${l.sample} изд.` : ""}</span>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className={lab}>Бюджет, шт.<NumInput value={l.pcs} ariaLabel="Бюджет, шт." disabled={!canEdit} onChange={(n) => patch(l.id, { pcs: n })} /></label>
                          <label className={lab}>Шкур на изделие{field(l, "hides", "Шкур на изделие")}</label>
                          <label className={lab}>Цена шкуры, ₽{field(l, "hidePrice", "Цена шкуры")}</label>
                          <label className={lab}>Подкладки, м на изделие{field(l, "meters", "Подкладка м на изделие")}</label>
                          <label className={lab}>Цена подкладки, ₽/м{field(l, "meterPrice", "Цена подкладки за м")}</label>
                          <label className={lab}>Работа на изделие, ₽{field(l, "work", "Работа на изделие")}</label>
                        </div>
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                          {[["Всего шкур", qty(c.totalHides, 0)], ["Мех", money(c.mex)], ["Подкладка", money(c.lining)], ["Работа", money(c.workSum)], ["Надбавка 4%", money(c.c4)], ["Итого", money(c.total)], ["На 1 изделие", money(c.perUnit)], ["Сейчас на 1 изд.", money(c.nowPerUnit)], ["Var", pct(v)]].map(([k, val]) => (
                            <div key={k} className="flex justify-between gap-2"><dt className="text-neutral-500">{k}</dt><dd className={"tabular-nums " + (k === "Итого" ? "font-semibold" : "font-medium")}>{val}</dd></div>
                          ))}
                        </dl>
                      </div>
                    );
                  })}
                </div>
                {canEdit ? <div className="border-t border-neutral-100 px-3 py-1.5"><button type="button" onClick={() => addLine(fur)} className="text-xs text-blue-700 hover:underline">+ строка</button></div> : null}
              </>
            ) : null}
          </section>
        );
      })}
      <p className="text-xs text-neutral-500">Как считается: изделий × (шкур × цена шкуры + подкладка м × цена за м + работа) + {qty(params.c4, 1)}% на мех и подкладку. «Сейчас» — те же количества по текущим ценам системы без надбавок; Var — разница «бюджет к сейчас». Замок закрыт — строка ручная; любое ручное изменение значения закрывает замок. {savedAt || saveState === "saved" ? "Изменения сохраняются автоматически." : ""}</p>
    </div>
  );
}

function pct0(part: number, whole: number) {
  return whole > 0 ? `${((part / whole) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : "—";
}
