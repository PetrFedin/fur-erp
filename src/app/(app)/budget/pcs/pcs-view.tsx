"use client";

import { useMemo, useState } from "react";
import { avgOf, buildPcsTree, ST_COLS, ST_LEN, stOf, sumRoots, type PcsBlock, type PcsNode, type PcsRow } from "@/lib/budget-pcs";
import { formatDec1, formatInt } from "@/lib/utils";
import { exportPcsXlsx, savePcsRows } from "./actions";

const TH = "whitespace-nowrap px-2 py-1.5 text-right text-xs font-medium text-neutral-500";
const TD = "whitespace-nowrap px-2 py-1.5 text-right text-sm tabular-nums";
// Цвета как в файле MVST, но с достаточным контрастом текста (AA).
const LEVEL: Record<number, string> = { 0: "bg-[#3F3F6F] text-white font-semibold", 1: "bg-[#5B5B96] text-white font-semibold", 2: "bg-[#D9D9F5] text-neutral-900 font-semibold", 3: "bg-[#D9D9F5] text-neutral-900 font-semibold", 4: "bg-white text-neutral-800" };
const parse = (s: string) => { const v = parseFloat(s.replace(",", ".").replace(/\s/g, "")); return Number.isFinite(v) && v >= 0 ? v : 0; };
const dateRu = (iso: string) => (iso ? iso.split("-").reverse().join(".") : "");
const cell = (v: number) => (v ? formatInt(Math.round(v)) : "–");
const FILTERS: { id: "all" | PcsBlock; label: string; blocks: PcsBlock[] }[] = [
  { id: "all", label: "Всё", blocks: ["RTW", "Acc"] }, { id: "RTW", label: "Одежда", blocks: ["RTW"] }, { id: "Acc", label: "Аксессуары", blocks: ["Acc"] },
];
// Группы колонок статистики для шапки: 2026 / 2025 / Статистика и подгруппы по две колонки.
const GROUPS = ST_COLS.reduce<{ g: string; n: number }[]>((a, c) => { const l = a[a.length - 1]; if (l && l.g === c.group) l.n++; else a.push({ g: c.group, n: 1 }); return a; }, []);

type Props = { id: string; name: string; season: string; supplier: string; asOf: { RTW: string; Acc: string }; rows: PcsRow[]; budget: { pcs: number; hides: number } | null; canEdit: boolean };

export function PcsView({ id, name, season, supplier, asOf, rows, budget, canEdit }: Props) {
  const [detail, setDetail] = useState(false);
  const [stats, setStats] = useState(true);
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
  const tree = useMemo(() => buildPcsTree(cur, blocks), [cur, blocks]);
  const total = useMemo(() => sumRoots(tree), [tree]);
  const totalAvg = total.hasAvg && total.pcsA > 0 ? total.ttl / total.pcsA : null;
  // Сводка по типам меха: сумма по выбранным блокам.
  const furs = useMemo(() => {
    const m = new Map<string, { pcs: number; pcsA: number; ttl: number; ttlB: number; hasAvg: boolean }>();
    for (const root of tree) for (const f of root.children) { const o = m.get(f.label) ?? { pcs: 0, pcsA: 0, ttl: 0, ttlB: 0, hasAvg: false }; o.pcs += f.pcs; o.pcsA += f.pcsA; o.ttl += f.ttl; o.ttlB += f.ttlB; o.hasAvg = o.hasAvg || f.hasAvg; m.set(f.label, o); }
    return [...m.entries()].map(([label, v]) => ({ label, ...v })).filter((f) => f.pcs > 0 || f.hasAvg).sort((a, b) => b.pcs - a.pcs);
  }, [tree]);

  const save = async () => {
    setBusy(true); setMsg("Сохраняю…");
    const r = await savePcsRows(id, cur.map((x) => ({ pcs: x.pcs, avg: x.avg, st: stOf(x) })));
    setBusy(false);
    if (r.ok) { setDirty(false); setMsg(`Сохранено ${new Date(r.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}`); } else setMsg(r.error);
  };
  const download = async () => {
    setBusy(true);
    try {
      if (dirty) { setMsg("Сначала сохраните изменения: Excel собирается из сохранённых данных"); return; }
      const r = await exportPcsXlsx(id, blocks);
      if (!r.ok) { setMsg(r.error); return; }
      const bin = atob(r.base64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = r.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setMsg("Не удалось сформировать Excel"); } finally { setBusy(false); }
  };

  const inp = (value: string, on: (v: string) => void, w: string, label: string, ph?: string) => (
    <input inputMode="decimal" aria-label={label} value={value} placeholder={ph} onChange={(e) => on(e.target.value)}
      className={`${w} min-h-9 rounded border border-neutral-300 bg-white px-1.5 text-right text-sm tabular-nums text-neutral-900 placeholder:italic placeholder:text-neutral-400`} />
  );
  const rowOf = (n: PcsNode, key: string, label: string, level: number): React.ReactNode => {
    const a = avgOf(n);
    const editable = detail && canEdit && n.leaf && n.rowIndex != null;
    const i = n.rowIndex ?? -1;
    const fromBudget = n.ttlB > 0 && n.ttlB >= n.ttl - 0.5; // весь AVG — норма бюджета (в файле пусто): курсивом
    const part = n.ttlB > 0 && !fromBudget;
    const avgTitle = fromBudget ? "Норма шкур из бюджета FW27 (в файле MVST не указана)" : part ? "Часть строк посчитана по норме бюджета" : undefined;
    return (
      <tr key={key} className={LEVEL[level]}>
        <td className={`sticky left-0 z-[1] bg-inherit px-3 py-1.5 text-sm`} style={{ paddingLeft: 12 + (level === 4 ? 3 : level) * 16 }}>{label}</td>
        <td className={TD}>{editable ? inp(vals[i].pcs, (v) => edit(i, "pcs", v), "w-16", "Штуки") : formatInt(n.pcs)}</td>
        <td className={TD}>{editable ? inp(vals[i].avg, (v) => edit(i, "avg", v), "w-16", "Шкур на изделие", n.leaf?.avgB != null ? String(Math.round(n.leaf.avgB * 10) / 10) : undefined)
          : a == null ? "" : <span className={fromBudget ? "italic" : undefined} title={avgTitle}>{formatDec1(a)}{part ? "*" : ""}</span>}</td>
        <td className={TD}>{n.hasAvg ? <span className={fromBudget ? "italic" : undefined} title={avgTitle}>{formatInt(Math.round(n.ttl))}</span> : ""}</td>
        {stats ? n.st.map((v, c) => <td key={c} className={`${TD} ${c % 2 === 0 && c > 0 ? "border-l border-white/30" : ""}`}>{editable ? inp(vals[i].st[c], (x) => editSt(i, c, x), ST_COLS[c].money ? "w-20" : "w-14", ST_COLS[c].name) : cell(v)}</td>) : null}
      </tr>
    );
  };
  const line = (n: PcsNode): React.ReactNode => (
    <>
      {rowOf(n, n.key, n.label, n.level)}
      {n.children.map((c) => line(c))}
    </>
  );
  const allNode = { pcs: total.pcs, ttl: total.ttl, ttlB: total.ttlB, hasAvg: total.hasAvg, pcsA: total.pcsA, st: total.st, children: [], key: "all", label: "", level: 0 } as PcsNode;

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
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Изделий, шт." value={formatInt(total.pcs)} />
        <Stat label="Шкур всего" value={total.hasAvg ? formatInt(Math.round(total.ttl)) : "–"} note={total.ttlB > 0 ? `из них по норме бюджета ${formatInt(Math.round(total.ttlB))}` : undefined} />
        <Stat label="Шкур на изделие, средневзв." value={totalAvg == null ? "–" : formatDec1(totalAvg)} />
        <Stat label="В бюджете FW27" value={budget ? `${formatInt(budget.pcs)} шт.` : "–"} note={budget ? `${formatInt(budget.hides)} шкур · ${budget.pcs ? formatDec1(budget.hides / budget.pcs) : "–"} на изделие` : undefined} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-neutral-200"><th className="px-3 py-1.5 text-left text-xs font-medium text-neutral-500">По типам меха</th><th className={TH}>Шт.</th><th className={TH}>Доля</th><th className={TH}>Шкур на изд.</th><th className={TH}>Шкур всего</th></tr>
          </thead>
          <tbody>
            {furs.map((f) => (
              <tr key={f.label} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-1.5 text-sm">{f.label}</td>
                <td className={TD}>{formatInt(f.pcs)}</td>
                <td className={TD}>{total.pcs ? `${formatDec1((f.pcs / total.pcs) * 100)} %` : "–"}</td>
                <td className={TD}>{f.hasAvg && f.pcsA > 0 ? <span className={f.ttlB >= f.ttl - 0.5 ? "italic" : undefined}>{formatDec1(f.ttl / f.pcsA)}</span> : ""}</td>
                <td className={TD}>{f.hasAvg ? formatInt(Math.round(f.ttl)) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[480px]">
          <thead>
            {stats ? (
              <tr className="border-b border-neutral-100">
                <th className="sticky left-0 z-[1] bg-white" />
                <th colSpan={3} className="px-2 py-1 text-center text-xs font-semibold text-neutral-700">{season || "Бюджет"}</th>
                {GROUPS.map((g) => <th key={g.g + g.n} colSpan={g.n} className="border-l border-neutral-200 px-2 py-1 text-center text-xs font-semibold text-neutral-700">{g.g}</th>)}
              </tr>
            ) : null}
            {stats ? (
              <tr className="border-b border-neutral-100">
                <th className="sticky left-0 z-[1] bg-white" /><th colSpan={3} />
                {Array.from({ length: ST_LEN / 2 }, (_, j) => <th key={j} colSpan={2} className="border-l border-neutral-200 px-2 py-1 text-center text-xs font-medium text-neutral-500">{ST_COLS[j * 2].sub}</th>)}
              </tr>
            ) : null}
            <tr className="border-b border-neutral-200">
              <th className="sticky left-0 z-[1] bg-white px-3 py-1.5 text-left text-xs font-medium text-neutral-500">{supplier || "Мех / категория / длина"}</th>
              <th className={TH}>PCS, шт.</th><th className={TH}>AVG, шкур</th><th className={TH}>TTL, шкур</th>
              {stats ? ST_COLS.map((c) => <th key={c.name} className={TH}>{c.money ? (c.group === "Статистика" ? "NS AS" : "EUR") : "PCS"}</th>) : null}
            </tr>
          </thead>
          <tbody>
            {filter === "all" && tree.length > 1 ? rowOf(allNode, "all", "TOTAL — одежда + аксессуары", 0) : null}
            {tree.map((root) => line(root))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">Курсивом — норма шкур из бюджета FW27 (в файле MVST AVG не указан), «*» — часть строк по норме бюджета. EUR без НДС. Кнопки «Всё / Одежда / Аксессуары» задают и состав Excel.</p>
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
