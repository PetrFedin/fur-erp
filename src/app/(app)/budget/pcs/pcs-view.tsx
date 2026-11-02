"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { CAT_LABEL, ttlOf, avgOf, buildPcsView, DEFAULT_PCS_PARAMS, type PcsParams, pcsMixKey, minkSexOf, type MinkSexStock, ST_COLS, ST_FILE_LEN, ST_LEN, stOf, stTop, stYear, sumRoots, type PcsBlock, type PcsNode, type PcsRow } from "@/lib/budget-pcs";
import { formatDec1, formatInt } from "@/lib/utils";
import { exportPcsXlsx, savePcsParams, savePcsRows } from "./actions";
import { Fw27Compare, Fw27Dialog } from "./fw27-panel";
import { photoCount, slidesFor, type Crit, type Fw27Data } from "@/lib/fw27-presentation";

// Заголовки сводки сырья: переносятся на две строки, чтобы колонки были узкими.
const TH2 = "max-w-[7.5rem] px-2 py-1.5 text-right text-xs font-medium leading-tight text-neutral-500 border-l border-neutral-200";
const TH = "whitespace-nowrap px-2 py-1.5 text-right text-xs font-medium text-neutral-500 border-l border-neutral-200";
const TD = "whitespace-nowrap px-2 py-1.5 text-right text-sm tabular-nums border-l";
// Тонкие линии между колонками и строками: цвет по уровню строки; пары колонок (EUR/PCS) отделены чуть заметнее.
const LINE: Record<number, string> = { 0: "border-white/25", 1: "border-white/25", 2: "border-[#B4B4E4]", 3: "border-[#B4B4E4]", 4: "border-neutral-200" };
const LINE_STRONG: Record<number, string> = { 0: "border-white/60", 1: "border-white/60", 2: "border-[#8C8CC8]", 3: "border-[#8C8CC8]", 4: "border-neutral-400" };
// Цвета как в файле MVST, но с достаточным контрастом текста (AA).
const LEVEL: Record<number, string> = { 0: "bg-[#3F3F6F] text-white font-semibold", 1: "bg-[#5B5B96] text-white font-semibold", 2: "bg-[#D9D9F5] text-neutral-900 font-semibold", 3: "bg-[#D9D9F5] text-neutral-900 font-semibold", 4: "bg-white text-neutral-800" };
const parse = (s: string) => { const v = parseFloat(s.replace(",", ".").replace(/\s/g, "")); return Number.isFinite(v) && v >= 0 ? v : 0; };
const dateRu = (iso: string) => (iso ? iso.split("-").reverse().join(".") : "");
const cell = (v: number) => (v ? formatInt(Math.round(v)) : "–");
const FILTERS: { id: "all" | PcsBlock; label: string; blocks: PcsBlock[] }[] = [
  { id: "all", label: "Вместе", blocks: ["RTW", "Acc"] }, { id: "RTW", label: "Одежда", blocks: ["RTW"] }, { id: "Acc", label: "Аксессуары", blocks: ["Acc"] },
];
// Шапка: «Русский мех» / «Статистика» → годы (2027 — бюджет) → подгруппы колонок.
const runs = <T,>(f: (c: (typeof ST_COLS)[number]) => T) => ST_COLS.reduce<{ v: T; n: number }[]>((a, c) => { const l = a[a.length - 1], v = f(c); if (l && l.v === v) l.n++; else a.push({ v, n: 1 }); return a; }, []);
const TOP = runs(stTop), YEARS = runs(stYear);

type Props = { id: string; name: string; season: string; supplier: string; asOf: { RTW: string; Acc: string }; rows: PcsRow[]; params: PcsParams | null; raw: { fur: string; stock: number; need: number; total?: number }[]; rawForecast: string | null; mix: { RTW: number; Acc: number }; price: Record<string, number>; rawDate: string; canEdit: boolean ; fw27?: Fw27Data | null; minkStock?: MinkSexStock | null };

export function PcsView({ id, name, season, supplier, asOf, rows, params, raw, rawForecast, mix, price, rawDate, canEdit, fw27 = null, minkStock = null }: Props) {
  const [photoSel, setPhotoSel] = useState<{ crit: Crit; title: string } | null>(null);
  const p0 = params ?? DEFAULT_PCS_PARAMS;
  const [pp, setPp] = useState({ l: String(p0.leftoverPct), y: String(p0.lynxPct), n: String(p0.newPct), a: String(p0.accPct ?? DEFAULT_PCS_PARAMS.accPct), u: String(p0.upPct ?? DEFAULT_PCS_PARAMS.upPct), x: String(p0.fw26Extra ?? 5) });
  const [rawDetail, setRawDetail] = useState(false);
  const [mixOpen, setMixOpen] = useState(false); // строки «из смеси» свёрнуты по умолчанию
  // Свои значения (пусто — считается по прогнозу и ТЗ): остаток после производства по типам меха и шкуры норки / соболя из смеси.
  const [ovLeft, setOvLeft] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p0.left ?? {}).map(([k, v]) => [k, String(v)])));
  const [ovMix, setOvMix] = useState({ mink: p0.mix ? String(p0.mix.mink) : "", sable: p0.mix ? String(p0.mix.sable) : "" });
  // Невостребованное сырьё по типам меха, %: часть остатка 2026, которая не пойдёт в дело, и не больше этой доли всего сырья — в остатке после заказа 2027 (пусто — 30 %).
  const [ovRes, setOvRes] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p0.reserve ?? {}).map(([k, v]) => [k, String(v)])));
  // Годный остаток — в одежду, % по типам меха (пусто — 100 − «на аксессуары»).
  const [ovRtw, setOvRtw] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p0.rtw ?? {}).map(([k, v]) => [k, String(v)])));
  const [detail, setDetail] = useState(false);
  const [stats, setStats] = useState(true);
  const [hideEmpty, setHideEmpty] = useState(true); // строки с нулевым бюджетом (PCS) скрыты, итоги считаются по всем
  const [filter, setFilter] = useState<"all" | PcsBlock>("all");
  const shown = (r: PcsRow) => ({ pcs: String(r.pcs), avg: r.avg == null ? "" : String(Math.round(r.avg * 100) / 100), st: stOf(r).map(String) });
  const [vals, setVals] = useState(() => rows.map(shown));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = (i: number, k: "pcs" | "avg", v: string) => { setDirty(true); setVals((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x))); };
  const editSt = (i: number, c: number, v: string) => { setDirty(true); setVals((p) => p.map((x, j) => (j === i ? { ...x, st: x.st.map((o, q) => (q === c ? v : o)) } : x))); };
  // Не тронутое поле остаётся с исходной точностью (на экране AVG округлён до сотых).
  const cur: PcsRow[] = useMemo(() => rows.map((r, i) => {
    const s0 = shown(r);
    return { ...r, pcs: vals[i].pcs === s0.pcs ? r.pcs : parse(vals[i].pcs), avg: vals[i].avg === s0.avg ? r.avg : vals[i].avg.trim() === "" ? null : parse(vals[i].avg), st: vals[i].st.map((v, c) => (v === s0.st[c] ? stOf(r)[c] : parse(v))) };
  }), [rows, vals]);
  const blocks = FILTERS.find((f) => f.id === filter)!.blocks;
  const tree = useMemo(() => buildPcsView(cur, blocks), [cur, blocks]);
  const total = useMemo(() => sumRoots(tree), [tree]);
  // Разбивка для виджетов: одежда и аксессуары отдельно (только включённые кнопкой).
  const parts = useMemo(() => blocks.map((b) => ({ b, t: sumRoots(buildPcsView(cur, [b])) })), [cur, blocks]);
  const by = (f: (t: ReturnType<typeof sumRoots>) => string) => (parts.length > 1 ? parts.map((x) => `${x.b === "RTW" ? "Одежда" : "Аксессуары"} ${f(x.t)}`).join(" · ") : undefined);
  const totalAvg = total.hasAvg && total.pcsA > 0 ? total.ttl / total.pcsA : null;
  // Сводка по типам меха: сумма по выбранным блокам.
  const furs = useMemo(() => {
    const m = new Map<string, { pcs: number; pcsA: number; ttl: number; ttlB: number; hasAvg: boolean }>();
    for (const root of tree) for (const f of root.children) { const o = m.get(f.label) ?? { pcs: 0, pcsA: 0, ttl: 0, ttlB: 0, hasAvg: false }; o.pcs += f.pcs; o.pcsA += f.pcsA; o.ttl += f.ttl; o.ttlB += f.ttlB; o.hasAvg = o.hasAvg || f.hasAvg; m.set(f.label, o); }
    return [...m.entries()].map(([label, v]) => ({ label, ...v })).filter((f) => f.pcs > 0 || f.hasAvg).sort((a, b) => b.pcs - a.pcs);
  }, [tree]);

  // Сырьё: сколько шкур есть, сколько уйдёт на допроизводство заказанного, сколько можно использовать и сколько докупать.
  // Пустое поле — значение по умолчанию, ноль — действительно ноль (например, «из остатков 0 %»: остатки не используем).
  const pctOr = (v: string, d: number, min = 0) => { if (v.trim() === "") return d; const x = parseFloat(v.replace(",", ".")); return Number.isFinite(x) ? Math.min(100, Math.max(min, x)) : d; };
  const pct = (v: string) => { const x = parseFloat(v.replace(",", ".")); return Number.isFinite(x) && x > 0 ? Math.min(100, x) : 0; };
  const rawBy = useMemo(() => new Map(raw.map((r) => [r.fur, r])), [raw]);
  // Проценты как при сохранении: пусто или 0 — значение по умолчанию (иначе экран и сохранённое расходятся).
  const resDefault = 30;
  const resOf = (fur: string) => { const v = parseFloat((ovRes[fur] ?? "").replace(",", ".")); return Number.isFinite(v) ? Math.min(99, Math.max(0, v)) : resDefault; };
  const rtwDefault = 100 - pctOr(pp.a, 75);
  const rtwOf = (fur: string) => { const v = parseFloat((ovRtw[fur] ?? "").replace(",", ".")); return (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : rtwDefault) / 100; };
  const supply = useMemo(() => {
    const own = (v: string, d: number) => (v.trim() === "" || !Number.isFinite(parseFloat(v.replace(",", "."))) ? d : Math.max(0, parseFloat(v.replace(",", "."))));
    const up = pctOr(pp.u, 10); // пустое поле — 10 %, «0» — без роста
    // Шкуры по типу меха и блоку. «Норка+Соболь» делим на норку и соболь по доле норки строки (решение владельца), без неё — по факту ТЗ.
    const minkShare = (r: PcsRow) => { const v = p0.mixRows?.[pcsMixKey(r)]; return v != null ? v / 100 : mix[r.block]; };
    const ttlB = new Map<string, Record<PcsBlock, number>>();
    const add = (fur: string, b: PcsBlock, v: number) => { const o = ttlB.get(fur) ?? { RTW: 0, Acc: 0 }; o[b] += v; ttlB.set(fur, o); };
    const mixM = { RTW: 0, Acc: 0 }, mixS = { RTW: 0, Acc: 0 };
    for (const r of cur) {
      if (!blocks.includes(r.block)) continue;
      const t = ttlOf(r) ?? 0;
      if (r.fur === "Норка+Соболь") { const s = minkShare(r); mixM[r.block] += t * s; mixS[r.block] += t * (1 - s); } else add(r.fur, r.block, t);
    }
    const calcMink = mixM.RTW + mixM.Acc, calcSable = mixS.RTW + mixS.Acc;
    const toMink = own(ovMix.mink, calcMink), toSable = own(ovMix.sable, calcSable);
    // Свои шкуры из смеси делим по блокам в той же пропорции, что и расчётные.
    const kM = calcMink > 0 ? toMink / calcMink : 0, kS = calcSable > 0 ? toSable / calcSable : 0;
    for (const b of blocks) { add("Норка", b, mixM[b] * kM); add("Соболь", b, mixS[b] * kS); }
    if (calcMink === 0 && toMink > 0) add("Норка", blocks[0], toMink);
    if (calcSable === 0 && toSable > 0) add("Соболь", blocks[0], toSable);
    // Остаток всегда делится между блоками, как в Excel: в одежду — свой % вида меха (лучшая часть), остальное — в аксессуары; лишнее одного блока в другой не переходит.
    const share = (fur: string, b: PcsBlock) => (b === "RTW" ? rtwOf(fur) : 1 - rtwOf(fur));
    const rowsOut = furs.map((f) => {
      if (f.label === "Норка+Соболь") return { label: f.label, ttl: f.ttl, mixed: true as const, toMink, toSable, calcMink, calcSable };
      // Ещё возьмём со склада на оставшиеся модели FW26: не выданное по ТЗ + запас % к их расходу по норме (как Excel, лист 4).
      const extra = pctOr(pp.x, 5) / 100; // пустое поле — 5 %, «0» — без запаса
      const r = rawBy.get(f.label), stock = r?.stock ?? 0, need = (r?.need ?? 0) + extra * (r?.total ?? 0);
      const calcLeft = Math.max(0, stock - need), leftAll = own(ovLeft[f.label] ?? "", calcLeft);
      const res = resOf(f.label);
      // Как в Excel (лист 7): годный остаток = остаток × (1 − невостребованное); используем меньшее из «нужно» и «годного» по блоку;
      // закупить = нужно из покупки ÷ (1 − X): после заказа от купленного остаётся X %; неиспользованный остаток 2026 в этот процент не входит.
      let t = 0, left = 0, use = 0, np = 0;
      for (const b of blocks) {
        const sh = share(f.label, b), tb = ttlB.get(f.label)?.[b] ?? 0, lb = leftAll * sh, ub = lb * (1 - res / 100);
        // Нехватка на уже запланированное (склад меньше «нужно»): тоже покупаем, по доле блока.
        t += tb; left += lb; use += ub; np += tb - Math.min(tb, ub) + Math.max(0, need - stock) * sh;
      }
      const buy = np / (1 - res / 100);
      const pr = price[f.label] ?? 0, money = buy * pr * (1 + up / 100);
      return { label: f.label, ttl: f.ttl, mixed: false as const, t, stock, need, left, leftAll, calcLeft, use, np, res, buy, buyPriced: pr > 0 ? buy : 0, pr, money };
    });
    const sum = (k: "stock" | "need" | "left" | "use" | "np" | "buy" | "buyPriced" | "money") => rowsOut.reduce((a, r) => a + (r.mixed ? 0 : r[k]), 0);
    // Норка по полу (только «Вместе»): короткие шубы — самцы, длинные — самки (параметр minkSex); остальным пол не важен.
    let sex: null | { rows: { code: "M" | "F" | "U"; label: string; stock: number; left: number; use: number; need: number; short: number; extra: number; buy: number }[]; buy: number } = null;
    const mink = rowsOut.find((x) => x.label === "Норка");
    if (minkStock && blocks.length === 2 && mink && !mink.mixed) {
      const needBy = { M: 0, F: 0, U: 0 };
      for (const r of cur) {
        if (r.fur !== "Норка" && r.fur !== "Норка+Соболь") continue;
        const t = (ttlOf(r) ?? 0) * (r.fur === "Норка" ? 1 : minkShare(r) * (kM || 1));
        needBy[minkSexOf(r, p0.minkSex) ?? "U"] += t;
      }
      const st = minkStock, all = st.M + st.F + st.U, resM = mink.res;
      const base = (code: "M" | "F" | "U", label: string) => {
        const left = all > 0 ? mink.leftAll * (st[code] / all) : 0, use = left * (1 - resM / 100);
        return { code, label, stock: st[code], left, use, need: needBy[code], short: 0, extra: 0, buy: 0 };
      };
      const M = base("M", "Самцы (M)"), F = base("F", "Самки (F)"), U = base("U", "Пол не указан / не важен");
      for (const x of [M, F]) { x.short = Math.max(0, x.need - x.use); x.extra = Math.max(0, x.use - x.need); }
      const avail = U.use + M.extra + F.extra;
      U.short = Math.max(0, U.need - avail); U.extra = Math.max(0, avail - U.need);
      // Закупить по полу = не хватает ÷ (1 − X), как в Excel; закупка норки по блокам выше должна быть не меньше суммы.
      for (const x of [M, F, U]) x.buy = x.short / (1 - resM / 100);
      sex = { rows: [M, F, U], buy: M.buy + F.buy + U.buy };
      // Закупка норки = большее из «по блокам» и «по полу» (как Excel, лист 7): самцов и самок должно хватить.
      if (sex.buy > mink.buy) { const k = sex.buy / mink.buy; mink.buy = sex.buy; mink.buyPriced = mink.pr > 0 ? sex.buy : 0; mink.money *= k; }
    }
    return { rows: rowsOut, sex, total: { stock: sum("stock"), need: sum("need"), left: sum("left"), use: sum("use"), np: sum("np"), buy: sum("buy"), buyPriced: sum("buyPriced"), money: sum("money") } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [furs, rawBy, pp, cur, blocks, mix, ovLeft, ovMix, ovRes, ovRtw, price, minkStock]);
  const lastSaved = useRef<string | null>(null);
  if (lastSaved.current === null) {
    const l0 = Object.fromEntries(Object.entries(p0.left ?? {}).filter(([, v]) => Number.isFinite(v)));
    const r0 = Object.fromEntries(Object.entries(p0.reserve ?? {}).filter(([, v]) => Number.isFinite(v)));
    lastSaved.current = JSON.stringify({ leftoverPct: p0.leftoverPct ?? 70, lynxPct: p0.lynxPct ?? 85, newPct: p0.newPct ?? 70, accPct: p0.accPct ?? 75, upPct: Math.max(0, p0.upPct ?? DEFAULT_PCS_PARAMS.upPct ?? 10), left: l0, mix: p0.mix ? { mink: p0.mix.mink, sable: p0.mix.sable } : null, reserve: r0, mixRows: p0.mixRows ?? {}, minkSex: p0.minkSex ?? {}, rtw: Object.fromEntries(Object.entries(p0.rtw ?? {}).filter(([, v]) => Number.isFinite(v))), fw26Extra: p0.fw26Extra ?? 5 });
  }
  const saveParams = () => {
    if (!canEdit) return;
    const num = (v: string) => parseFloat(v.replace(",", "."));
    const left = Object.fromEntries(Object.entries(ovLeft).filter(([, v]) => v.trim() !== "" && Number.isFinite(num(v))).map(([k, v]) => [k, num(v)]));
    const rtw = Object.fromEntries(Object.entries(ovRtw).filter(([, v]) => v.trim() !== "" && Number.isFinite(num(v))).map(([k, v]) => [k, Math.min(100, Math.max(0, num(v)))]));
    const reserve = Object.fromEntries(Object.entries(ovRes).filter(([, v]) => v.trim() !== "" && Number.isFinite(num(v))).map(([k, v]) => [k, Math.min(99, Math.max(0, num(v)))]));
    const mixOk = Number.isFinite(num(ovMix.mink)) && Number.isFinite(num(ovMix.sable));
    // Доли норки по строкам и пол норки на экране не правятся — сохраняются как были (иначе первое же сохранение их сотрёт).
    const payload = { leftoverPct: pctOr(pp.l, 70), lynxPct: pctOr(pp.y, 85), newPct: pctOr(pp.n, 70, 1), accPct: pctOr(pp.a, 75), upPct: pctOr(pp.u, 10), left, mix: mixOk ? { mink: num(ovMix.mink), sable: num(ovMix.sable) } : null, reserve, mixRows: p0.mixRows ?? {}, minkSex: p0.minkSex ?? {}, rtw, fw26Extra: pctOr(pp.x, 5) };
    // Пишем в базу только если что-то изменилось (уход из поля без правки не меняет «Изменён …» и не пересчитывает страницы).
    const sig = JSON.stringify(payload);
    if (sig === lastSaved.current) return;
    lastSaved.current = sig;
    void savePcsParams(id, payload);
  };

  const supplyInp = (value: string, on: (v: string) => void, ph: string, label: string) => (
    <input inputMode="decimal" aria-label={label} value={value} placeholder={ph} onChange={(e) => on(e.target.value)} onBlur={saveParams}
      className={`min-h-9 w-20 rounded border bg-white px-1.5 text-right text-sm tabular-nums text-neutral-900 placeholder:text-neutral-600 ${value.trim() !== "" ? "border-[var(--ui-accent)] bg-[var(--ui-soft)]" : "border-neutral-300"}`} />
  );
  // «Норка+Соболь» раскрыта на норку и соболя числами: они входят в расчёт норки и соболя выше.
  const mixRow = supply.rows.find((r) => r.mixed);
  const mixedRows = mixRow && mixRow.mixed ? ([["норка", mixRow.toMink, mixRow.calcMink, "mink"], ["соболь", mixRow.toSable, mixRow.calcSable, "sable"]] as const).map(([name, v, calc, key]) => (
    <tr key={key} className="border-b border-neutral-100 bg-neutral-50 text-neutral-700">
      <td className="px-3 py-1 text-sm" style={{ paddingLeft: 28 }}>из смеси: {name} ({Math.round((key === "mink" ? mixRow.toMink : mixRow.toSable) / Math.max(1, mixRow.toMink + mixRow.toSable) * 100)} %)</td>
      <td className={`${TD} border-neutral-200`} /><td className={`${TD} border-neutral-200`} /><td className={`${TD} border-neutral-200`} />
      <td className={`${TD} border-neutral-200`}>{rawDetail && canEdit ? supplyInp(ovMix[key], (x) => setOvMix((o) => ({ ...o, [key]: x })), String(Math.round(calc)), `Шкур ${name} из смеси`) : cell(v)}</td>
      <td colSpan={8} className={`${TD} border-neutral-200 text-xs text-neutral-500`}>входит в {name === "норка" ? "норку" : "соболя"} выше</td>
    </tr>
  )) : null;

  const save = async () => {
    setBusy(true); setMsg("Сохраняю…");
    const r = await savePcsRows(id, cur.filter((x) => !x.sys).map((x) => ({ pcs: x.pcs, avg: x.avg, st: stOf(x).slice(0, ST_FILE_LEN) })));
    setBusy(false);
    if (r.ok) { setDirty(false); setMsg(`Сохранено ${new Date(r.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}`); } else setMsg(r.error);
  };
  const download = async () => {
    setBusy(true);
    try {
      if (dirty) { setMsg("Сначала сохраните изменения: Excel собирается из сохранённых данных"); return; }
      const r = await exportPcsXlsx(id, blocks, hideEmpty);
      if (!r.ok) { setMsg(r.error); return; }
      const bin = atob(r.base64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = r.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setMsg("Не удалось сформировать Excel"); } finally { setBusy(false); }
  };

  const inp = (value: string, on: (v: string) => void, w: string, label: string, ph?: string) => (
    <input inputMode="decimal" aria-label={label} value={value} placeholder={ph} onChange={(e) => on(e.target.value)}
      className={`${w} min-h-9 rounded border border-neutral-300 bg-white px-1.5 text-right text-sm tabular-nums text-neutral-900 placeholder:italic placeholder:text-neutral-600`} />
  );
  const rowOf = (n: PcsNode, key: string, label: string, level: number, ctx: { fur?: string; acc?: boolean } = {}): React.ReactNode => {
    const a = avgOf(n);
    const editable = detail && canEdit && n.leaf && n.rowIndex != null && !n.leaf.sys;
    const i = n.rowIndex ?? -1;
    return (
      <tr key={key} className={`${LEVEL[level]} border-b ${level >= 4 ? "border-neutral-200" : LINE[level]}`}>
        <td className={`sticky left-0 z-[1] bg-inherit px-3 py-1.5 text-sm`} style={{ paddingLeft: 12 + (level === 4 ? 3 : level) * 16 }}>{(() => {
          // Фото из презентации FW27: у строк «Одежда» (мех / категория / длина) — кнопка с числом фото, открывает окно поверх страницы.
          const fur = n.crit.fur ?? ctx.fur;
          if (!fw27 || level < 1 || level > 4 || ctx.acc || n.crit.group || !fur) return label;
          // В узле категория — подпись для экрана («Жилеты»), в данных — название из справочника («Жилет меховой»).
          const rawCat = n.crit.cat ? Object.entries(CAT_LABEL).find(([, v]) => v === n.crit.cat)?.[0] ?? n.crit.cat : undefined;
          const crit: Crit = { fur, ...(rawCat ? { cat: rawCat } : {}), ...(n.crit.len ? { len: n.crit.len } : {}) };
          const cnt = photoCount(slidesFor(fw27, crit));
          return <span className="flex items-center justify-between gap-3 whitespace-nowrap">{label}<button type="button" onClick={() => setPhotoSel({ crit, title: [crit.fur, n.crit.cat, crit.len].filter(Boolean).join(" · ") })} aria-label={`Фото из презентации: ${label}, ${cnt} шт.`} className={`-my-0.5 inline-flex min-h-6 shrink-0 items-center rounded border px-1.5 text-[11px] font-normal leading-none hover:opacity-100 ${cnt ? "border-current/40 opacity-90" : "border-dashed border-current/50 opacity-60"}`}>Фото {cnt}</button></span>;
        })()}</td>
        <td className={`${TD} ${LINE_STRONG[level]}`}>{editable ? inp(vals[i].pcs, (v) => edit(i, "pcs", v), "w-16", "Штуки") : cell(n.pcs)}</td>
        <td className={`${TD} ${LINE[level]}`}>{editable ? inp(vals[i].avg, (v) => edit(i, "avg", v), "w-16", "Шкур на изделие", n.leaf?.avgB != null ? String(Math.round(n.leaf.avgB * 10) / 10) : undefined)
          : a == null ? "–" : formatDec1(a)}</td>
        <td className={`${TD} ${LINE[level]}`}>{n.hasAvg ? cell(n.ttl) : "–"}</td>
        {stats ? n.st.map((v, c) => <td key={c} className={`${TD} ${c % 2 === 0 ? LINE_STRONG[level] : LINE[level]}`}>{editable && c < ST_FILE_LEN ? inp(vals[i].st[c], (x) => editSt(i, c, x), ST_COLS[c].money ? "w-20" : "w-14", ST_COLS[c].name) : cell(v)}</td>) : null}
      </tr>
    );
  };
  // ctx — мех и признак «аксессуары» от родителей: у вложенных строк (категория, длина) в самом узле меха нет.
  const line = (n: PcsNode, ctx: { fur?: string; acc?: boolean } = {}): React.ReactNode => {
    if (hideEmpty && n.level > 0 && n.pcs === 0) return null;
    const next = { fur: n.crit.fur ?? ctx.fur, acc: ctx.acc || /(^|\|)Acc(\||$)/.test(n.key) || n.crit.block === "Аксессуары" };
    return (
      <Fragment key={n.key}>
        {rowOf(n, n.key, n.label, n.level, ctx.acc || next.acc ? { ...ctx, acc: true } : ctx)}
        {n.children.map((c) => line(c, next))}
      </Fragment>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{name}{season && !name.includes(season) ? <span className="ml-2 text-sm font-normal text-neutral-500">{season}</span> : null}</h1>
          <p className="mt-1 text-xs text-neutral-500">{supplier}{asOf.RTW ? ` · одежда обновлена ${dateRu(asOf.RTW)}` : ""}{asOf.Acc ? ` · аксессуары обновлены ${dateRu(asOf.Acc)}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? <span className="text-xs text-neutral-500" role="status">Есть несохранённые изменения</span> : msg ? <span className="text-xs text-neutral-500" role="status">{msg}</span> : null}
          {canEdit && detail ? <button type="button" onClick={save} disabled={!dirty || busy} className="min-h-11 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-50">Сохранить</button> : null}
          <button type="button" aria-pressed={detail} onClick={() => setDetail((d) => !d)}
            className={"min-h-11 rounded-lg border px-4 text-sm " + (detail ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-300 bg-white hover:border-neutral-500")}>Детально</button>
          <button type="button" onClick={download} disabled={busy} className="min-h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm hover:border-neutral-500 disabled:opacity-50">Скачать Excel</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Что включить в отчёт">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
            className={"min-h-11 rounded-lg border px-4 text-sm " + (filter === f.id ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-300 bg-white hover:border-neutral-500")}>{f.label}</button>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-neutral-200 sm:block" />
        <button type="button" aria-pressed={stats} onClick={() => setStats((v) => !v)}
          className={"min-h-11 rounded-lg border px-4 text-sm " + (stats ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-300 bg-white hover:border-neutral-500")}>Статистика</button>
        <button type="button" aria-pressed={hideEmpty} onClick={() => setHideEmpty((v) => !v)}
          className={"min-h-11 rounded-lg border px-4 text-sm " + (hideEmpty ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-300 bg-white hover:border-neutral-500")}>Скрыть пустые</button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Изделий, шт." value={formatInt(total.pcs)} note={by((t) => formatInt(t.pcs))} />
        <Stat label="Шкур всего" value={total.hasAvg ? formatInt(Math.round(total.ttl)) : "–"} note={by((t) => (t.hasAvg ? formatInt(Math.round(t.ttl)) : "–"))} />
        <Stat label="Шкур на изделие, средневзв." value={totalAvg == null ? "–" : formatDec1(totalAvg)} note={by((t) => (avgOf(t) == null ? "–" : formatDec1(avgOf(t)!)))} />
      </div>

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Доли использования сырья">
        {([["x", "Запас на оставшиеся FW26, %"], ["u", "Рост цены, %"]] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-neutral-600">{label}
            <input inputMode="decimal" value={pp[k]} disabled={!canEdit} onChange={(e) => setPp((v) => ({ ...v, [k]: e.target.value }))} onBlur={saveParams}
              className="min-h-11 w-24 rounded-lg border border-neutral-300 bg-white px-2 text-right text-sm tabular-nums text-neutral-900 disabled:opacity-60" />
          </label>
        ))}
        <button type="button" aria-pressed={rawDetail} onClick={() => setRawDetail((v) => !v)}
          className={"min-h-11 rounded-lg border px-4 text-sm " + (rawDetail ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-300 bg-white hover:border-neutral-500")}>Детально</button>
        <p className="max-w-md text-xs text-neutral-600">Остаток — что останется после того, как сошьём оставшиеся изделия FW26 (на {rawDate.split("-").reverse().join(".")}), с запасом {pp.x} % к их расходу по норме. Невостребованное сырьё, % (по виду меха, в таблице) — часть остатка 2026, которая не пойдёт в дело, и доля купленного, которая останется после заказа 2027: закупить = нужно ÷ (1 − %). Годный остаток делится: «в одежду, %» по виду меха, остальное — в аксессуары; лишнее одного блока в другой не переходит. Цена шкуры — средневзвешенная по ТЗ без роста, рост задаётся здесь. Так же считает Excel «Сырьё и бюджет FW27», лист 7.</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-neutral-200"><th className="px-3 py-1.5 text-left text-xs font-medium text-neutral-500">По типам меха</th><th className={TH2}>Шт.</th><th className={TH2}>Доля</th><th className={TH2}>Шкур на изд.</th><th className={TH2}>Шкур всего (TTL)</th>
              <th className={TH2} title="Шкуры, которые останутся на складе после того, как сделаем все запланированные изделия (отчёт-прогноз)">Остаток после производства</th>
              <th className={TH2} title="Остаток после производства × (1 − невостребованное)">Годный остаток<span className="block font-normal text-neutral-500">без невостребованного</span></th>
              <th className={TH2} title="TTL минус то, что можно использовать">Нужно из новой покупки</th>
              <th className={TH2} title="Часть остатка 2026, которая не пойдёт в дело, и доля купленного в 2027, которая останется после заказа. Владелец: соболь, норка, каракульча 30, лиса 20, рысь 15">Невостребованное, %</th>
              <th className={TH2} title="Годный остаток 2026 — в одежду (лучшая часть), остальное — в аксессуары. Владелец: рысь 80 / 20, остальные 25 / 75">Годное в одежду, %</th>
              <th className={TH2} title="Нужно из покупки ÷ (1 − невостребованное %): после заказа от купленного остаётся этот процент">Закупить<span className="block font-normal text-neutral-500">с запасом</span></th>
              <th className={TH2} title="Средневзвешенная цена шкуры по ТЗ, ₽ с НДС, без роста. Нет цены (например, у рыси в ТЗ) — прочерк, в закупку не входит">Ср. цена шкуры, ₽</th>
              <th className={TH2} title="Закупить × средняя цена × (1 + рост цены)">На закупку, ₽<span className="block font-normal text-neutral-500">цена +{pp.u} %</span></th></tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 bg-neutral-100 font-semibold">
              <td className="px-3 py-1.5 text-sm">Всего</td>
              <td className={`${TD} border-neutral-200`}>{cell(total.pcs)}</td>
              <td className={`${TD} border-neutral-200`}>{total.pcs ? "100 %" : "–"}</td>
              <td className={`${TD} border-neutral-200`}>{totalAvg == null ? "–" : formatDec1(totalAvg)}</td>
              <td className={`${TD} border-neutral-200`}>{total.hasAvg ? cell(total.ttl) : "–"}</td>
              <td className={`${TD} border-neutral-200`} title={`на складе ${cell(supply.total.stock)}, уйдёт на запланированное ${cell(supply.total.need)}`}>{cell(supply.total.left)}</td>
              <td className={`${TD} border-neutral-200`}>{cell(supply.total.use)}</td>
              <td className={`${TD} border-neutral-200`}>{cell(supply.total.np)}</td>
              <td className={`${TD} border-neutral-200`} />
              <td className={`${TD} border-neutral-200`} />
              <td className={`${TD} border-neutral-200`}>{cell(supply.total.buy)}</td>
              <td className={`${TD} border-neutral-200`}>{supply.total.buyPriced > 0 ? cell(supply.total.money / (supply.total.buyPriced * (1 + pctOr(pp.u, 10) / 100))) : "–"}</td>
              <td className={`${TD} border-neutral-200`}>{cell(supply.total.money)}</td>
            </tr>
            {furs.map((f) => (
              <Fragment key={f.label}>
              <tr className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-1.5 text-sm">{f.label === "Норка+Соболь" ? (
                  <button type="button" aria-expanded={mixOpen || rawDetail} onClick={() => setMixOpen((v) => !v)} className="inline-flex min-h-8 items-center gap-1.5 text-left hover:underline">
                    <span aria-hidden className="text-xs text-neutral-500">{mixOpen || rawDetail ? "▾" : "▸"}</span>{f.label}
                  </button>
                ) : f.label}</td>
                <td className={`${TD} border-neutral-200`}>{cell(f.pcs)}</td>
                <td className={`${TD} border-neutral-200`}>{total.pcs ? `${formatDec1((f.pcs / total.pcs) * 100)} %` : "–"}</td>
                <td className={`${TD} border-neutral-200`}>{f.hasAvg && f.pcsA > 0 ? formatDec1(f.ttl / f.pcsA) : "–"}</td>
                <td className={`${TD} border-neutral-200`}>{f.hasAvg ? cell(f.ttl) : "–"}</td>
                {(() => { const r = supply.rows.find((x) => x.label === f.label); if (!r) return null; if (r.mixed) return <td colSpan={8} className={`${TD} border-neutral-200 text-xs text-neutral-600`}>–</td>;
                  const resCell = <td key="res" className={`${TD} border-neutral-200`}>{canEdit ? supplyInp(ovRes[f.label] ?? "", (x) => setOvRes((o) => ({ ...o, [f.label]: x })), String(resDefault), `Невостребованное сырьё, ${f.label}`) : `${formatDec1(r.res)} %`}</td>;
                  const cells = [r.left, r.use, r.np, r.buy, r.pr, r.money].map((v, k) => <td key={k} className={`${TD} border-neutral-200`} title={k === 0 ? `на складе ${cell(r.stock)}, уйдёт на запланированное ${cell(r.need)}; свой остаток вводится на весь вид меха` : undefined}>{k === 0 && rawDetail && canEdit ? supplyInp(ovLeft[f.label] ?? "", (x) => setOvLeft((o) => ({ ...o, [f.label]: x })), String(Math.round(r.calcLeft)), "Остаток после производства, всего по виду меха") : cell(v)}</td>);
                  const rtwCell = <td key="rtw" className={`${TD} border-neutral-200`}>{canEdit ? supplyInp(ovRtw[f.label] ?? "", (x) => setOvRtw((o) => ({ ...o, [f.label]: x })), String(rtwDefault), `Годное в одежду, ${f.label}`) : `${formatDec1(rtwOf(f.label) * 100)} %`}</td>;
                  return [...cells.slice(0, 3), resCell, rtwCell, ...cells.slice(3)]; })()}
              </tr>
              {f.label === "Норка+Соболь" && (mixOpen || rawDetail) ? mixedRows : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm font-semibold tabular-nums" data-purchase-total>На закупку сырья: {formatInt(Math.round(supply.total.money))} ₽ <span className="font-normal text-neutral-600">({formatInt(Math.round(supply.total.buy))} шкур, средняя цена {supply.total.buyPriced > 0 ? formatInt(Math.round(supply.total.money / supply.total.buyPriced)) : "–"} ₽ с ростом {pp.u} %, с НДС{supply.total.buy - supply.total.buyPriced > 0.5 ? `; без цены в ТЗ: ${formatInt(Math.round(supply.total.buy - supply.total.buyPriced))} шкур` : ""})</span></p>

      {supply.sex ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" data-mink-sex>
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-neutral-200"><th className="px-3 py-1.5 text-left text-xs font-medium text-neutral-500">Норка по полу</th>
                <th className={TH2}>На складе</th><th className={TH2}>Останется после FW26</th><th className={TH2}>Годный остаток</th>
                <th className={TH2}>Нужно на план</th><th className={TH2}>Не хватает</th><th className={TH2}>Закупить<span className="block font-normal text-neutral-500">с запасом</span></th></tr>
            </thead>
            <tbody>
              {supply.sex.rows.map((x) => (
                <tr key={x.code} className="border-b border-neutral-100">
                  <td className="px-3 py-1.5 text-sm">{x.label}</td>
                  {[x.stock, x.left, x.use, x.need, x.short, x.buy].map((v, k) => <td key={k} className={`${TD} border-neutral-200`}>{cell(v)}</td>)}
                </tr>
              ))}
              <tr className="bg-neutral-100 font-semibold">
                <td className="px-3 py-1.5 text-sm">Норка — итого</td>
                {[supply.sex.rows.reduce((a, x) => a + x.stock, 0), supply.sex.rows.reduce((a, x) => a + x.left, 0), supply.sex.rows.reduce((a, x) => a + x.use, 0), supply.sex.rows.reduce((a, x) => a + x.need, 0), null, supply.sex.buy].map((v, k) => <td key={k} className={`${TD} border-neutral-200`}>{v == null ? "" : cell(v)}</td>)}
              </tr>
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-neutral-600">Short — из самцов, Regular и Long — из самок (так шили по всем прошлым ТЗ); аксессуарам пол не важен, им идут лоты без пола и лишние самцы и самки. Пол лота — признак «Самец» / «Самка»; остаток 2026 делится по полу как склад. По полу нужно купить {cell(supply.sex.buy)} шкур, по блокам выше — {cell(supply.rows.find((x) => x.label === "Норка" && !x.mixed)?.buy ?? 0)}: закупать большее, самцов и самок — не меньше, чем здесь.</p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[480px]">
          <thead>
            {stats ? (
              <>
                <tr className="border-b border-neutral-100">
                  <th className="sticky left-0 z-[1] bg-white" />
                  {TOP.map((g, k) => <th key={k} colSpan={g.n + (k === 0 ? 3 : 0)} className={"px-2 py-1 text-center text-xs font-semibold text-neutral-700" + (k > 0 ? " border-l border-neutral-200" : "")}>{g.v}</th>)}
                </tr>
                <tr className="border-b border-neutral-100">
                  <th className="sticky left-0 z-[1] bg-white" />
                  <th colSpan={3} className="px-2 py-1 text-center text-xs font-semibold text-neutral-700">{season || "Бюджет"}</th>
                  {YEARS.map((g, k) => <th key={k} colSpan={g.n} className="border-l border-neutral-200 px-2 py-1 text-center text-xs font-semibold text-neutral-700">{g.v}</th>)}
                </tr>
                <tr className="border-b border-neutral-100">
                  <th className="sticky left-0 z-[1] bg-white" /><th colSpan={3} />
                  {Array.from({ length: ST_LEN / 2 }, (_, j) => <th key={j} colSpan={2} className="border-l border-neutral-200 px-2 py-1 text-center text-xs font-medium text-neutral-500">{ST_COLS[j * 2].sub}</th>)}
                </tr>
              </>
            ) : null}
            <tr className="border-b border-neutral-200">
              <th className="sticky left-0 z-[1] bg-white px-3 py-1.5 text-left text-xs font-medium text-neutral-500">{supplier || "Мех / категория / длина"}</th>
              <th className={TH}>PCS, шт.</th><th className={TH}>AVG, шкур</th><th className={TH}>TTL, шкур</th>
              {stats ? ST_COLS.map((c) => <th key={c.name} className={TH}>{c.money ? (c.group === "Статистика" ? "NS AS" : "EUR") : "PCS"}</th>) : null}
            </tr>
          </thead>
          <tbody>
            {tree.map((root) => line(root))}
          </tbody>
        </table>
      </div>
      {fw27 ? <Fw27Compare data={fw27} rows={cur} onOpen={(crit, title) => setPhotoSel({ crit, title })} /> : null}
      {fw27 && photoSel ? <Fw27Dialog key={photoSel.title} canEdit={detail && canEdit} cats={[...new Set(cur.filter((r) => r.block === "RTW" && r.fur === photoSel.crit.fur).map((r) => r.cat))]} data={fw27} crit={photoSel.crit} title={photoSel.title} onClose={() => setPhotoSel(null)} /> : null}
      <p className="text-xs text-neutral-500">AVG — норма шкур на изделие из бюджета 2027 (при правке в «Детально» подменяется вручную). Продажи: NS AS, EUR без НДС; у аксессуаров «Другие бренды» — вся колонка Other из файла. Кнопки «Вместе / Одежда / Аксессуары» и «Скрыть пустые» (строки с нулевым бюджетом; итоги остаются полными) действуют и на Excel.</p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {note ? <div className="text-xs text-neutral-500">{note}</div> : null}
    </div>
  );
}
