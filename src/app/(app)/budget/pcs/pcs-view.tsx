"use client";

import { useMemo, useState } from "react";
import { avgOf, buildPcsTree, type PcsNode, type PcsRow } from "@/lib/budget-pcs";
import { formatDec1, formatInt } from "@/lib/utils";
import { exportPcsXlsx, savePcsRows } from "./actions";

const TH = "whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-neutral-500";
const TD = "whitespace-nowrap px-3 py-1.5 text-right text-sm tabular-nums";
// Цвета как в файле MVST, но с достаточным контрастом текста (AA).
const LEVEL: Record<number, string> = { 0: "bg-[#3F3F6F] text-white font-semibold", 1: "bg-[#5B5B96] text-white font-semibold", 2: "bg-[#D9D9F5] text-neutral-900 font-semibold", 3: "bg-[#D9D9F5] text-neutral-900 font-semibold", 4: "bg-white text-neutral-800" };
const parse = (s: string) => { const v = parseFloat(s.replace(",", ".").replace(/\s/g, "")); return Number.isFinite(v) && v >= 0 ? v : 0; };
const dateRu = (iso: string) => (iso ? iso.split("-").reverse().join(".") : "");

type Props = { id: string; name: string; season: string; supplier: string; asOf: { RTW: string; Acc: string }; rows: PcsRow[]; canEdit: boolean };

export function PcsView({ id, name, season, supplier, asOf, rows, canEdit }: Props) {
  const [detail, setDetail] = useState(false);
  const shown = (r: PcsRow) => ({ pcs: String(r.pcs), avg: r.avg == null ? "" : String(Math.round(r.avg * 100) / 100) });
  const [vals, setVals] = useState(() => rows.map(shown));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = (i: number, k: "pcs" | "avg", v: string) => { setDirty(true); setVals((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x))); };
  // Не тронутое поле остаётся с исходной точностью (на экране AVG округлён до сотых).
  const cur: PcsRow[] = useMemo(() => rows.map((r, i) => ({ ...r, pcs: vals[i].pcs === shown(r).pcs ? r.pcs : parse(vals[i].pcs), avg: vals[i].avg === shown(r).avg ? r.avg : vals[i].avg.trim() === "" ? null : parse(vals[i].avg) })), [rows, vals]);
  const tree = useMemo(() => buildPcsTree(cur), [cur]);

  const save = async () => {
    setBusy(true); setMsg("Сохраняю…");
    const r = await savePcsRows(id, cur.map((x) => ({ pcs: x.pcs, avg: x.avg })));
    setBusy(false);
    if (r.ok) { setDirty(false); setMsg(`Сохранено ${new Date(r.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}`); } else setMsg(r.error);
  };
  const download = async () => {
    setBusy(true);
    try {
      const r = await exportPcsXlsx(id);
      if (!r.ok) { setMsg(r.error); return; }
      const bin = atob(r.base64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = r.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setMsg("Не удалось сформировать Excel"); } finally { setBusy(false); }
  };

  const inp = (i: number, k: "pcs" | "avg", w: string) => (
    <input inputMode="decimal" aria-label={k === "pcs" ? "Штуки" : "Шкур на изделие"} value={vals[i][k]} onChange={(e) => edit(i, k, e.target.value)}
      className={`${w} min-h-9 rounded border border-neutral-300 bg-white px-1.5 text-right text-sm tabular-nums text-neutral-900`} />
  );
  const line = (n: PcsNode): React.ReactNode => {
    const a = avgOf(n);
    const editable = detail && canEdit && n.leaf && n.rowIndex != null;
    const i = n.rowIndex ?? -1;
    return (
      <>
        <tr key={n.key} className={LEVEL[n.level]}>
          <td className="px-3 py-1.5 text-sm" style={{ paddingLeft: 12 + (n.level === 4 ? 3 : n.level) * 16 }}>{n.label}</td>
          <td className={TD}>{editable ? inp(i, "pcs", "w-20") : formatInt(n.pcs)}</td>
          <td className={TD}>{editable ? inp(i, "avg", "w-20") : a == null ? "" : n.leaf?.avgText && !detail ? <span title={`в файле: ${n.leaf.avgText}`}>{formatDec1(a)}</span> : formatDec1(a)}</td>
          <td className={TD}>{n.hasAvg ? formatInt(Math.round(n.ttl)) : ""}</td>
        </tr>
        {n.children.map((c) => line(c))}
      </>
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
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-neutral-200"><th className="px-3 py-2 text-left text-xs font-medium text-neutral-500">{supplier || "Мех / категория / длина"}</th><th className={TH}>PCS, шт.</th><th className={TH}>AVG, шкур на изд.</th><th className={TH}>TTL, шкур</th></tr>
          </thead>
          <tbody>{tree.map((root) => line(root))}</tbody>
        </table>
      </div>
    </div>
  );
}
