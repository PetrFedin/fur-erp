"use client";

import { Fragment, useMemo, useState } from "react";
import type { ForecastLine, RawForecast } from "@/lib/raw-forecast";
import type { ForecastEdits } from "@/lib/forecast-store";
import { saveForecastEdits } from "./actions";
import { formatDec1, formatInt, formatMoney } from "@/lib/utils";

const C4 = 4;
const TH = "whitespace-nowrap px-3 py-2 text-right align-bottom text-xs font-medium text-neutral-500";
const GH = "whitespace-nowrap border-b border-neutral-200 px-3 pb-1.5 pt-2.5 text-center text-xs font-semibold text-neutral-800";
const TD = "px-3 py-2 text-right text-sm tabular-nums";
const SEP = " border-l border-neutral-200";
const key = (fur: string) => fur.split(" + ").sort().join(" + ");
const m = (v: number) => formatMoney(Math.round(v / 1000) * 1000);
const num = (s: string | undefined) => { const v = parseFloat((s ?? "").replace(",", ".").replace(/\s/g, "")); return Number.isFinite(v) && v > 0 ? v : 0; };

type Field = "hp" | "hidePrice" | "mp" | "meterPrice" | "wp" | "extra";
type Vals = Record<Field, string>;
const init = (l: ForecastLine): Vals => {
  const s = (v: number | null, d = 0) => (v === null ? "" : String(Math.round(v * 10 ** d) / 10 ** d));
  return { hp: s(l.hp, 1), hidePrice: s(l.hidePrice), mp: s(l.mp, 1), meterPrice: s(l.meterPrice), wp: s(l.wp), extra: "" };
};
type Calc = { left: number; hides: number; fur: number; meters: number; lining: number; c4: number; work: number; extra: number; total: number };
const ZERO: Calc = { left: 0, hides: 0, fur: 0, meters: 0, lining: 0, c4: 0, work: 0, extra: 0, total: 0 };
const add = (a: Calc, b: Calc): Calc => ({ left: a.left + b.left, hides: a.hides + b.hides, fur: a.fur + b.fur, meters: a.meters + b.meters, lining: a.lining + b.lining, c4: a.c4 + b.c4, work: a.work + b.work, extra: a.extra + b.extra, total: a.total + b.total });
function calc(l: ForecastLine, v: Vals): Calc | null {
  const hp = num(v.hp), mp = num(v.mp), wp = num(v.wp);
  if (!hp && !mp && !wp) return null; // ни шкур, ни подкладки, ни работы — без расчёта
  const fur = hp * l.left * num(v.hidePrice), lining = mp * l.left * num(v.meterPrice), work = wp * l.left, extra = num(v.extra) * l.left, c4 = ((fur + lining) * C4) / 100;
  return { left: l.left, hides: hp * l.left, fur, meters: mp * l.left, lining, c4, work, extra, total: fur + lining + c4 + work + extra };
}

export function ForecastView({ id, name, season, canEdit, initialEdits, initialOff, lines, stock, asOf }: { id: string; name: string; season: string; canEdit: boolean; initialEdits: ForecastEdits; initialOff: string[]; lines: ForecastLine[]; stock: RawForecast["stock"]; asOf: string | null }) {
  const [detail, setDetail] = useState(false);
  const [fur, setFur] = useState("all");
  const [vals, setVals] = useState<Record<string, Vals>>(() => Object.fromEntries(lines.map((l) => [l.acode, { ...init(l), ...initialEdits[l.acode] }])));
  const [off, setOff] = useState<Set<string>>(new Set(initialOff));
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const set = (a: string, f: Field, v: string) => { setDirty(true); setVals((p) => ({ ...p, [a]: { ...p[a], [f]: v } })); };
  const save = async () => {
    const edits: ForecastEdits = {};
    for (const l of lines) { const base = init(l); for (const f of Object.keys(base) as Field[]) if (vals[l.acode][f] !== base[f]) (edits[l.acode] ??= {})[f] = vals[l.acode][f]; }
    setSaveMsg("Сохраняю…");
    const r = await saveForecastEdits(id, edits, [...off]);
    if (r.ok) { setDirty(false); setSaveMsg(`Сохранено ${new Date(r.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}`); } else setSaveMsg(r.error);
  };
  const edited = (l: ForecastLine, f: Field) => vals[l.acode][f] !== init(l)[f];

  const rows = useMemo(() => lines.map((l) => ({ l, c: off.has(l.acode) ? null : calc(l, vals[l.acode]), on: !off.has(l.acode) })), [lines, vals, off]);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r.l.fur), (counts.get(key(r.l.fur)) ?? 0) + r.l.left);
  const opts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const shown = rows.filter((r) => fur === "all" || key(r.l.fur) === fur);
  const sumRows = (g: typeof rows): { c: Calc; unpriced: number } => ({
    c: g.reduce((a, r) => (r.c ? add(a, r.c) : a), ZERO),
    unpriced: g.reduce((a, r) => (r.on && !r.c ? a + r.l.left : a), 0),
  });

  const showExtra = detail || rows.some((r) => r.c && r.c.extra > 0);
  const colSpan = (detail ? 17 : 10) + (showExtra && !detail ? 1 : 0);
  const per = (v: number, n: number, f: (x: number) => string) => (n ? `${f(v / n)} / изд.` : "");
  // Пусто или 0 — прочерк.
  const cell = (v: string, sub: string, cls = "") => {
    const zero = v.trim() === "" || /^0([,.]0)?\s*₽?$/.test(v.trim());
    return <td className={TD + " whitespace-nowrap leading-tight " + cls}>{zero ? "—" : v}{zero ? null : <div className="whitespace-nowrap text-[11px] font-normal text-neutral-500">{sub}</div>}</td>;
  };
  const nCell = (c: Calc, unpriced: number) => <td className={TD}>{formatInt(c.left + unpriced)}{unpriced ? <div className="whitespace-nowrap text-[11px] font-normal text-neutral-500">без расчёта {formatInt(unpriced)}</div> : null}</td>;
  const results = (c: Calc) => {
    const n = c.left;
    return (
      <>
        {cell(n ? formatInt(c.hides) : "", per(c.hides, n, formatDec1), SEP)}{cell(n ? m(c.fur) : "", per(c.fur, n, m))}
        {cell(n ? formatInt(c.meters) : "", per(c.meters, n, formatDec1), SEP)}{cell(n ? m(c.lining) : "", per(c.lining, n, m))}
        {cell(n ? m(c.c4) : "", per(c.c4, n, m), SEP)}
        {cell(n ? m(c.work) : "", per(c.work, n, m), SEP)}
        {showExtra && cell(n ? m(c.extra) : "", per(c.extra, n, m), SEP)}
        {cell(n ? m(c.total) : "", per(c.total, n, m), SEP + " font-semibold")}
      </>
    );
  };
  const inp = (l: ForecastLine, f: Field, w = "w-16") => (
    <td className={"px-1 py-1 text-right" + (f === "hp" ? SEP : "")}>
      <input inputMode="decimal" value={vals[l.acode][f]} onChange={(e) => set(l.acode, f, e.target.value)} aria-label={f} title={f === "wp" && l.wpEst && !edited(l, f) ? l.wpEst : undefined}
        className={`${w} min-h-9 rounded border px-1.5 text-right text-sm tabular-nums ${edited(l, f) ? "border-[var(--ui-accent)] bg-[var(--ui-soft)]" : "border-neutral-200 bg-white"}`} />
    </td>
  );

  // Таблица типов меха: «будет использовано» = шкуры по включённым строкам.
  const needBy = new Map<string, number>();
  for (const r of rows) if (r.c && !r.l.fur.includes(" + ")) needBy.set(r.l.fur, (needBy.get(r.l.fur) ?? 0) + r.c.hides);
  const furNames = [...new Set([...stock.map((s) => s.fur), ...needBy.keys()])];
  const all = furNames.map((n) => { const st = stock.find((s) => s.fur === n)?.stock ?? 0, need = needBy.get(n) ?? 0; return { fur: n, stock: st, need }; }).sort((a, b) => b.stock - a.stock);
  const big = all.filter((x) => x.stock + x.need >= 100), small = all.filter((x) => x.stock + x.need < 100);
  const furRows = small.length ? [...big, { fur: "Остальной мех", stock: small.reduce((a, x) => a + x.stock, 0), need: small.reduce((a, x) => a + x.need, 0) }] : big;
  const totalLeft = lines.reduce((a, l) => a + l.left, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{name}{season && !name.includes(season) ? <span className="ml-2 text-sm font-normal text-neutral-500">{season}</span> : null}</h1>
          <p className="mt-1 text-xs text-neutral-500">Ждём {formatInt(totalLeft)} изд.{asOf ? ` (отчёт о товарах на ${asOf.split("-").reverse().join(".")})` : ""}. Суммы ₽ с НДС, до тысяч; итоги — средневзвешенные.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {canEdit && detail ? <button type="button" onClick={save} disabled={!dirty} className="min-h-11 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-50">Сохранить</button> : null}
        {saveMsg || dirty ? <span className="text-xs text-neutral-500" role="status">{dirty ? "Есть несохранённые изменения" : saveMsg}</span> : null}
        <button type="button" aria-pressed={detail} onClick={() => setDetail((d) => !d)}
          className={"min-h-11 rounded-lg border px-4 text-sm " + (detail ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-300 bg-white hover:border-neutral-500")}>Детально</button>
        </div>
      </div>
      <div role="group" aria-label="Тип меха" className="flex flex-wrap gap-1.5">
        {["all", ...opts].map((o) => (
          <button key={o} type="button" aria-pressed={fur === o} onClick={() => setFur(o)}
            className={"min-h-11 rounded-lg border px-3 text-sm " + (fur === o ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-300 bg-white hover:border-neutral-500")}>{o === "all" ? "Все" : o}</button>
        ))}
      </div>
      <h2 className="text-base font-semibold">Артикулы в заказе: примерный расход и себестоимость</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr><th colSpan={detail ? 4 : 3} />
              {detail && <th colSpan={6} className={GH + SEP}>Заполнено на 1 изделие</th>}
              <th colSpan={2} className={GH + SEP}>Мех</th><th colSpan={2} className={GH + SEP}>Подкладка</th><th className={GH + SEP}>Надбавка 4 %</th><th className={GH + SEP}>Работа</th>{showExtra && <th className={GH + SEP}>Доп. расходы</th>}<th className={GH + SEP}>Всего</th></tr>
            <tr className="border-b border-neutral-200">
              {detail && <th className={TH + " text-center"}>Учесть</th>}
              <th className={TH + " text-left"}>Категория</th><th className={TH + " text-left"}>Артикул</th><th className={TH}>Изд.</th>
              {detail && <><th className={TH + SEP}>Шкур</th><th className={TH}>Цена шкуры, ₽</th><th className={TH}>Подкладка, м</th><th className={TH}>Цена м, ₽</th><th className={TH}>Работа, ₽</th><th className={TH}>Доп. расходы, ₽</th></>}
              <th className={TH + SEP}>Шкур</th><th className={TH}>₽</th><th className={TH + SEP}>Метров</th><th className={TH}>₽</th><th className={TH + SEP}>₽</th><th className={TH + SEP}>₽</th>{showExtra && <th className={TH + SEP}>₽</th>}<th className={TH + SEP}>Себестоимость, ₽</th>
            </tr>
          </thead>
          <tbody>
            {([["clothes", "Одежда"], ["acc", "Аксессуары"]] as const).map(([cls, title]) => {
              const g = shown.filter((r) => r.l.cls === cls);
              if (!g.length) return null;
              const s = sumRows(g);
              return (
                <Fragment key={cls}>
                  <tr className="bg-neutral-100"><td colSpan={colSpan} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600">{title}</td></tr>
                  {g.map(({ l, c, on }) => (
                    <tr key={l.acode} className={"border-b border-neutral-100 " + (on ? "" : "text-neutral-400")}>
                      {detail && <td className="px-3 py-2 text-center"><input type="checkbox" checked={on} aria-label={`Учитывать ${l.acode}`} onChange={() => { setDirty(true); setOff((p) => { const n = new Set(p); if (n.has(l.acode)) n.delete(l.acode); else n.add(l.acode); return n; }); }} className="h-5 w-5" /></td>}
                      <td className="px-3 py-2 text-sm text-neutral-600">{l.cat2}</td>
                      <td className="min-w-[190px] px-3 py-2 text-sm">{l.acode}{detail && l.source !== "ТЗ артикула" ? <span className="ml-1 text-[11px] text-neutral-400">{[l.source === "категория" ? "шкуры по категории" : "", l.wpEst ? "работа — ориентир" : ""].filter(Boolean).join(", ")}</span> : null}</td>
                      <td className={TD}>{formatInt(l.left)}</td>
                      {detail && <>{inp(l, "hp")}{inp(l, "hidePrice", "w-20")}{inp(l, "mp")}{inp(l, "meterPrice", "w-20")}{inp(l, "wp", "w-20")}{inp(l, "extra", "w-20")}</>}
                      {results(c ?? ZERO)}
                    </tr>
                  ))}
                  <tr className="bg-neutral-50 font-semibold"><td colSpan={detail ? 3 : 2} className="px-3 py-2 text-sm">Итого: {title.toLowerCase()}</td>{nCell(s.c, s.unpriced)}{detail && <td colSpan={6} />}{results(s.c)}</tr>
                </Fragment>
              );
            })}
            {(() => { const s = sumRows(shown); return <tr className="border-t-2 border-neutral-300 bg-neutral-100 font-semibold"><td colSpan={detail ? 3 : 2} className="px-3 py-2 text-sm">Общий итог</td>{nCell(s.c, s.unpriced)}{detail && <td colSpan={6} />}{results(s.c)}</tr>; })()}
          </tbody>
        </table>
      </div>
      <h2 className="mt-2 text-base font-semibold">Сырьё по типам меха, шкур</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[560px]">
          <thead><tr className="border-b border-neutral-200"><th className={TH + " text-left"}>Тип меха</th><th className={TH}>Сейчас на остатке</th><th className={TH}>Будет использовано</th><th className={TH}>Останется</th></tr></thead>
          <tbody>
            {furRows.map((x) => { const rest = x.stock - x.need; return (
              <tr key={x.fur} className="border-b border-neutral-100">
                <td className="px-3 py-2 text-sm">{x.fur}</td><td className={TD}>{formatInt(x.stock)}</td><td className={TD}>{x.need > 0 ? formatInt(x.need) : "—"}</td>
                <td className={TD + (rest < 0 ? " font-semibold text-red-700" : " font-semibold")}>{rest < 0 ? `не хватает ${formatInt(-rest)}` : formatInt(rest)}</td>
              </tr>); })}
            <tr className="bg-neutral-50 font-semibold"><td className="px-3 py-2 text-sm">Итого</td>
              <td className={TD}>{formatInt(furRows.reduce((a, x) => a + x.stock, 0))}</td><td className={TD}>{formatInt(furRows.reduce((a, x) => a + x.need, 0))}</td><td className={TD}>{formatInt(furRows.reduce((a, x) => a + x.stock - x.need, 0))}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
