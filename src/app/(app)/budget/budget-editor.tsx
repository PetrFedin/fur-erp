"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { formatPercent } from "@/lib/utils";
import { WidgetRow } from "@/components/widget-row";
import { InfoHint } from "@/components/info-hint";
import { TileCarousel } from "@/components/tile-carousel";
import { TotalLabel } from "@/components/total-label";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../dashboard/tile";
import {
  autoCalc, blankNode, childrenMap, computeTree, defaultLines, effLocked, effUp, grandTotal, normKey, perUnit, reapplyParams, srcInfo, varPct,
  type Agg, type BudgetNode, type BudgetParams, type BudgetStat, type EffUp,
} from "@/lib/budget-calc";
import { exportBudgetXlsx, parseBudgetFile, refreshBudgetStats, renameBudget, saveBudget, type ImportRow } from "./actions";
import { AddDialog, type AddKind, type ArticleOpt } from "./add-dialog";
import { BTN, BTN_PRIMARY, Badge, FIELD, Modal, NumInput, SEG_BOX, dateRu, money, pct, qty, segBtn, share } from "./ui";

type Props = {
  id: string; name: string; season: string; status: "DRAFT" | "APPROVED"; initialComment: string; initialParams: BudgetParams; initialNodes: BudgetNode[];
  initialStats: BudgetStat[]; furNames: string[]; catNames: string[]; articles: ArticleOpt[]; canEdit: boolean; savedAt: string; savedBy: string | null; createdAt: string;
};

/** Мелкая подпись под суммой: средняя цена шкуры / метра подкладки / работы на изделие. */
function Avg({ sum, per, unit, d = 0 }: { sum: number; per: number; unit: string; d?: number }) {
  if (!(per > 0) || !(sum > 0)) return null;
  return <div className="mt-0.5 text-[10px] font-normal leading-tight text-neutral-500">ср. {(sum / per).toLocaleString("ru-RU", { maximumFractionDigits: d })} {unit}</div>;
}

/** Var мелким цветным текстом под «На 1 изделие»: красный — выше текущих цен на 15%+, жёлтый — на 5%+, зелёный — ниже на 5%+. */
/** Мелкий процент под количеством изделий: доля от всего объёма заказа (бюджета). */
function PcsShare({ pcs, all }: { pcs: number; all: number }) {
  if (!(all > 0) || !(pcs > 0)) return null;
  const v = (pcs / all) * 100;
  return <div className="mt-0.5 text-right text-[10px] font-normal leading-tight text-neutral-500">{formatPercent(v)} заказа</div>;
}

function VarTag({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return null;
  const tone = v >= 15 ? "text-red-700" : v >= 5 ? "text-amber-700" : v <= -5 ? "text-emerald-700" : "text-neutral-500";
  return <div className={"mt-0.5 text-[10px] font-medium leading-tight " + tone}>Var {formatPercent(v, { sign: true })}</div>;
}

const ZERO: Agg = { pcs: 0, hides: 0, mex: 0, meters: 0, lining: 0, work: 0, c4: 0, total: 0, nowTotal: 0, nowPcs: 0, cmpTotal: 0 };
type NumKey = "pcs" | "hides" | "hidePrice" | "meters" | "meterPrice" | "work";
type UpKey = "upFur" | "upLining" | "upWork";
const KIND_LABEL = { fur: "тип сырья", cat: "категория", art: "артикул" } as const;
const ICON_BTN = "btn-accent inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-neutral-200 bg-white px-1.5 text-sm text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-40 md:h-8 md:min-w-8";
const DOT = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", manual: "bg-neutral-400" } as const;

/** Короткая подпись колонки + «i»-подсказка (title). */
function Th({ children, tip, className = "" }: { children: ReactNode; tip: string; className?: string }) {
  return (
    <th scope="col" className={"whitespace-nowrap px-2 pb-1.5 pt-1 text-right text-[11px] font-medium text-neutral-500 " + className}>
      {children} <span title={tip} aria-label={tip} className="ml-0.5 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-neutral-300 align-middle text-[9px] font-normal leading-none text-neutral-400">i</span>
    </th>
  );
}

const sepL = "border-l border-neutral-200";
/** В таблицах нулевые значения — «—». */
const mz = (v: number | null | undefined) => (v ? money(v) : "—");
const qz = (v: number | null | undefined, d = 0) => (v ? qty(v, d) : "—");

export function BudgetEditor(p: Props) {
  const router = useRouter();
  const [params, setParams] = useState(p.initialParams);
  const [nodes, setNodes] = useState(p.initialNodes);
  const [comment, setComment] = useState(p.initialComment);
  const [stats, setStats] = useState(p.initialStats);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const status = p.status;
  const [view, setView] = useState<"summary" | "detail">("summary");
  const [renaming, setRenaming] = useState(false);
  const [updatedAtState, setUpdatedAtState] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ kind: AddKind; parentId: string | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [statFor, setStatFor] = useState<string | null>(null);
  const [upFor, setUpFor] = useState<string | null>(null);
  const [upAll, setUpAll] = useState(false);
  const [preview, setPreview] = useState<{ rows: ImportRow[]; warnings: string[]; sheet: string; fileName: string } | null>(null);
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = p.canEdit && status === "DRAFT";

  // Автосохранение: через секунду после последнего изменения; без изменений относительно сохранённого ничего не отправляется.
  const lastSaved = useRef(JSON.stringify([p.initialParams, p.initialNodes, p.initialComment]));
  useEffect(() => {
    if (!canEdit) return;
    const cur = JSON.stringify([params, nodes, comment]);
    if (cur === lastSaved.current) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      saveBudget(p.id, params, nodes, comment)
        .then((r) => { if (r.ok) { lastSaved.current = cur; setUpdatedAtState(new Date().toISOString()); } setSaveState(r.ok ? "saved" : "error"); setSaveError(r.ok ? null : r.error); })
        .catch(() => { setSaveState("error"); setSaveError("Нет связи с сервером"); });
    }, 900);
    return () => clearTimeout(t);
  }, [nodes, params, comment, p.id, canEdit]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const kids = useMemo(() => childrenMap(nodes), [nodes]);
  const calc = useMemo(() => computeTree(nodes, params), [nodes, params]);
  const total = useMemo(() => grandTotal(nodes, params), [nodes, params]);
  const furs = useMemo(() => kids.get(null) ?? [], [kids]);
  const pairOptions = useMemo(() => stats.filter((s) => !s.modelId), [stats]);

  const setParam = (k: keyof BudgetParams, v: number) => {
    const np = { ...params, [k]: v };
    setParams(np);
    setNodes((ns) => reapplyParams(ns, np));
  };
  const setUp = (id: string, k: UpKey, v: number | null) => setNodes((ns) => reapplyParams(ns.map((n) => (n.id === id ? { ...n, [k]: v } : n)), params));
  const patch = useCallback((id: string, pt: Partial<BudgetNode>) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...pt } : n))), []);
  const editNum = (id: string, k: NumKey, v: number) => patch(id, k === "pcs" ? { pcs: v } : { [k]: v, locked: true, src: "manual" });
  const toggleLock = (id: string) => setNodes((ns) => {
    const n = ns.find((x) => x.id === id);
    if (!n) return ns;
    if (!n.locked) return ns.map((x) => (x.id === id ? { ...x, locked: true, src: x.src === "none" ? "manual" : x.src } : x));
    return autoCalc(ns.map((x) => (x.id === id ? { ...x, locked: false } : x)), stats, params, id);
  });
  const setStat = (id: string, key: string) => {
    const [statFur, statCat] = key.split("|");
    setNodes((ns) => autoCalc(ns.map((x) => (x.id === id ? { ...x, statFur, statCat } : x)), stats, params, id));
  };

  const addNode = (kind: AddKind, parentId: string | null, v: { name: string; modelId: string | null }) => {
    const n = blankNode(kind, parentId, v.name, { modelId: v.modelId });
    setNodes((ns) => autoCalc([...ns, n], stats, params, n.id));
    if (parentId) setCollapsed((c) => { const x = new Set(c); x.delete(parentId); return x; });
    setAdding(null);
  };
  const removeNode = (id: string) => {
    const drop = new Set<string>([id]);
    for (let i = 0; i < 4; i++) for (const n of nodes) if (n.parentId && drop.has(n.parentId)) drop.add(n.id);
    setNodes((ns) => ns.filter((n) => !drop.has(n.id)));
    setRemoving(null);
  };
  const toggle = (id: string) => setCollapsed((c) => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const expandAll = () => setCollapsed(new Set());
  const hasArt = nodes.some((n) => n.kind === "art");
  const collapseAll = () => setCollapsed(new Set(nodes.filter((n) => n.kind !== "art").map((n) => n.id)));
  const collapseToFurs = () => setCollapsed(new Set(furs.map((f) => f.id)));

  const runAuto = (scopeId?: string) => startBusy(async () => {
    try {
      const fresh = await refreshBudgetStats();
      setStats(fresh);
      const before = nodes;
      const next = autoCalc(before, fresh, params, scopeId);
      setNodes(next);
      const hasKid = new Set(before.map((n) => n.parentId));
      const inScope = (n: BudgetNode) => { let c: BudgetNode | undefined = n; for (let i = 0; c && i < 5; i++) { if (!scopeId || c.id === scopeId) return true; c = c.parentId ? byId.get(c.parentId) : undefined; } return false; };
      const leaves = next.filter((n) => n.kind !== "fur" && !hasKid.has(n.id) && inScope(n));
      const locked = leaves.filter((n) => effLocked(n, byId)).length;
      const nodata = leaves.filter((n) => !effLocked(n, byId) && n.src === "none").length;
      const byArt = leaves.filter((n) => !effLocked(n, byId) && n.src === "art").length;
      setMsg(`Пересчитано по данным системы: ${leaves.length - locked} строк${byArt ? ` (по ТЗ артикула: ${byArt})` : ""}.${locked ? ` С замком, не тронуты: ${locked}.` : ""}${nodata ? ` Нет данных в системе: ${nodata}.` : ""}`);
    } catch { setMsg("Не удалось получить данные системы. Попробуйте ещё раз."); }
  });

  // ---- Загрузка из файла и выгрузка в Excel
  const onFile = (f: File | undefined) => {
    if (!f) return;
    startBusy(async () => {
      const fd = new FormData();
      fd.set("file", f);
      try {
        const r = await parseBudgetFile(fd);
        if (!r.ok) { setMsg(r.error); return; }
        setPreview({ rows: r.rows, warnings: r.warnings, sheet: r.sheet, fileName: f.name });
      } catch { setMsg("Не удалось загрузить файл. Попробуйте ещё раз."); }
      if (fileRef.current) fileRef.current.value = "";
    });
  };
  const importStats = useMemo(() => {
    if (!preview) return null;
    const furKeys = new Set(furs.map((f) => normKey(f.name)));
    const newFurs = new Set(preview.rows.map((r) => normKey(r.fur)).filter((k) => !furKeys.has(k)));
    const exist = preview.rows.filter((r) => nodes.some((n) => n.kind === "cat" && normKey(n.name) === normKey(r.cat) && normKey(byId.get(n.parentId ?? "")?.name ?? "") === normKey(r.fur))).length;
    return { newFurs: newFurs.size, exist, lynx: preview.rows.filter((r) => normKey(r.fur) === "рысь").length };
  }, [preview, furs, nodes, byId]);

  const applyImport = () => {
    if (!preview) return;
    let ns = [...nodes];
    const touched = new Set<string>();
    const lynxDef = defaultLines().filter((l) => l.fur === "Рысь");
    for (const r of preview.rows) {
      let fur = ns.find((n) => n.kind === "fur" && normKey(n.name) === normKey(r.fur));
      if (!fur) { fur = blankNode("fur", null, r.fur); ns.push(fur); }
      const isLynx = normKey(r.fur) === "рысь";
      let cat = ns.find((n) => n.kind === "cat" && n.parentId === fur!.id && normKey(n.name) === normKey(r.cat));
      if (!cat) { cat = blankNode("cat", fur.id, r.cat); ns.push(cat); }
      const given = [r.hides, r.hidePrice, r.meters, r.meterPrice, r.work].some((v) => v != null);
      const patchN: Partial<BudgetNode> = { pcs: r.pcs };
      if (r.statFur) patchN.statFur = r.statFur;
      if (r.statCat) patchN.statCat = r.statCat;
      if (given) Object.assign(patchN, { hides: r.hides ?? 0, hidePrice: r.hidePrice ?? 0, meters: r.meters ?? 0, meterPrice: r.meterPrice ?? 0, work: r.work ?? 0, locked: true, src: "manual" });
      else if (isLynx) {
        const d = lynxDef.find((l) => normKey(l.cat) === normKey(r.cat));
        if (d) Object.assign(patchN, { hides: d.hides, hidePrice: d.hidePrice, meters: d.meters, meterPrice: d.meterPrice, work: d.work, base: d.base, sample: 0, locked: true, src: "manual" });
      } else Object.assign(patchN, { locked: false });
      const id = cat.id;
      ns = ns.map((n) => (n.id === id ? { ...n, ...patchN } : n));
      touched.add(id);
    }
    // Значения по данным системы — только для загруженных строк без своих цифр; остальные строки бюджета не трогаем.
    const calcd = autoCalc(ns, stats, params);
    ns = ns.map((n, i) => (touched.has(n.id) && !n.locked ? calcd[i] : n));
    // После загрузки все строки типа «Рысь» фиксируются замком.
    const lynxIds = new Set(ns.filter((n) => n.kind === "fur" && normKey(n.name) === "рысь").map((n) => n.id));
    ns = ns.map((n) => (lynxIds.has(n.id) || (n.parentId && lynxIds.has(n.parentId)) ? { ...n, locked: true, src: n.kind === "fur" ? n.src : n.src === "none" ? "manual" : n.src } : n));
    setNodes(ns);
    setMsg(`Загружено из файла «${preview.fileName}»: ${preview.rows.length} строк.${preview.rows.some((r) => normKey(r.fur) === "рысь") ? " Строки «Рысь» зафиксированы замком." : ""}`);
    setPreview(null);
  };

  const downloadXlsx = () => startBusy(async () => {
    try {
      const r = await exportBudgetXlsx(p.id);
      if (!r.ok) { setMsg(r.error); return; }
      const bin = atob(r.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = r.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setMsg("Не удалось сформировать Excel"); }
  });

  const staff = p.canEdit;
  const takenIn = (kind: AddKind, parentId: string | null) =>
    (kids.get(parentId) ?? []).filter((n) => n.kind === kind).map((n) => (kind === "art" ? (n.modelId ?? "") : n.name.toLowerCase()));

  // ---- Мелкие элементы строки
  const perT = perUnit(total);
  const leafOf = (n: BudgetNode) => n.kind !== "fur" && (kids.get(n.id) ?? []).length === 0;

  /** Индикатор качества данных: цветная точка с подсказкой; у категории-листа по клику выбирается источник статистики. */
  const dot = (n: BudgetNode) => {
    if (!leafOf(n)) return null;
    const si = srcInfo(n);
    const d = <span className={`inline-block h-2 w-2 rounded-full ${DOT[si.tone]}`} />;
    return n.kind === "cat" && canEdit && !effLocked(n, byId)
      ? <button type="button" onClick={() => setStatFor(n.id)} title={`${si.label}. Нажмите, чтобы выбрать источник данных`} aria-label={`Качество данных: ${si.label}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-neutral-100 md:h-5 md:w-5">{d}</button>
      : <span title={si.label} aria-label={`Качество данных: ${si.label}`} className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{d}</span>;
  };

  /** Маленький зелёный процент надбавки рядом с ценой: у унаследованной обычный, у заданной на этой строке подчёркнутый и жирнее. */
  const upTag = (n: BudgetNode, k: UpKey) => {
    if (!leafOf(n) || !n.base || effLocked(n, byId)) return <span className="w-9 shrink-0" />;
    const e: EffUp = effUp(n, byId, params);
    const v = k === "upFur" ? e.fur : k === "upLining" ? e.lining : e.work;
    const own = k === "upFur" ? e.ownFur : k === "upLining" ? e.ownLining : e.ownWork;
    if (!v) return <span className="w-9 shrink-0" />;
    return <span title={own ? "Надбавка задана на этой строке" : "Надбавка унаследована от уровня выше"} className={"w-11 shrink-0 text-right text-[10px] leading-none text-emerald-600 " + (own ? "font-bold underline" : "")}>{formatPercent(v, { sign: true })}</span>;
  };

  const hasOwnUp = (n: BudgetNode) => [n.upFur, n.upLining, n.upWork].some((v) => typeof v === "number");

  const actions = (n: BudgetNode, hasKids: boolean) => (
    <div className="flex items-center justify-end gap-1 print:hidden">
      {canEdit ? (
        <>
          <button type="button" className={ICON_BTN + (n.locked ? " border-[var(--ui-accent)] bg-[var(--ui-soft)] text-[var(--ui-accent-text)]" : "")} onClick={() => toggleLock(n.id)} aria-pressed={n.locked} aria-label={n.locked ? "Замок закрыт" : "Замок открыт"}
            title={n.locked ? "Замок закрыт: значения ручные, автоматический расчёт не трогает. Нажмите, чтобы вернуть автоматический расчёт" : "Замок открыт: считается автоматически. Ручная правка значения закроет замок"}>{n.locked ? "🔒" : <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>}</button>
          <button type="button" className={ICON_BTN} disabled={busy} onClick={() => runAuto(n.id)} aria-label="Автоматический расчёт для блока" title="Автоматический расчёт только для этого блока">↻</button>
          <button type="button" className={ICON_BTN + (hasOwnUp(n) ? " border-[var(--ui-accent)] bg-[var(--ui-soft)] text-[var(--ui-accent-text)]" : "")} onClick={() => setUpFor(n.id)} aria-label="Надбавки для этой строки" title="Надбавки для этой строки и всего, что внутри">%</button>
          {n.kind !== "art" ? <button type="button" className={ICON_BTN} onClick={() => setAdding({ kind: n.kind === "fur" ? "cat" : "art", parentId: n.id })} aria-label={n.kind === "fur" ? "Добавить категорию" : "Добавить артикул"} title={n.kind === "fur" ? "Добавить категорию" : "Добавить артикул"}>＋</button> : null}
          <button type="button" className={ICON_BTN + " hover:text-red-700"} onClick={() => (hasKids || n.pcs > 0 ? setRemoving(n.id) : removeNode(n.id))} aria-label={`Удалить: ${n.name}`} title="Удалить">×</button>
        </>
      ) : n.locked ? <span title="Замок: ручные значения" aria-label="Замок закрыт">🔒</span> : null}
    </div>
  );

  /** Замок показывается только там, где он закрыт (значения ручные, автоматический расчёт строку и всё внутри не трогает). Открыть — кнопка в «Детально»; закрыть — значок замка в колонке «Действия». */
  const lockBtn = (n: BudgetNode, interactive = true) => {
    if (!n.locked) return null;
    return interactive && canEdit ? (
      <button type="button" onClick={() => toggleLock(n.id)} aria-pressed aria-label="Замок закрыт" data-touch-ok
        title="Замок закрыт: значения ручные, автоматический расчёт не трогает (в том числе всё внутри). Нажмите, чтобы открыть и вернуть автоматический расчёт"
        className="btn-accent inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--ui-accent)] bg-[var(--ui-soft)] text-[11px]">🔒</button>
    ) : <span title="Замок: ручные значения, автоматический расчёт не трогает" aria-label="Замок закрыт" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[11px]">🔒</span>;
  };

  const chevron = (n: BudgetNode, hasKids: boolean, open: boolean, size = "h-7 w-6") =>
    n.kind !== "art" && hasKids ? (
      <button type="button" onClick={() => toggle(n.id)} aria-expanded={open} aria-label={`${open ? "Свернуть" : "Развернуть"}: ${n.name}`} className={`inline-flex ${size} shrink-0 items-center justify-center text-neutral-500 hover:text-neutral-900`}>
        <span aria-hidden className={"inline-block transition-transform " + (open ? "rotate-90" : "")}>›</span>
      </button>
    ) : <span className="w-6 shrink-0" />;

  // ---- Плитки (как на Главной: TILE_BOX + Tile*, у всех по три строки — строки соседних плиток на одной горизонтали)
  const tile = (key: string, head: string, value: string, caption: string, items: { k: string; v: string }[]) => (
    <div key={key} className={TILE_BOX + " shadow-sm print:shadow-none"}>
      <TileHead>{head}</TileHead><TileValue>{value}</TileValue><TileCaption>{caption}</TileCaption>
      <TileList items={items} />
    </div>
  );
  // Плитка «Мех»: первым слайдом «Тотал», далее каждый тип меха.
  const furSlides = [
    { id: "mex", name: "Тотал", a: total },
    ...furs.map((f) => ({ id: f.id, name: f.name, a: calc.get(f.id) ?? ZERO })),
  ].map((sl) => {
    const isMex = sl.id === "mex";
    const items = [
      { k: "Цена шкуры (ср.)", v: money(sl.a.hides ? sl.a.mex / sl.a.hides : null) },
      { k: "Шкур на изд. (ср.)", v: qty(sl.a.pcs ? sl.a.hides / sl.a.pcs : null, 1) },
      { k: "Доля", v: share(isMex ? sl.a.mex : sl.a.total, total.total) },
    ];
    return {
      key: sl.id, label: sl.name,
      body: <><TileValue>{money(isMex ? sl.a.mex : sl.a.total)}</TileValue><TileCaption>{isMex ? `${qty(sl.a.hides, 0)} шкур` : `${qty(sl.a.pcs, 0)} изд. · ${qty(sl.a.hides, 0)} шкур`}</TileCaption><TileList items={items} /></>,
    };
  });
  const furTile = (
    <TileCarousel key="fur" title="Мех" hintLabel="Что показывает плитка «Мех»" hint={<p>Первый слайд — стоимость всего меха, далее каждый тип сырья: сколько изделий и шкур, средняя цена шкуры и доля в бюджете.</p>}
      slides={furSlides} slidesLabel="слайды: тотал и типы меха" dotsLabel="Тип меха" />
  );

  const totalTiles = (
    <div className="grid grid-cols-1 items-stretch gap-3 min-[560px]:grid-cols-2 lg:grid-cols-3 min-[1500px]:grid-cols-5 print:grid-cols-5">
      {tile("t", "Прогноз бюджета", money(total.total), `${qty(total.pcs, 0)} изд.`, [{ k: "На 1 изделие", v: money(perT) }, { k: "Var", v: pct(varPct(total)) }, { k: "Доля", v: "100,0%" }])}
      {furTile}
      {tile("l", "Подкладка", money(total.lining), `${qty(total.meters, 1)} м`, [{ k: "Цена за м (ср.)", v: money(total.meters ? total.lining / total.meters : null) }, { k: "Метров на изд. (ср.)", v: qty(total.pcs ? total.meters / total.pcs : null, 1) }, { k: "Доля", v: share(total.lining, total.total) }])}
      {tile("w", "Работа", money(total.work), "пошив по бюджету", [{ k: "На 1 изделие", v: money(total.pcs ? total.work / total.pcs : null) }, { k: "Надбавка к цене", v: formatPercent(params.upWork) }, { k: "Доля", v: share(total.work, total.total) }])}
      {tile("c", `Надбавка ${formatPercent(params.c4)}`, money(total.c4), "на мех и подкладку", [{ k: "На 1 изделие", v: money(total.pcs ? total.c4 / total.pcs : null) }, { k: "Ставка", v: formatPercent(params.c4) }, { k: "Доля", v: share(total.c4, total.total) }])}
    </div>
  );
  // ---- Сводка (для руководства): без полей ввода
  const sumCell = "whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums";
  const sumRow = (key: string, label: ReactNode, a: Agg, o: { bg: string; bold?: boolean; sticky?: boolean; node?: BudgetNode }) => {
    const v = varPct(a);
    const sh = total.total > 0 ? a.total / total.total : 0;
    return (
      <tr key={key} className={`${o.bg} ${o.bold ? "font-semibold" : ""} [&>td]:border-b [&>td]:border-neutral-100 print:break-inside-avoid`}>
        <td className={`sticky left-0 z-10 min-w-[220px] max-w-[320px] border-r border-neutral-200 px-3 py-2 text-sm bg-inherit print:static`}>{label}</td>
        <td className={sumCell}>{qz(a.pcs)}<PcsShare pcs={a.pcs} all={total.pcs} /></td>
        <td className={sumCell + " text-neutral-600"}>{qz(a.hides)}<Avg sum={a.hides} per={a.pcs} unit="шк./изд." d={1} /></td>
        <td className={sumCell + " " + sepL}>{mz(a.mex)}<Avg sum={a.mex} per={a.hides} unit="₽/шт." /></td>
        <td className={sumCell}>{mz(a.lining)}<Avg sum={a.lining} per={a.meters} unit="₽/м" /></td>
        <td className={sumCell}>{mz(a.work)}<Avg sum={a.work} per={a.pcs} unit="₽/изд." /></td>
        <td className={sumCell + " text-neutral-500"}>{mz(a.c4)}<Avg sum={a.c4} per={a.pcs} unit="₽/изд." /></td>
        <td className={sumCell + " min-w-[150px] text-base font-semibold " + sepL}>
          {mz(a.total)}
          <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] font-normal text-neutral-500">
            <span className="h-1 w-16 overflow-hidden rounded-full bg-neutral-200"><span className="block h-1 rounded-full bg-neutral-700" style={{ width: `${Math.min(100, sh * 100)}%` }} /></span>
            <span className="w-9 text-right">{share(a.total, total.total)}</span>
          </div>
        </td>
        <td className={sumCell}>{mz(perUnit(a))}<VarTag v={v} /></td>
      </tr>
    );
  };
  const summaryRows = (parentId: string | null, depth: number): ReactNode[] =>
    (kids.get(parentId) ?? []).flatMap((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = kids.get(n.id) ?? [];
      const open = !collapsed.has(n.id);
      const bg = n.kind === "fur" ? "bg-neutral-100" : ch.length ? "bg-neutral-50" : "bg-white";
      const label = (
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
          {chevron(n, ch.length > 0, open)}
          {lockBtn(n, false)}
          <span className={n.kind === "fur" ? "text-base" : ""}>{n.name || "Без названия"}</span>
          {n.kind === "art" ? <Badge tone={n.modelId ? "info" : "manual"}>{n.modelId ? "арт." : "план"}</Badge> : null}
        </div>
      );
      return [sumRow(n.id, label, a, { bg, bold: n.kind === "fur" || ch.length > 0 }), ...(open ? summaryRows(n.id, depth + 1) : [])];
    });

  // ---- Детально: таблица с полями (планшет и компьютер)
  const numCell = (n: BudgetNode, k: NumKey, label: string, w: string, tag?: UpKey, below?: ReactNode) => (
    <td className={"px-1.5 py-1 " + w}>
      <div className="flex items-center gap-1">{tag ? upTag(n, tag) : null}<NumInput value={n[k]} ariaLabel={`${label}: ${n.name}`} disabled={!canEdit} onChange={(v) => editNum(n.id, k, v)} /></div>
      {below}
    </td>
  );
  const avg = (a: Agg) => ({
    hides: a.pcs > 0 ? a.hides / a.pcs : null, hidePrice: a.hides > 0 ? a.mex / a.hides : null,
    meters: a.pcs > 0 ? a.meters / a.pcs : null, meterPrice: a.meters > 0 ? a.lining / a.meters : null, work: a.pcs > 0 ? a.work / a.pcs : null,
  });

  const nameCell = (n: BudgetNode, depth: number, hasKids: boolean, open: boolean) => (
    <td className={`sticky left-0 z-10 min-w-[200px] max-w-[320px] border-r border-neutral-200 px-2 py-1.5 align-middle lg:min-w-[270px] bg-inherit`}>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
        {chevron(n, hasKids, open)}
        {lockBtn(n)}
        {canEdit ? (
          <input value={n.name} onChange={(e) => patch(n.id, { name: e.target.value })} aria-label={`Название (${KIND_LABEL[n.kind]})`}
            className={"min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 hover:border-neutral-300 focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:outline-none " + (n.kind === "fur" ? "text-sm font-semibold" : n.kind === "cat" ? "text-sm font-medium" : "text-sm")} />
        ) : <span className={"min-w-0 flex-1 truncate px-1 " + (n.kind === "fur" ? "text-sm font-semibold" : "text-sm")}>{n.name}</span>}
        {n.kind === "art" ? <Badge tone={n.modelId ? "info" : "manual"} title={n.modelId ? "Артикул из каталога системы" : "Плановый артикул: есть только в бюджете"}>{n.modelId ? "арт." : "план"}</Badge> : null}
        {dot(n)}
        {canEdit && n.kind !== "art" ? (
          <button type="button" onClick={() => setAdding({ kind: n.kind === "fur" ? "cat" : "art", parentId: n.id })} data-touch-ok
            title={n.kind === "fur" ? "Добавить категорию в этот тип сырья" : "Добавить артикул в эту категорию: из списка системы или новый плановый"}
            className="shrink-0 whitespace-nowrap rounded px-1 text-[11px] text-blue-700 hover:underline">+ {n.kind === "fur" ? "категория" : "артикул"}</button>
        ) : null}
      </div>
    </td>
  );

  const tableRows = (parentId: string | null, depth: number): ReactNode[] =>
    (kids.get(parentId) ?? []).flatMap((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = kids.get(n.id) ?? [];
      const hasKids = ch.length > 0;
      const leaf = n.kind !== "fur" && !hasKids;
      const open = !collapsed.has(n.id);
      const bg = n.kind === "fur" ? "bg-neutral-100" : hasKids ? "bg-neutral-50" : "bg-white";
      const av = avg(a);
      const g = (v: number | null, d = 1) => <td className="px-2 text-right text-xs tabular-nums text-neutral-500">{qz(v, d)}</td>;
      const gm = (v: number | null) => <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500">{v == null ? "—" : money(v)}</td>;
      const row = (
        <tr key={n.id} className={`${bg} ${n.kind === "fur" ? "font-semibold" : ""} [&>td]:border-b [&>td]:border-neutral-100`}>
          {nameCell(n, depth, hasKids, open)}
          {leaf ? numCell(n, "pcs", "Бюджет, шт.", "w-[84px] min-w-[84px] " + sepL, undefined, <PcsShare pcs={a.pcs} all={total.pcs} />) : <td className={`whitespace-nowrap px-2 text-right text-sm tabular-nums ${sepL}`}>{qz(a.pcs)}<PcsShare pcs={a.pcs} all={total.pcs} /></td>}
          {leaf ? numCell(n, "hides", "Шкур на изделие", "w-[80px] min-w-[80px]") : g(av.hides)}
          <td className="px-2 text-right text-xs tabular-nums text-neutral-600">{qz(a.hides)}<Avg sum={a.hides} per={a.pcs} unit="шк./изд." d={1} /></td>
          {leaf ? numCell(n, "hidePrice", "Цена шкуры", "w-[150px] min-w-[150px] " + sepL, "upFur") : <td className={`whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500 ${sepL}`}>{av.hidePrice == null ? "—" : money(av.hidePrice)}</td>}
          {leaf ? numCell(n, "meters", "Подкладка, м на изделие", "w-[84px] min-w-[84px]") : g(av.meters)}
          {leaf ? numCell(n, "meterPrice", "Цена подкладки за м", "w-[132px] min-w-[132px]", "upLining") : gm(av.meterPrice)}
          {leaf ? numCell(n, "work", "Работа на изделие", "w-[150px] min-w-[150px]", "upWork") : gm(av.work)}
          <td className={`whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600 ${sepL}`}>{mz(a.mex)}<Avg sum={a.mex} per={a.hides} unit="₽/шт." /></td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600">{mz(a.lining)}<Avg sum={a.lining} per={a.meters} unit="₽/м" /></td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600">{mz(a.work)}<Avg sum={a.work} per={a.pcs} unit="₽/изд." /></td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500">{mz(a.c4)}<Avg sum={a.c4} per={a.pcs} unit="₽/изд." /></td>
          <td className="whitespace-nowrap px-2 text-right text-sm font-semibold tabular-nums">{mz(a.total)}</td>
          <td className="whitespace-nowrap px-2 text-right text-sm tabular-nums">{mz(perUnit(a))}<VarTag v={varPct(a)} /></td>
          <td className="border-l border-neutral-200 bg-inherit px-1.5 py-1 lg:sticky lg:right-0 lg:z-10">{actions(n, hasKids)}</td>
        </tr>
      );
      return [row, ...(open ? tableRows(n.id, depth + 1) : [])];
    });

  const totalRowDetail = (
    <tr key="total" className="row-total">
      <td className="sticky left-0 z-10 border-r border-neutral-200 px-3 py-2 text-sm"><TotalLabel /></td>
      <td className={`whitespace-nowrap px-2 text-right text-sm tabular-nums ${sepL}`}>{qty(total.pcs, 0)}<div className="mt-0.5 text-right text-[10px] font-normal text-neutral-500">100,0% заказа</div></td>
      <td />
      <td className="px-2 text-right text-xs tabular-nums text-neutral-700">{qty(total.hides, 0)}<Avg sum={total.hides} per={total.pcs} unit="шк./изд." d={1} /></td>
      <td className={sepL} colSpan={4} />
      <td className={`whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-700 ${sepL}`}>{money(total.mex)}<Avg sum={total.mex} per={total.hides} unit="₽/шт." /></td>
      <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-700">{money(total.lining)}<Avg sum={total.lining} per={total.meters} unit="₽/м" /></td>
      <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-700">{money(total.work)}<Avg sum={total.work} per={total.pcs} unit="₽/изд." /></td>
      <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600">{money(total.c4)}<Avg sum={total.c4} per={total.pcs} unit="₽/изд." /></td>
      <td className="whitespace-nowrap px-2 text-right text-sm tabular-nums">{money(total.total)}</td>
      <td className="whitespace-nowrap px-2 text-right text-sm tabular-nums">{money(perT)}<VarTag v={varPct(total)} /></td>
      <td className="border-l border-neutral-200 lg:sticky lg:right-0 lg:z-10" />
    </tr>
  );

  // ---- Карточки (телефон, режим «Детально»)
  const cardField = (n: BudgetNode, k: NumKey, label: string, tag?: UpKey) => (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-500"><span className="flex items-center justify-between gap-1">{label}{tag ? upTag(n, tag) : null}</span><NumInput value={n[k]} ariaLabel={`${label}: ${n.name}`} disabled={!canEdit} onChange={(v) => editNum(n.id, k, v)} className="!py-2 !text-base" /></label>
  );
  const cards = (parentId: string | null, depth: number): ReactNode[] =>
    (kids.get(parentId) ?? []).map((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = kids.get(n.id) ?? [];
      const hasKids = ch.length > 0;
      const leaf = n.kind !== "fur" && !hasKids;
      const open = !collapsed.has(n.id);
      return (
        <div key={n.id} className={depth > 0 ? "ml-3 border-l-2 border-neutral-200 pl-2" : ""}>
          <div className={"rounded-lg border p-3 " + (n.kind === "fur" ? "border-neutral-300 bg-neutral-100" : "border-neutral-200 bg-white")}>
            <div className="flex items-center gap-1">
              {chevron(n, hasKids, open, "h-10 w-8 text-lg")}
              {canEdit ? <input value={n.name} onChange={(e) => patch(n.id, { name: e.target.value })} aria-label={`Название (${KIND_LABEL[n.kind]})`} className="min-h-10 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:outline-none" />
                : <span className="min-w-0 flex-1 px-1 text-sm font-semibold">{n.name}</span>}
              {n.kind === "art" ? <Badge tone={n.modelId ? "info" : "manual"}>{n.modelId ? "арт." : "план"}</Badge> : null}
              {dot(n)}
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-xl font-semibold tabular-nums">{money(a.total)}</span>
              <span className="text-xs text-neutral-500 tabular-nums">{qty(a.pcs, 0)} изд.{total.pcs > 0 && a.pcs > 0 ? ` (${formatPercent((a.pcs / total.pcs) * 100)} заказа)` : ""} · на 1 изд. {money(perUnit(a))}</span>
            </div>
            {leaf ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {cardField(n, "pcs", "Бюджет, шт.")}{cardField(n, "hides", "Шкур на изделие")}
                  {cardField(n, "hidePrice", "Цена шкуры, ₽", "upFur")}{cardField(n, "meters", "Подкладка, м/изд.")}
                  {cardField(n, "meterPrice", "Цена за м, ₽", "upLining")}{cardField(n, "work", "Работа/изд., ₽", "upWork")}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {[["Всего шкур", qty(a.hides, 0)], ["Мех", money(a.mex)], ["Подкладка", money(a.lining)], ["Работа", money(a.work)], ["Надбавка", money(a.c4)], ["На 1 изделие", money(perUnit(a))], ["Var", pct(varPct(a))]].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2"><dt className="text-neutral-500">{k}</dt><dd className="tabular-nums text-neutral-800">{v}</dd></div>
                  ))}
                </dl>
              </>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">{actions(n, hasKids)}</div>
          </div>
          {open && hasKids ? <div className="mt-2 flex flex-col gap-2">{cards(n.id, depth + 1)}</div> : null}
        </div>
      );
    });

  const saveText = !canEdit ? (status === "APPROVED" ? "Утверждён: только просмотр" : "Только просмотр")
    : saveState === "saving" ? "Сохраняю…" : saveState === "saved" ? "Сохранено" : saveState === "error" ? `Не удалось сохранить${saveError ? `: ${saveError}` : ""}` : "";
  const grp = `${sepL} border-b border-neutral-200 px-2 pt-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500`;
  const upNode = upFor ? byId.get(upFor) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <Link href="/budget" className="text-xs text-neutral-500 hover:underline">← Все бюджеты</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{p.name}</h1>
            {p.season !== p.name ? <span className="text-sm text-neutral-500">{p.season}</span> : null}
            {canEdit ? (
              <button type="button" onClick={() => setRenaming(true)} aria-label="Редактировать карточку бюджета" title="Редактировать карточку бюджета: название и сезон" data-touch-ok
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900">
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
              </button>
            ) : null}
            {status === "APPROVED" ? <Badge tone="ok">Утверждён</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">Создан {dateRu(p.createdAt)} · Обновлён {new Date(updatedAtState ?? p.savedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}{p.savedBy ? ` · ${p.savedBy}` : ""}</p>
          <p className="text-[11px] text-neutral-400" role="status">{saveText}</p>
        </div>
        {staff ? (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? <button type="button" onClick={() => runAuto()} disabled={busy} className={BTN_PRIMARY}>{busy ? "Считаю…" : "Автоматический расчёт"}</button> : null}
            {canEdit ? <button type="button" onClick={() => setAdding({ kind: "fur", parentId: null })} className={BTN}>+ Тип сырья</button> : null}
            {canEdit ? <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={BTN}>Загрузить из файла</button> : null}
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="Файл бюджета" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        ) : null}
      </div>
      <h1 className="hidden text-xl font-semibold print:block">{p.name} · {p.season}</h1>
      {msg ? <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700 print:hidden" role="status">{msg}</p> : null}

      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <WidgetRow id="budget-totals" title="Всего, ₽ по бюджету">{totalTiles}</WidgetRow>
        </div>
        <aside aria-label="Надбавки" className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 print:hidden">
          <div className="flex items-center gap-1 self-center text-sm font-medium">Надбавки, %
            <InfoHint label="Что такое надбавки" wide>
              <p>Автоматический расчёт берёт из системы средневзвешенные цены и увеличивает на заданный процент: цену шкуры, цену подкладки и стоимость работы. Любой процент, в том числе 0.</p>
              <p className="mt-1">Здесь — общие надбавки версии. Свои надбавки можно задать на типе меха и на категории внутри него: кнопка «Надбавки по типам и категориям» ниже или «%» у строки. Пусто — берётся с уровня выше.</p>
            </InfoHint>
          </div>
          <div className="flex gap-2">
            {([["upFur", "Шкура"], ["upLining", "Подкладка"], ["upWork", "Работа"], ["c4", "4% на сырьё"]] as const).map(([k, label]) => (
              <label key={k} className="flex w-[74px] flex-col gap-0.5 text-[11px] text-neutral-500">{label}
                <NumInput value={params[k]} ariaLabel={`${label}, %`} disabled={!canEdit} onChange={(v) => setParam(k, v)} className="!py-0.5 !text-sm" />
              </label>
            ))}
          </div>
          <input value={comment} onChange={(e) => setComment(e.target.value)} disabled={!canEdit} maxLength={500} aria-label="Комментарий к версии" placeholder="Комментарий к версии"
            className="ui-field h-11 min-w-[170px] flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-xs focus-visible:outline-none disabled:border-transparent disabled:bg-transparent" />
          {canEdit ? <button type="button" onClick={() => setUpAll(true)} className="self-center text-left text-xs text-blue-700 hover:underline">Надбавки по типам меха и категориям…</button> : null}
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Состав бюджета
            <InfoHint label="Как считается бюджет" wide>
              <p>Изделий × (шкур × цена шкуры + подкладка, м × цена за м + работа) + {formatPercent(params.c4)} на мех и подкладку.</p>
              <p className="mt-1">Var под «На 1 изд.» — бюджет к текущим ценам системы (те же количества без надбавок). Мелкие «ср.» под суммами — средневзвешенные: цена шкуры, цена метра, работа и надбавка на изделие, шкур на изделие. Если у категории есть артикулы, её итог — сумма артикулов.</p>
              <p className="mt-1">Точка у строки — качество данных: зелёная — достаточно данных системы, жёлтая — малая выборка, красная — нет данных, серая — вручную. Закрытый замок — строка ручная.</p>
            </InfoHint>
          </h2>
          <div role="group" aria-label="Режим таблицы" className={SEG_BOX}>
            {([["summary", "Сводка"], ["detail", "Детально"]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                className={segBtn(view === v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" onClick={expandAll} className="inline-flex min-h-10 items-center text-neutral-600 hover:underline md:min-h-0">Развернуть всё</button>
          <button type="button" onClick={collapseToFurs} className="inline-flex min-h-10 items-center text-neutral-600 hover:underline md:min-h-0">Только типы сырья</button>
          <button type="button" onClick={collapseAll} disabled={!hasArt} title={hasArt ? "Свернуть категории: артикулы скроются" : "В бюджете пока нет артикулов"} className="hidden min-h-10 items-center text-neutral-600 hover:underline disabled:cursor-not-allowed disabled:text-neutral-300 disabled:no-underline md:min-h-0 xl:inline-flex">Скрыть артикулы</button>
          <button type="button" onClick={downloadXlsx} disabled={busy} className={BTN}>Скачать Excel</button>
          <button type="button" onClick={() => window.print()} className={BTN}>Печать</button>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Бюджет пуст. {canEdit ? "Нажмите «+ Тип сырья» и добавьте категории и артикулы либо «Загрузить из файла»." : ""}
        </div>
      ) : (
        <>
          <div className={(view === "summary" ? "" : "hidden print:block ") + "max-h-[78vh] overflow-auto rounded-lg border border-neutral-200 bg-white print:max-h-none print:overflow-visible print:border-0"}>
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left print:min-w-0 print:text-xs">
              <thead className="sticky top-0 z-20 bg-white print:static">
                <tr className="h-7">
                  <th rowSpan={2} scope="col" className="sticky left-0 z-30 min-w-[220px] border-b border-r border-neutral-200 bg-white px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500 print:static">Тип сырья · категория</th>
                  <th colSpan={2} className="border-b border-neutral-200 px-2 pt-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Количество</th>
                  <th colSpan={4} className={grp}>Затраты</th>
                  <th colSpan={2} className={grp}>Прогноз</th>
                </tr>
                <tr className="[&>th]:border-b [&>th]:border-neutral-200">
                  <Th tip="Бюджет изделий, шт.">Изделий</Th>
                  <Th tip="Всего шкур на эти изделия">Шкур</Th>
                  <Th tip="Мех = шкуры × цена шкуры" className={sepL}>Мех</Th>
                  <Th tip="Подкладка = метры × цена за метр">Подкладка</Th>
                  <Th tip="Работа = изделия × работа на изделие">Работа</Th>
                  <Th tip="Надбавка на мех и подкладку">4%</Th>
                  <Th tip="Мех + подкладка + работа + 4%; под цифрой доля в общем итоге" className={sepL}>Всего, ₽</Th>
                  <Th tip="Всего, ₽ ÷ изделий. Под цифрой Var — бюджет к текущим ценам системы: красным выше на 15% и больше, зелёным ниже на 5% и больше">На 1 изд.</Th>
                </tr>
              </thead>
              <tbody>
                {sumRow("total", <TotalLabel />, total, { bg: "row-total", bold: true })}
                {summaryRows(null, 0)}
              </tbody>
            </table>
          </div>

          <div className={(view === "detail" ? "hidden md:block " : "hidden ") + "max-h-[78vh] overflow-auto rounded-lg border border-neutral-200 bg-white print:hidden"}>
            <table className="w-max min-w-full border-separate border-spacing-0 text-left">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="h-7">
                  <th rowSpan={2} scope="col" className="sticky left-0 z-30 min-w-[200px] border-b border-r border-neutral-200 bg-white px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500 lg:min-w-[270px]">Тип сырья · категория · артикул</th>
                  <th colSpan={3} className={grp}>Количество</th>
                  <th colSpan={4} className={grp}>Цены на 1 изделие</th>
                  <th colSpan={6} className={grp}>Прогноз</th>
                  <th rowSpan={2} scope="col" className="min-w-[190px] border-b border-l border-neutral-200 bg-white px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500 lg:sticky lg:right-0 lg:z-30">Действия</th>
                </tr>
                <tr className="[&>th]:border-b [&>th]:border-neutral-200">
                  <Th tip="Сколько изделий заложено в бюджет" className={sepL}>Бюджет, шт.</Th>
                  <Th tip="Сколько шкур уходит на одно изделие">Шкур/изд.</Th>
                  <Th tip="Бюджет изделий × шкур на изделие">Всего шкур</Th>
                  <Th tip="Цена одной шкуры, ₽. Зелёный процент слева — применённая надбавка; жирный и подчёркнутый — задана на этой строке. Ручная правка закрывает замок" className={sepL}>Цена шкуры, ₽</Th>
                  <Th tip="Подкладка, метров на одно изделие">Подкл., м/изд.</Th>
                  <Th tip="Цена подкладки за метр, ₽">Цена, ₽/м</Th>
                  <Th tip="Стоимость работы на одно изделие, ₽">Работа/изд., ₽</Th>
                  <Th tip="Мех = всего шкур × цена шкуры" className={sepL}>Мех</Th>
                  <Th tip="Подкладка = бюджет × м на изделие × цена за метр">Подкладка</Th>
                  <Th tip="Работа = бюджет × работа на изделие">Работа</Th>
                  <Th tip="Надбавка на мех и подкладку (по умолчанию 4%)">4%</Th>
                  <Th tip="Мех + подкладка + работа + 4%">Всего, ₽</Th>
                  <Th tip="Всего, ₽ ÷ бюджет изделий. Под цифрой Var — бюджет к текущим ценам системы (без надбавок, с 4%)">На 1 изд.</Th>
                </tr>
              </thead>
              <tbody>
                {totalRowDetail}
                {tableRows(null, 0)}
              </tbody>
            </table>
          </div>
          <div className={(view === "detail" ? "md:hidden " : "hidden ") + "flex flex-col gap-2 print:hidden"}>{cards(null, 0)}</div>
        </>
      )}

      {renaming ? <EditCardDialog name={p.name} season={p.season} onClose={() => setRenaming(false)} onSave={async (name, seasonV) => { const r = await renameBudget(p.id, name, seasonV); if (r.ok) { setRenaming(false); router.refresh(); } return r.ok ? null : r.error ?? "Не удалось сохранить"; }} /> : null}
      {adding ? (
        <AddDialog kind={adding.kind} names={adding.kind === "fur" ? p.furNames : p.catNames} articles={p.articles} taken={takenIn(adding.kind, adding.parentId)}
          catName={adding.kind === "art" && adding.parentId ? (byId.get(adding.parentId)?.statCat || byId.get(adding.parentId)?.name) : undefined}
          context={adding.kind === "art" && adding.parentId ? `Артикул добавится в «${byId.get(adding.parentId)?.name}» (${byId.get(byId.get(adding.parentId)?.parentId ?? "")?.name ?? "тип сырья"}). Выберите из списка системы или создайте новый плановый.` : undefined}
          onClose={() => setAdding(null)} onPick={(v) => addNode(adding.kind, adding.parentId, v)} />
      ) : null}
      {statFor && byId.get(statFor) ? (
        <Modal title={`Данные системы: ${byId.get(statFor)?.name}`} onClose={() => setStatFor(null)}>
          <p className="mb-2 text-xs text-neutral-500">{srcInfo(byId.get(statFor)!).label}. Выберите, по какой статистике «мех × категория» считать эту категорию. «По названию» — мех блока и название категории.</p>
          <select aria-label="Статистика системы" className={FIELD} value={`${byId.get(statFor)?.statFur ?? ""}|${byId.get(statFor)?.statCat ?? ""}`} onChange={(e) => { setStat(statFor, e.target.value); setStatFor(null); }}>
            <option value="|">По названию</option>
            {byId.get(statFor)?.statFur && !pairOptions.some((x) => x.key === `${byId.get(statFor)?.statFur}|${byId.get(statFor)?.statCat}`) ? <option value={`${byId.get(statFor)?.statFur}|${byId.get(statFor)?.statCat}`}>{byId.get(statFor)?.statFur} · {byId.get(statFor)?.statCat}</option> : null}
            {pairOptions.map((x) => <option key={x.key} value={x.key}>{x.fur} · {x.cat} ({x.qty} изд.)</option>)}
          </select>
        </Modal>
      ) : null}
      {upAll ? (
        <Modal title="Надбавки по типам меха и категориям" onClose={() => setUpAll(false)} wide>
          <p className="mb-3 text-xs text-neutral-500">Пустое поле — с уровня выше. Общие надбавки версии: {formatPercent(params.upFur)} / {formatPercent(params.upLining)} / {formatPercent(params.upWork)}.<InfoHint label="Как работают надбавки" wide><p>Пустое поле — берётся с уровня выше (в подсказке поля то, что действует сейчас). 0 — без надбавки. Строки с замком не пересчитываются.</p></InfoHint></p>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white"><tr className="border-b border-neutral-200 text-left text-xs text-neutral-500"><th className="py-1 font-medium">Тип меха · категория</th><th className="w-20 px-1 text-right font-medium">Шкура, %</th><th className="w-20 px-1 text-right font-medium">Подкладка, %</th><th className="w-20 px-1 text-right font-medium">Работа, %</th></tr></thead>
              <tbody>
                {nodes.filter((n) => n.kind === "fur" || n.kind === "cat").map((n) => {
                  const par = n.parentId ? byId.get(n.parentId) : undefined;
                  const inh = par ? effUp(par, byId, params) : null;
                  return (
                    <tr key={n.id} className={"border-t border-neutral-100 " + (n.kind === "fur" ? "bg-neutral-50 font-semibold" : "")}>
                      <td className={"py-1 pr-2 " + (n.kind === "cat" ? "pl-4 font-normal" : "")}>{n.name}{n.locked ? <span className="ml-1 text-[11px]" title="Замок: не пересчитывается">🔒</span> : null}</td>
                      {(["upFur", "upLining", "upWork"] as const).map((k) => {
                        const cur = inh ? (k === "upFur" ? inh.fur : k === "upLining" ? inh.lining : inh.work) : params[k];
                        return (
                          <td key={k} className="px-1 py-0.5">
                            <input type="text" inputMode="decimal" defaultValue={typeof n[k] === "number" ? String(n[k]).replace(".", ",") : ""} placeholder={String(cur).replace(".", ",")} aria-label={`${n.name}: ${k === "upFur" ? "шкура" : k === "upLining" ? "подкладка" : "работа"}, %`}
                              onChange={(e) => { const t = e.target.value.trim().replace(",", "."); const x = Number(t); setUp(n.id, k, t === "" || !Number.isFinite(x) ? null : x); }}
                              className="ui-field w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus-visible:outline-none" />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3"><button type="button" className={BTN_PRIMARY} onClick={() => setUpAll(false)}>Готово</button></div>
        </Modal>
      ) : null}
      {upNode ? (
        <Modal title={`Надбавки: ${upNode.name}`} onClose={() => setUpFor(null)}>
          <p className="mb-3 text-xs text-neutral-500">Для этой строки и всего, что внутри. Пустое поле — с уровня выше.<InfoHint label="Как работают надбавки" wide><p>Пустое поле — берётся с уровня выше (в подсказке поля то, что действует сейчас). 0 — без надбавки.</p></InfoHint></p>
          <div className="grid grid-cols-3 gap-3">
            {([["upFur", "Шкура, %"], ["upLining", "Подкладка, %"], ["upWork", "Работа, %"]] as const).map(([k, label]) => {
              const parent = upNode.parentId ? byId.get(upNode.parentId) : undefined;
              const inh = parent ? effUp(parent, byId, params) : null;
              const cur = inh ? (k === "upFur" ? inh.fur : k === "upLining" ? inh.lining : inh.work) : params[k];
              return (
                <label key={k} className="flex flex-col gap-1 text-xs text-neutral-500">{label}
                  <input type="text" inputMode="decimal" defaultValue={typeof upNode[k] === "number" ? String(upNode[k]).replace(".", ",") : ""} placeholder={String(cur).replace(".", ",")} aria-label={label}
                    onChange={(e) => { const t = e.target.value.trim().replace(",", "."); const x = Number(t); setUp(upNode.id, k, t === "" || !Number.isFinite(x) ? null : x); }}
                    className={FIELD + " text-right"} />
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3"><button type="button" className={BTN_PRIMARY} onClick={() => setUpFor(null)}>Готово</button></div>
        </Modal>
      ) : null}
      {preview ? (
        <Modal title="Загрузка из файла" onClose={() => setPreview(null)} wide>
          <p className="text-sm text-neutral-800">Файл «{preview.fileName}»{preview.sheet ? `, лист «${preview.sheet}»` : ""}: будет добавлено или обновлено <b>{preview.rows.length}</b> строк.</p>
          <p className="mt-1 text-xs text-neutral-500">
            {importStats ? `Новых типов сырья: ${importStats.newFurs}. Уже есть в бюджете (значения обновятся): ${importStats.exist}.` : ""}
            {importStats?.lynx ? ` Строки «Рысь» (${importStats.lynx}) после загрузки закроются замком.` : ""} Остальные строки бюджета не меняются; цены без значений в файле заполнятся по данным системы.
          </p>
          {preview.warnings.length ? <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">{preview.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}</ul> : null}
          <div className="mt-3 max-h-[40vh] overflow-auto rounded-md border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-neutral-500 [&>tr]:border-b [&>tr]:border-neutral-200"><tr><th className="px-2 py-1 text-left font-medium">Тип сырья</th><th className="px-2 py-1 text-left font-medium">Категория</th><th className="px-2 py-1 text-right font-medium">Бюджет, шт.</th><th className="px-2 py-1 text-left font-medium">Значения</th></tr></thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-t border-neutral-100"><td className="px-2 py-1">{r.fur}</td><td className="px-2 py-1">{r.cat}</td><td className="px-2 py-1 text-right tabular-nums">{r.pcs}</td>
                    <td className="px-2 py-1 text-neutral-500">{[r.hides, r.hidePrice, r.meters, r.meterPrice, r.work].some((v) => v != null) ? "из файла" : normKey(r.fur) === "рысь" ? "ручные (рысь)" : "по данным системы"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3 gap-2">
            <button type="button" className={BTN} onClick={() => setPreview(null)}>Отмена</button>
            <button type="button" className={BTN_PRIMARY} onClick={applyImport}>Добавить {preview.rows.length} строк</button>
          </div>
        </Modal>
      ) : null}
      {removing ? (
        <Modal title="Удалить строку?" onClose={() => setRemoving(null)}>
          <p className="text-sm text-neutral-700">«{byId.get(removing)?.name}» будет удалена{(kids.get(removing) ?? []).length ? " вместе со всеми вложенными строками" : ""}. Введённые значения пропадут.</p>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3 gap-2">
            <button type="button" className={BTN} onClick={() => setRemoving(null)}>Отмена</button>
            <button type="button" className="inline-flex min-h-10 items-center rounded-lg bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 md:min-h-8" onClick={() => removeNode(removing)}>Удалить</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function EditCardDialog({ name, season, onClose, onSave }: { name: string; season: string; onClose: () => void; onSave: (name: string, season: string) => Promise<string | null> }) {
  const [n, setN] = useState(name);
  const [se, setSe] = useState(season);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Карточка бюджета" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Название<input autoFocus value={n} onChange={(e) => setN(e.target.value)} className={FIELD} maxLength={80} /></label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Сезон<input value={se} onChange={(e) => setSe(e.target.value)} className={FIELD} maxLength={20} /></label>
        {err ? <p role="alert" className="text-xs text-red-700">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose}>Отмена</button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !n.trim()} onClick={async () => { setBusy(true); setErr(await onSave(n, se)); setBusy(false); }}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}
