"use client";

// «Приход по месяцам» — вкладка отчёта «Заказ и продажи по сезонам» (04.11.2026, по просьбе владельца).
// По каждому сезону: фактический приход по месяцам из файла поступлений (структура категория 1 → мех → категория 2 → артикул).
// FW 26/27 дополнительно: заказ и поступило по отчёту + прогноз ноябрь/декабрь: в ноябре ждём то, что заведено в ТЗ,
// но ещё не пришло; остаток заказа без ТЗ делим пополам между ноябрём и декабрём (пропорция ТЗ-доли общая на сезон,
// на строки разносится пропорционально их «ждём» — оценка, не обещание поставки).
// Прогноз можно править руками (ноябрь, декабрь и по желанию январь 27): правка хранится в базе (forecast-actions.ts) и заменяет расчёт в своей ячейке;
// правка в строке-группе делит новое число между артикулами пропорционально их текущему прогнозу.
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { InfoHint } from "@/components/info-hint";
import type { ReportSizeRow } from "@/lib/margin-tree";
import type { SLine } from "@/lib/sales-section";
import { furRuLabel, furTypeOfFabric } from "@/lib/sales-receipts-core";
import { btn, DASH, n0, seg, segGroup } from "./sales-fmt";
import { loadFw26Forecast, saveFw26Forecast } from "./forecast-actions";
import { FC_MONTHS, baseForecast, netMonths, splitInt, tzPartsByModel, type Overrides } from "@/lib/fw26-plan";

const SEASONS = ["FW26/27", "SS26", "FW25/26"] as const;
type Season = (typeof SEASONS)[number];
const SEASON_LABEL: Record<Season, string> = { "FW26/27": "FW 26/27", SS26: "SS 2026", "FW25/26": "FW 25/26" };
const SEASON_BG: Record<Season, string> = { "FW26/27": "bg-sky-50/60", SS26: "bg-amber-50/60", "FW25/26": "bg-emerald-50/50" };
/** Сезон строки прихода (файл) → ключ отчёта. */
const SALES_TO_REPORT: Record<string, Season> = { "FW 25/26": "FW25/26", "SS 2026": "SS26", "FW 26/27": "FW26/27" };
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Свакара", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };
const furRu = (k: string) => furRuLabel(k, FUR_RU);
const MONTH_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthLabel = (k: string) => `${MONTH_RU[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;

/** Артикул в файле и в отчёте пишется по-разному («MH-03 SABLE…» и «MH-03/SABLE…»): сравнение без знаков и пробелов. */
const key = (a: string) => a.toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");

type RNode = { id: string; label: string; conf: number; deliv: number; months: Map<string, number>; /** Прогноз по месяцам (FW 26/27): расчёт или правка. */ fc: Map<string, number>; leafKey?: string; /** Ждём по отчёту (вес при делении правки группы). */ aw?: number; children: RNode[] };
/** Минус в месяце прихода: в файле поступлений это корректировка уже полученного (строка со знаком «−»); итог по артикулу и цвету при этом не уходит ниже нуля. */
const NEG_TIP = "Корректировка прихода: в этом месяце минусовых строк файла поступлений больше, чем прихода. Раньше по этому артикулу и цвету приход был.";
const leavesOf = (n: RNode): RNode[] => (n.children.length ? n.children.flatMap(leavesOf) : n.leafKey ? [n] : []);

/** Число прогноза: правится на месте (Enter или уход курсора — сохранить, Esc — отмена). */
function EditNum({ value, label, onCommit }: { value: number; label: string; onCommit: (raw: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancel = useRef(false);
  return (
    <input type="text" inputMode="numeric" aria-label={label} value={draft ?? (value ? String(value) : "")} placeholder="0"
      onFocus={(e) => e.currentTarget.select()} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (!cancel.current && draft !== null && (Number(draft.replace(",", ".")) || 0) !== value) onCommit(draft); cancel.current = false; setDraft(null); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); } }}
      className="min-h-11 w-16 rounded-md border border-sky-300 bg-white px-1 text-right tabular-nums text-sm placeholder:text-neutral-400" />
  );
}

/** «Ждём по ТЗ» модели: model — код модели через normCode, qty — объём ТЗ минус получено. */
export type TzAwait = { fur: string; cls: string; qty: number; model: string };

export function SeasonReceipts({ sizes, lines, tzAwait }: { sizes: ReportSizeRow[]; lines: SLine[]; tzAwait: TzAwait[] }) {
  const [season, setSeason] = useState<Season>("FW26/27");
  const [over, setOver] = useState<Overrides>({});
  const [janOn, setJanOn] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [pending, startSave] = useTransition();
  const loaded = useRef(false);
  useEffect(() => {
    let alive = true;
    loadFw26Forecast().then((f) => { if (!alive) return; setOver(f.cells); setJanOn(f.janOn); setCanEdit(f.canEdit); loaded.current = true; }).catch(() => { loaded.current = true; });
    return () => { alive = false; };
  }, []);
  const persist = (cells: Overrides, jan: boolean) => { setSaveErr(null); startSave(async () => { const r = await saveFw26Forecast({ cells, janOn: jan }); if (!r.ok) setSaveErr(r.error); }); };
  const [open, setOpen] = useState<Set<string>>(new Set());
  /** Сортировка по клику на подпись столбца: порядок строк на каждом уровне (категория → мех → категория 2 → артикул). Повторный клик меняет направление, третий снимает. */
  const [colSort, setColSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const clickSort = (key: string) => setColSort((c) => (c?.key === key ? (c.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));

  /** Приход по месяцам: артикул+цвет (нормализованные) → сезон отчёта → месяц → шт. */
  const byArt = useMemo(() => {
    const m = new Map<string, Map<Season, Map<string, number>>>();
    for (const l of lines) {
      if (l.kind !== "RECEIPT" || !l.pcs) continue;
      const s = SALES_TO_REPORT[l.season]; if (!s) continue;
      const k = `${key(l.article)}|${(l.colorId ?? "").toUpperCase()}`, mk = l.iso.slice(0, 7);
      const a = m.get(k) ?? new Map(); m.set(k, a);
      const sm = a.get(s) ?? new Map(); a.set(s, sm);
      sm.set(mk, (sm.get(mk) ?? 0) + l.pcs);
    }
    return m;
  }, [lines]);

  /** «Ждём по ТЗ» по моделям: сколько из «ждём» каждой модели уже заведено в наши ТЗ (придёт в ноябре). */
  const tzByModel = useMemo(() => { const m = new Map<string, number>(); for (const t of tzAwait) m.set(t.model, (m.get(t.model) ?? 0) + t.qty); return m; }, [tzAwait]);

  const buildSeason = (s: Season): { months: string[]; roots: RNode[]; total: RNode } => {
    // Листья — по артикулу+цвету: заказ и поступило из отчёта (по строкам размеров суммируем один раз),
    // месяцы прихода из файла поступлений (тоже один раз на артикул). «Пришло» в таблице = факт файла поступлений.
    type Leaf = { conf: number; mm: Map<string, number> | undefined; l1: string; fur: string; l2: string; label: string; model: string };
    const leaves = new Map<string, Leaf>();
    if (s === "FW26/27") {
      for (const r of sizes.filter((r) => r.seas?.[s])) {
        const c = r.seas?.[s] ?? {};
        const k = `${key(r.acode)}|${(r.color ?? "").toUpperCase()}`;
        const leaf = leaves.get(k) ?? { conf: 0, mm: byArt.get(k)?.get(s), l1: (r.l3 || "(без категории)").trim(), fur: furRu(r.fur ?? "Не указан"), l2: (r.l4 || r.l5 || "(без категории)").trim(), label: r.color ? `${r.acode} · ${r.color}` : r.acode, model: r.modelCode ?? "" };
        leaf.conf += c.conf ?? 0;
        leaves.set(k, leaf);
      }
    } else {
      for (const l of lines) {
        if (l.kind !== "RECEIPT" || !l.pcs || SALES_TO_REPORT[l.season] !== s) continue;
        const k = `${key(l.article)}|${(l.colorId ?? "").toUpperCase()}`, mk = l.iso.slice(0, 7);
        const leaf = leaves.get(k) ?? { conf: 0, mm: new Map<string, number>(), l1: (l.level3 || "(без категории)").trim(), fur: furRu(furTypeOfFabric(l.fabric)), l2: (l.level4 || "(без категории)").trim(), label: l.colorId ? `${l.article} · ${l.colorId}` : l.article, model: "" };
        leaf.mm!.set(mk, (leaf.mm!.get(mk) ?? 0) + l.pcs);
        leaves.set(k, leaf);
      }
    }
    for (const l of leaves.values()) if (l.mm) l.mm = netMonths(l.mm);
    const months = [...new Set([...leaves.values()].flatMap((l) => [...(l.mm?.keys() ?? [])]))].sort();
    const roots: RNode[] = [];
    const node = (id: string, label: string): RNode => ({ id, label, conf: 0, deliv: 0, months: new Map(), fc: new Map(), children: [] });
    const cat1s = new Map<string, RNode>();
    const total = node("total", "Всего");
    // «Ждём по ТЗ» модели делится между её артикулами-цветами по «ждём»: это уйдёт в ноябрь, остаток заказа без ТЗ — пополам на ноябрь и декабрь.
    const tzPartOf = new Map<string, number>();
    if (s === "FW26/27") {
      const arr = [...leaves].map(([k, l]) => ({ k, model: l.model, aw: Math.max(0, l.conf - [...(l.mm?.values() ?? [])].reduce((a, x) => a + x, 0)) }));
      tzPartsByModel(arr, tzByModel).forEach((v, i) => tzPartOf.set(arr[i].k, v));
    }
    for (const [k, l] of leaves) {
      const deliv = [...(l.mm?.values() ?? [])].reduce((a, x) => a + x, 0);
      if (!l.conf && !deliv) continue;
      let n1 = cat1s.get(l.l1); if (!n1) { n1 = node(`c1:${l.l1}`, l.l1); cat1s.set(l.l1, n1); roots.push(n1); }
      let n2 = n1.children.find((x) => x.label === l.fur); if (!n2) { n2 = node(`${n1.id}/f:${l.fur}`, l.fur); n1.children.push(n2); }
      let n3 = n2.children.find((x) => x.label === l.l2); if (!n3) { n3 = node(`${n2.id}/c2:${l.l2}`, l.l2); n2.children.push(n3); }
      const leaf = node(`${n3.id}/a:${k}`, l.label);
      const aw = s === "FW26/27" ? Math.max(0, l.conf - deliv) : 0;
      const { nov, dec } = baseForecast(aw, tzPartOf.get(k) ?? 0);
      leaf.conf = l.conf; leaf.deliv = deliv; leaf.leafKey = k; leaf.aw = aw;
      // Расчёт (ноябрь/декабрь по правилу, январь 0) или правка владельца по этой ячейке.
      const base: Record<string, number> = { "2026-11": nov, "2026-12": dec, "2027-01": 0 };
      if (s === "FW26/27") for (const fm of FC_MONTHS) leaf.fc.set(fm, over[k]?.[fm] ?? base[fm]);
      if (l.mm) for (const [mk, pcs] of l.mm) leaf.months.set(mk, pcs);
      n3.children.push(leaf);
      for (const n of [n3, n2, n1, total]) {
        n.conf += leaf.conf; n.deliv += deliv;
        for (const [fm, v] of leaf.fc) n.fc.set(fm, (n.fc.get(fm) ?? 0) + v);
        if (l.mm) for (const [mk, pcs] of l.mm) n.months.set(mk, (n.months.get(mk) ?? 0) + pcs);
      }
    }
    const sortRec = (ns: RNode[]) => { ns.sort((a, b) => b.deliv - a.deliv || b.conf - a.conf || a.label.localeCompare(b.label)); for (const n of ns) sortRec(n.children); };
    sortRec(roots);
    return { months, roots, total };
  };

  /** Корректировки прихода с минусом по сезонам (уже вычтены из месяцев). */
  const negBySeason = useMemo(() => {
    const out = Object.fromEntries(SEASONS.map((x) => [x, { n: 0, sum: 0 }])) as Record<Season, { n: number; sum: number }>;
    for (const l of lines) { const x = SALES_TO_REPORT[l.season]; if (l.kind === "RECEIPT" && l.pcs < 0 && x) { out[x].n += 1; out[x].sum += l.pcs; } }
    return out;
  }, [lines]);
  const bySeason = useMemo(() => Object.fromEntries(SEASONS.map((s) => [s, buildSeason(s)])) as Record<Season, ReturnType<typeof buildSeason>>, [sizes, byArt, tzByModel, over]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Правка прогноза: в строке артикула — напрямую, в группе — делится между артикулами пропорционально их текущему прогнозу (резерв — «ждём»). */
  const editCell = (n: RNode, mk: string, raw: string) => {
    const target = Math.max(0, Math.round(Number(raw.replace(",", ".")) || 0));
    const lv = leavesOf(n);
    if (!lv.length) return;
    const cur = lv.map((l) => l.fc.get(mk) ?? 0);
    const vals = lv.length === 1 ? [target] : splitInt(target, cur.some((x) => x > 0) ? cur : lv.map((l) => l.aw ?? 0));
    const next: Overrides = { ...over };
    lv.forEach((l, i) => { next[l.leafKey!] = { ...(next[l.leafKey!] ?? {}), [mk]: vals[i] }; });
    setOver(next);
    persist(next, janOn);
  };
  const fcMonths = FC_MONTHS.filter((m) => m !== "2027-01" || janOn);
  const flip = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const idsOf = (s: Season) => { const ids: string[] = []; const walk = (n: RNode) => { if (n.children.length) { ids.push(n.id); n.children.forEach(walk); } }; bySeason[s].roots.forEach(walk); return ids; };
  /** Если всё уже раскрыто — кнопка сворачивает; иначе раскрывает все уровни. */
  const toggleAll = (s: Season) => { const ids = idsOf(s); setOpen((o) => (ids.length > 0 && ids.every((id) => o.has(id)) ? new Set([...o].filter((id) => !ids.includes(id))) : new Set([...o, ...ids]))); };
  const allOpen = (s: Season) => { const ids = idsOf(s); return ids.length > 0 && ids.every((id) => open.has(id)); };

  const valOf = (n: RNode, key: string): number | string => (key === "label" ? n.label : key === "conf" ? n.conf : key === "deliv" ? n.deliv : key.startsWith("f:") ? n.fc.get(key.slice(2)) ?? 0 : n.months.get(key) ?? 0);
  const sortKids = (ns: RNode[]): RNode[] => {
    if (!colSort) return ns;
    const sign = colSort.dir === "desc" ? -1 : 1;
    return [...ns].sort((a, b) => { const x = valOf(a, colSort.key), y = valOf(b, colSort.key); return sign * (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru", { numeric: true })) || a.label.localeCompare(b.label, "ru"); });
  };
  const sortMark = (key: string) => (colSort?.key === key ? (colSort.dir === "asc" ? " ▲" : " ▼") : "");
  const thBtn = (key: string, label: React.ReactNode, aria: string) => <button type="button" onClick={() => clickSort(key)} aria-label={`Сортировать по: ${aria}`} className="inline-flex min-h-11 items-center gap-0.5 whitespace-nowrap hover:underline">{label}<span aria-hidden className="inline-block w-3 text-[11px] text-[color:var(--ui-accent)]">{sortMark(key).trim()}</span></button>;
  const renderRow = (n: RNode, s: Season, depth: number, months: string[]): React.ReactNode => {
    const isOpen = open.has(n.id), can = n.children.length > 0;
    return (
      <Fragment key={n.id}>
        <tr className="border-t border-neutral-200 hover:bg-neutral-50">
          <td className="sticky left-0 z-[5] bg-white px-2 py-1.5" style={{ paddingLeft: 8 + depth * 14 }}>
            <div className="flex items-center gap-2">
              {can ? <button type="button" onClick={() => flip(n.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${n.label}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-300 text-base hover:bg-neutral-100">{isOpen ? "−" : "+"}</button> : <span className="inline-block size-11 shrink-0" />}
              <span className={"truncate " + (depth <= 1 ? "font-semibold" : "")} title={n.label}>{n.label}</span>
            </div>
          </td>
          {s === "FW26/27" ? <td className="border-l border-neutral-300 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{n0(n.conf)}</td> : null}
          <td className={`${s === "FW26/27" ? "" : "border-l border-neutral-300"} px-2 py-1.5 text-right tabular-nums whitespace-nowrap`}>{n0(n.deliv)}</td>
          {months.map((mk) => <td key={mk} title={(n.months.get(mk) ?? 0) < 0 ? NEG_TIP : undefined} className={"px-2 py-1.5 text-right tabular-nums whitespace-nowrap " + ((n.months.get(mk) ?? 0) < 0 ? "text-amber-700" : "")}>{n.months.get(mk) ? n0(n.months.get(mk)!) : DASH}</td>)}
          {s === "FW26/27" ? fcMonths.map((fm, i) => (
            <td key={fm} className={(i === 0 ? "border-l border-neutral-300 " : "") + "bg-sky-100/60 px-2 py-1 text-right tabular-nums whitespace-nowrap"}>
              {canEdit ? <EditNum value={n.fc.get(fm) ?? 0} label={`Прогноз ${monthLabel(fm)}: ${n.label}`} onCommit={(raw) => editCell(n, fm, raw)} /> : (n.fc.get(fm) ? n0(n.fc.get(fm)!) : DASH)}
            </td>
          )) : null}
        </tr>
        {isOpen ? sortKids(n.children).map((c) => renderRow(c, s, depth + 1, months)) : null}
      </Fragment>
    );
  };

  const table = (s: Season) => {
    const { months, roots, total } = bySeason[s];
    return (
      <div key={s} className="overflow-x-auto rounded-lg border border-neutral-300 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="sticky left-0 z-10 bg-neutral-50 px-2 py-0 text-left text-xs font-semibold">{thBtn("label", "Категория 1 → мех → категория 2 → артикул", "названию")}</th>
              {s === "FW26/27" ? <th className={`px-2 py-0 text-right text-xs font-semibold ${SEASON_BG[s]}`}>{thBtn("conf", "Заказано", "заказано")}</th> : null}
              <th className={`px-2 py-0 text-right text-xs font-semibold ${SEASON_BG[s]}`}>{thBtn("deliv", "Получено", "получено")}</th>
              {months.map((mk) => <th key={mk} className="px-2 py-0 text-right text-xs font-semibold whitespace-nowrap">{thBtn(mk, monthLabel(mk), monthLabel(mk))}</th>)}
              {s === "FW26/27" ? fcMonths.map((fm) => <th key={fm} className="bg-sky-100/60 px-2 py-0 text-right text-xs font-semibold whitespace-nowrap" title="Прогноз: можно править">{thBtn("f:" + fm, <>{monthLabel(fm)}*</>, "прогноз " + monthLabel(fm))}</th>) : null}
            </tr>
          </thead>
          <tbody>{sortKids(roots).map((n) => renderRow(n, s, 0, months))}</tbody>
          <tfoot className="bg-neutral-100">
            <tr className="border-t-2 border-neutral-400 font-semibold">
              <td className="sticky left-0 bg-neutral-100 px-2 py-2">Всего</td>
              {s === "FW26/27" ? <td className="px-2 py-2 text-right tabular-nums">{n0(total.conf)}</td> : null}
              <td className="px-2 py-2 text-right tabular-nums">{n0(total.deliv)}</td>
              {months.map((mk) => <td key={mk} title={(total.months.get(mk) ?? 0) < 0 ? NEG_TIP : undefined} className={"px-2 py-2 text-right tabular-nums " + ((total.months.get(mk) ?? 0) < 0 ? "text-amber-700" : "")}>{total.months.get(mk) ? n0(total.months.get(mk)!) : DASH}</td>)}
              {s === "FW26/27" ? fcMonths.map((fm) => <td key={fm} className="bg-sky-100/60 px-2 py-2 text-right tabular-nums">{n0(total.fc.get(fm) ?? 0)}</td>) : null}
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Сезон" className={segGroup}>
          {SEASONS.map((s) => <button key={s} type="button" aria-pressed={season === s} onClick={() => setSeason(s)} className={seg(season === s)}>{SEASON_LABEL[s]}</button>)}
        </div>
        <button type="button" onClick={() => toggleAll(season)} className={btn}>{allOpen(season) ? "Свернуть всё" : "Развернуть всё"}</button>
        <a href="/sales/fw26-plan" download className={btn} title="Excel: категория 1 → тип меха → категория 2 → артикул → цвет → размер; заказано, пришло, приход по месяцам, остаток в производстве и план на ноябрь, декабрь">Скачать Excel</a>
        {season === "FW26/27" ? (
          <>
            <button type="button" aria-pressed={janOn} onClick={() => { const v = !janOn; setJanOn(v); persist(over, v); }} disabled={!canEdit} title={canEdit ? "Показать или скрыть колонку прогноза на январь 2027" : "Править прогноз могут владелец, администратор и технолог"} className={btn + " disabled:opacity-60"}>{janOn ? "Скрыть янв 27" : "+ янв 27"}</button>
            {canEdit && Object.keys(over).length > 0 ? <button type="button" onClick={() => { setOver({}); persist({}, janOn); }} className={btn}>Сбросить правки</button> : null}
            {pending ? <span className="text-xs text-neutral-600">Сохраняю…</span> : saveErr ? <span role="alert" className="text-xs text-red-700">{saveErr}</span> : null}
          </>
        ) : null}
        <InfoHint label="Прогноз прихода FW 26/27" wide>
          <p>По FW26 расчёт такой: «ноя 26*» = ждём по заведённым ТЗ (пришло по ним ещё ничего) плюс половина остатка заказа без ТЗ; «дек 26*» — вторая половина. Это оценка для планирования, не обещание поставщика.</p><p className="mt-1">Числа в голубых колонках можно править: Enter или переход в другую ячейку сохраняет, Esc отменяет. Число в строке группы делится между её артикулами пропорционально их текущему прогнозу. «+ янв 27» добавляет колонку января 2027. «Сбросить правки» возвращает расчёт.</p>
          <p className="mt-1">«Заказано» по FW 26/27 — из отчёта «заказ и продажи», «Получено» и месяцы — фактический приход из файла поступлений (по датам поставки).</p>
        </InfoHint>
      </div>
      {[season].map((s) => (
        <Fragment key={s}>
          <h3 className="mt-1 text-sm font-semibold">{SEASON_LABEL[s]}{s === "FW26/27" ? " — заказ, приход и прогноз" : " — приход по месяцам"}</h3>
          {s === "FW26/27" ? <FcCheck roots={bySeason[s].roots} fcMonths={fcMonths} total={bySeason[s].total} /> : null}
          {negBySeason[s].n > 0 ? <p className="text-xs text-neutral-700">В файле поступлений есть корректировки прихода с минусом: {negBySeason[s].sum} шт. ({negBySeason[s].n} строк). Они зачтены в ближайшие предыдущие месяцы прихода того же артикула и цвета, поэтому в таблице минусов нет; итоги по артикулам не изменились.</p> : null}
          {table(s)}
        </Fragment>
      ))}
    </div>
  );
}

/** Контроль прогноза FW 26/27: сколько «ждём» по отчёту и сколько распределено по месяцам (с учётом правок). */
function FcCheck({ roots, fcMonths, total }: { roots: RNode[]; fcMonths: readonly string[]; total: RNode }) {
  const aw = roots.flatMap(leavesOf).reduce((a, l) => a + (l.aw ?? 0), 0);
  const plan = fcMonths.reduce((a, m) => a + (total.fc.get(m) ?? 0), 0);
  const diff = plan - aw;
  return (
    <p className="text-xs text-neutral-700">
      Ждём по заказу {n0(aw)} шт. · в прогнозе по месяцам {n0(plan)} шт.{" "}
      {diff === 0 ? <span className="text-emerald-700">· сходится</span> : <span className="text-amber-700">· {diff > 0 ? "больше" : "меньше"} на {n0(Math.abs(diff))} шт. (правка не обязана совпадать с заказом)</span>}
    </p>
  );
}
