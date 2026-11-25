"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatPercent, formatMoney, formatMoneySigned } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { WidgetRow } from "@/components/widget-row";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { addAgg, autoCalc, collapseUnknownLengths, blankNode, childrenMap, computeTree, effLocked, grandTotal, isAccessoryCat, normKey, reapplyParams, type BudgetNode, type BudgetParams, type BudgetStat } from "@/lib/budget-calc";
import { exportBudgetXlsx, parseBudgetFile, refreshBudgetStats, renameBudget, saveBudget, type ImportRow } from "./actions";
import { AddDialog, type AddKind, type ArticleOpt } from "./add-dialog";
import { BTN, BTN_PRIMARY, Modal, NumInput, SEG_BOX, segBtn } from "./ui";
import { CatCard } from "./_budget-editor/cat-card";
import { EditCardDialog } from "./_budget-editor/edit-card-dialog";
import { ImportPreviewModal, StatModal, UpAllModal, UpNodeModal } from "./_budget-editor/modals";
import { buildImportedNodes, scopeNodes } from "./_budget-editor/nodes-logic";
import { ZERO, type NumKey, type UpKey } from "./_budget-editor/parts";
import { makeRowKit } from "./_budget-editor/row-kit";
import { DetailHead, SummaryHead, TotalRowDetail, UnitHead } from "./_budget-editor/table-heads";
import { TotalTiles } from "./_budget-editor/total-tiles";
import { makeTreeRows } from "./_budget-editor/tree-rows";

type Props = {
  id: string; name: string; season: string; status: "DRAFT" | "APPROVED"; initialComment: string; initialParams: BudgetParams; initialNodes: BudgetNode[];
  initialStats: BudgetStat[]; furNames: string[]; catNames: string[]; catGroups: Record<string, string>; articles: ArticleOpt[]; canEdit: boolean; savedAt: string; savedBy: string | null; createdAt: string;
};

export function BudgetEditor(p: Props) {
  const router = useRouter();
  const { ask: askConfirm, node: confirmNode } = useConfirm();
  const [params, setParams] = useState(p.initialParams);
  const [nodes, setNodes] = useState(p.initialNodes);
  const [comment, setComment] = useState(p.initialComment);
  const [stats, setStats] = useState(p.initialStats);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">("saved");
  const [reverting, setReverting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const status = p.status;
  const [view, setView] = useState<"summary" | "detail" | "unit">("summary");
  // Показ по виду изделий: все / одежда / аксессуары. Выбор помнится в браузере, адрес не меняется.
  const [scope, setScope] = useState<"all" | "cloth" | "acc">("all");
  useEffect(() => { try { const v = localStorage.getItem("budget-scope"); if (v === "cloth" || v === "acc") queueMicrotask(() => setScope(v)); } catch {} }, []);
  const pickScope = (v: "all" | "cloth" | "acc") => { setScope(v); try { localStorage.setItem("budget-scope", v); } catch {} };
  const scopeName = scope === "cloth" ? "Одежда" : scope === "acc" ? "Аксессуары" : "";
  // Мелкие подписи под цифрами («ср. …», «% заказа»): один флаг на таблицу, выбор помнится в браузере.
  const [subOn, setSubOn] = useState(true);
  useEffect(() => { try { if (localStorage.getItem("budget-sub-captions") === "0") queueMicrotask(() => setSubOn(false)); } catch {} }, []);
  const toggleSub = (v: boolean) => { setSubOn(v); try { localStorage.setItem("budget-sub-captions", v ? "1" : "0"); } catch {} };
  const [renaming, setRenaming] = useState(false);
  const [updatedAtState, setUpdatedAtState] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ kind: AddKind; parentId: string | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [statFor, setStatFor] = useState<string | null>(null);
  const [upFor, setUpFor] = useState<string | null>(null);
  const [upAll, setUpAll] = useState(false);
  /** Категория, открытая окном «На 1 изделие»: сравнение длин и расходы на одно изделие. */
  const [unitFor, setUnitFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rows: ImportRow[]; warnings: string[]; sheet: string; fileName: string } | null>(null);
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = p.canEdit && status === "DRAFT";

  // Сохранение: явная кнопка «Сохранить». Пока не сохранено, правки лежат черновиком в этом браузере (localStorage) и восстанавливаются при возврате.
  const snapOf = (pr: BudgetParams, ns: BudgetNode[], cm: string) => JSON.stringify([pr, ns, cm]);
  const [savedSnap, setSavedSnap] = useState(() => snapOf(p.initialParams, p.initialNodes, p.initialComment));
  const savedVals = useRef({ params: p.initialParams, nodes: p.initialNodes, comment: p.initialComment });
  const draftKey = `budget-draft:${p.id}`;
  const curSnap = useMemo(() => snapOf(params, nodes, comment), [params, nodes, comment]);
  const dirty = canEdit && curSnap !== savedSnap;

  useEffect(() => {
    if (!canEdit) return;
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(draftKey);
        if (!raw) return;
        const d = JSON.parse(raw) as { base: string; params: BudgetParams; nodes: BudgetNode[]; comment: string };
        if (d.base !== savedSnap || snapOf(d.params, d.nodes, d.comment) === savedSnap) { localStorage.removeItem(draftKey); return; }
        setParams(d.params); setNodes(d.nodes); setComment(d.comment);
        setMsg("Восстановлен несохранённый черновик из этого браузера. Нажмите «Сохранить» или «Отменить изменения».");
      } catch { /* черновик не читается — работаем с сохранённой версией */ }
    }, 0);
    return () => clearTimeout(t);
    // только при открытии страницы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!canEdit) return;
    const t = setTimeout(() => {
      try {
        if (curSnap === savedSnap) localStorage.removeItem(draftKey);
        else localStorage.setItem(draftKey, JSON.stringify({ base: savedSnap, params, nodes, comment }));
      } catch { /* браузер не даёт хранить черновик — не страшно */ }
    }, 500);
    return () => clearTimeout(t);
  }, [curSnap, savedSnap, params, nodes, comment, canEdit, draftKey]);

  const save = async () => {
    if (!canEdit || saveState === "saving") return;
    const snap = curSnap;
    const vals = { params, nodes, comment };
    setSaveState("saving"); setSaveError(null);
    try {
      const r = await saveBudget(p.id, vals.params, vals.nodes, vals.comment);
      if (r.ok) { savedVals.current = vals; setSavedSnap(snap); setUpdatedAtState(r.at); setSaveState("saved"); setMsg(null); }
      else { setSaveState("error"); setSaveError(r.error); }
    } catch { setSaveState("error"); setSaveError("Нет связи с сервером"); }
  };
  const revert = () => {
    const v = savedVals.current;
    setParams(v.params); setNodes(v.nodes); setComment(v.comment);
    setSaveState("saved"); setSaveError(null); setReverting(false); setMsg("Изменения отменены: возвращена последняя сохранённая версия.");
    try { localStorage.removeItem(draftKey); } catch { /* не страшно */ }
  };

  // Уход со страницы с несохранёнными изменениями: закрытие вкладки и переходы по ссылкам внутри приложения.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin || a.pathname === window.location.pathname) return;
      if (!window.confirm("Есть несохранённые изменения. Уйти без сохранения? (Черновик останется в этом браузере.)")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true); };
  }, [dirty]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const kids = useMemo(() => childrenMap(nodes), [nodes]);
  // Показ «Все / Одежда / Аксессуары»: только фильтр отображения, сохраняемые узлы не меняются.
  const vNodes = useMemo(() => scopeNodes(nodes, scope, p.catGroups), [nodes, scope, p.catGroups]);
  const vKids = useMemo(() => childrenMap(vNodes), [vNodes]);
  const fullCalc = useMemo(() => computeTree(nodes, params), [nodes, params]);
  const fullTotal = useMemo(() => grandTotal(nodes, params), [nodes, params]);
  const calc = useMemo(() => computeTree(vNodes, params), [vNodes, params]);
  const total = useMemo(() => grandTotal(vNodes, params), [vNodes, params]);
  const furs = useMemo(() => kids.get(null) ?? [], [kids]);
  const pairOptions = useMemo(() => stats.filter((s) => !s.modelId), [stats]);

  const setParam = (k: keyof BudgetParams, v: number) => {
    const np = { ...params, [k]: v };
    setParams(np);
    setNodes((ns) => reapplyParams(ns, np));
  };
  const setUp = (id: string, k: UpKey, v: number | null) => setNodes((ns) => reapplyParams(ns.map((n) => (n.id === id ? { ...n, [k]: v } : n)), params));
  const patch = useCallback((id: string, pt: Partial<BudgetNode>) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...pt } : n))), []);
  const editNum = (id: string, k: NumKey, v: number) => patch(id, k === "pcs" ? { pcs: v } : { [k]: v, locked: true, src: "manual", est: undefined });
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

  const addNode = (kind0: AddKind, parentId: string | null, v: { name: string; modelId: string | null; kind?: AddKind }) => {
    const kind = v.kind ?? kind0;
    // Первая длина в категории без деталей берёт штуки категории: итог не теряется (потом их можно разложить по длинам).
    const par = parentId ? byId.get(parentId) : undefined;
    const inherit = kind === "len" && par && par.kind === "cat" && (kids.get(par.id) ?? []).length === 0 ? par.pcs : 0;
    const n = blankNode(kind, parentId, v.name, { modelId: v.modelId, pcs: inherit });
    setNodes((ns) => autoCalc([...ns, n], stats, params, n.id));
    if (parentId) setCollapsed((c) => { const x = new Set(c); x.delete(parentId); return x; });
    setAdding(null);
  };
  const removeNode = (id: string) => {
    const drop = new Set<string>([id]);
    for (let i = 0; i < 5; i++) for (const n of nodes) if (n.parentId && drop.has(n.parentId)) drop.add(n.id);
    setNodes((ns) => ns.filter((n) => !drop.has(n.id)));
    setRemoving(null);
  };
  const toggle = (id: string) => setCollapsed((c) => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const expandAll = () => setCollapsed(new Set());
  const hasArt = nodes.some((n) => n.kind === "art");
  const collapseAll = () => setCollapsed(new Set(nodes.filter((n) => n.kind !== "art" && (kids.get(n.id) ?? []).some((c) => c.kind === "art")).map((n) => n.id)));
  const collapseToFurs = () => setCollapsed(new Set(furs.map((f) => f.id)));

  const runAuto = (scopeId?: string) => startBusy(async () => {
    try {
      const fresh = await refreshBudgetStats();
      setStats(fresh);
      const before = nodes;
      const next = autoCalc(before, fresh, params, scopeId); // временная копия: в состояние — только после «Применить»
      const hasKid = new Set(before.map((n) => n.parentId));
      const inScope = (n: BudgetNode) => { let c: BudgetNode | undefined = n; for (let i = 0; c && i < 5; i++) { if (!scopeId || c.id === scopeId) return true; c = c.parentId ? byId.get(c.parentId) : undefined; } return false; };
      const leaves = next.filter((n) => n.kind !== "fur" && !hasKid.has(n.id) && inScope(n));
      const locked = leaves.filter((n) => effLocked(n, byId)).length;
      const nodata = leaves.filter((n) => !effLocked(n, byId) && n.src === "none").length;
      const prevTotal = grandTotal(before, params).total;
      const nextTotal = grandTotal(next, params).total;
      const changed = next.filter((n, i) => {
        const o = before[i];
        return o.hides !== n.hides || o.hidePrice !== n.hidePrice || o.meters !== n.meters || o.meterPrice !== n.meterPrice || o.work !== n.work || o.src !== n.src;
      }).length;
      const delta = nextTotal - prevTotal;
      const furOf = (n: BudgetNode) => { let c: BudgetNode | undefined = n; for (let i = 0; c && i < 5; i++) { if (c.kind === "fur") return c.name; c = c.parentId ? byId.get(c.parentId) : undefined; } return n.name; };
      const lockedNames = Array.from(new Set(leaves.filter((n) => effLocked(n, byId)).map(furOf)));
      const ok = await askConfirm(
        <div className="space-y-1">
          <div className="font-semibold">Автоматический расчёт{scopeId ? " блока" : ""}</div>
          <div>Итог: было {formatMoney(prevTotal)} → станет {formatMoney(nextTotal)} ({formatMoneySigned(delta)})</div>
          <div>Изменится строк: {changed}. С замком, не тронуты: {locked}{lockedNames.length ? ` (${lockedNames.slice(0, 4).join(", ")} заперт${lockedNames.length > 1 ? "ы" : "а"})` : ""}.</div>
          <div className="text-xs text-neutral-500">Это черновик: в базу попадёт после «Сохранить».</div>
        </div>,
        { ok: "Применить" },
      );
      if (!ok) return;
      setNodes(next);
      const byArt = leaves.filter((n) => !effLocked(n, byId) && n.src === "art").length;
      const byLen = leaves.filter((n) => !effLocked(n, byId) && n.src === "len").length;
      setMsg(`Пересчитано по данным системы: ${leaves.length - locked} строк${byArt || byLen ? ` (${[byArt ? `по ТЗ артикула: ${byArt}` : "", byLen ? `по длине: ${byLen}` : ""].filter(Boolean).join(", ")})` : ""}.${locked ? ` С замком, не тронуты: ${locked}.` : ""}${nodata ? ` Нет данных в системе: ${nodata}.` : ""}`);
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
    const ns = buildImportedNodes(nodes, preview.rows, stats, params);
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
  /** Что можно добавить внутрь узла: у типа сырья — категорию; у категории — артикул и/или длину (длина — не у аксессуаров; артикулы и длины в одной категории не смешиваются); у длины — артикул. */
  const addInfo = (n: BudgetNode) => {
    const ch = kids.get(n.id) ?? [];
    const lenOk = n.kind === "cat" && !isAccessoryCat(n, p.catGroups);
    const hasLen = ch.some((c) => c.kind === "len");
    const lenMode: "both" | "only" | undefined = lenOk && hasLen ? "only" : lenOk && !ch.some((c) => c.kind === "art") ? "both" : undefined;
    const label = n.kind === "fur" ? "категория" : lenMode === "only" ? "длина" : lenMode === "both" ? "артикул / длина" : "артикул";
    return { lenMode, label };
  };
  const catOf = (id: string) => { let c = byId.get(id); for (let i = 0; c && c.kind !== "cat" && i < 4; i++) c = c.parentId ? byId.get(c.parentId) : undefined; return c; };
  const pathLabel = (id: string) => { const n = byId.get(id); const par = n?.parentId ? byId.get(n.parentId) : undefined; const cat = catOf(id); const fur = cat?.parentId ? byId.get(cat.parentId) : undefined; return n?.kind === "len" ? `${fur?.name ?? "тип сырья"} × ${cat?.name} × ${n.name}` : `${n?.name} (${par?.name ?? "тип сырья"})`; };
  const takenIn = (kind: AddKind, parentId: string | null) =>
    (kids.get(parentId) ?? []).filter((n) => n.kind === kind).map((n) => (kind === "art" ? (n.modelId ?? "") : n.name.toLowerCase()));

  // ---- Мелкие элементы строки
  // «На 1 изделие» считаем отдельно для одежды и аксессуаров: у них разная стоимость, общее среднее вводит в заблуждение.
  const kindAgg = useMemo(() => {
    const r = { cloth: { ...ZERO }, acc: { ...ZERO } };
    for (const c of nodes) if (c.kind === "cat") { const a = fullCalc.get(c.id); if (a) { const k = isAccessoryCat(c, p.catGroups) ? "acc" : "cloth"; r[k] = addAgg(r[k], a); } }
    return r;
  }, [nodes, fullCalc, p.catGroups]);

  // ---- Мелкие элементы строки и строки таблиц (вынесены в _budget-editor/row-kit.tsx и tree-rows.tsx)
  const kit = makeRowKit({ canEdit, busy, byId, kids, params, toggle, toggleLock, runAuto, setUpFor, setAdding, setRemoving, removeNode, setStatFor, patch, editNum, addInfo });
  const { sumRow, summaryRows, unitRows, tableRows, cards } = makeTreeRows({ vKids, calc, collapsed, total, setUnitFor, canEdit, patch, kit });

  // ---- Плитки (как на Главной: TILE_BOX + Tile*, у всех по три строки — строки соседних плиток на одной горизонтали)
  const totalTiles = <TotalTiles fullTotal={fullTotal} fullCalc={fullCalc} furs={furs} kindAgg={kindAgg} params={params} />;

  const savedTime = new Date(updatedAtState ?? p.savedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  const saveText = !canEdit ? (status === "APPROVED" ? "Утверждён: только просмотр" : "Только просмотр")
    : saveState === "saving" ? "Сохраняю…" : saveState === "error" ? `Не удалось сохранить${saveError ? `: ${saveError}` : ""}` : dirty ? "Есть несохранённые изменения" : `Сохранено ${savedTime}`;
  const upNode = upFor ? byId.get(upFor) : null;

  return (
    <div className="flex flex-col gap-4">
      <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } } [data-sub=\"off\"] .sub-cap { display: none; }"}</style>
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{p.name}</h1>
            {p.season !== p.name ? <span className="text-sm text-neutral-500">{p.season}</span> : null}
            {canEdit ? (
              <button type="button" onClick={() => setRenaming(true)} aria-label="Редактировать карточку бюджета" title="Редактировать карточку бюджета: название и сезон" data-touch-ok
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900">
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
              </button>
            ) : null}
          </div>
          <p className={"mt-0.5 text-xs " + (dirty || saveState === "error" ? "font-medium text-amber-700" : "text-neutral-600")} role="status">{saveText}</p>
        </div>
        {staff ? (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? <button type="button" onClick={save} disabled={saveState === "saving" || (!dirty && saveState !== "error")} className={dirty || saveState === "error" ? BTN_PRIMARY : BTN}>{saveState === "saving" ? "Сохраняю…" : "Сохранить"}</button> : null}
            {canEdit && dirty ? <button type="button" onClick={() => setReverting(true)} className={BTN}>Отменить изменения</button> : null}
            {canEdit ? <button type="button" onClick={() => runAuto()} disabled={busy} className={BTN}>{busy ? "Считаю…" : "Автоматический расчёт"}</button> : null}
            {canEdit ? <button type="button" disabled={busy} title="Убрать деление на Short / Regular / Long там, где по какой-то длине нет данных в системе: останется итог по категории" onClick={() => setNodes((ns) => collapseUnknownLengths(ns, stats, params).nodes)} className={BTN}>Убрать длины без данных</button> : null}
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
          <WidgetRow id="budget-totals" title="Итоги">{totalTiles}</WidgetRow>
        </div>
        <aside aria-label="Надбавки" className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 print:hidden">
          <div className="flex items-center gap-1 self-center text-sm font-medium">Надбавки, %
            <InfoHint label="Что такое надбавки" wide>
              <p>Автоматический расчёт берёт из системы средневзвешенные цены и увеличивает на заданный процент: цену шкуры, цену подкладки и стоимость работы. Любой процент, в том числе 0.</p>
              <p className="mt-1">Здесь — общие надбавки версии. Свои надбавки можно задать на типе меха и на категории внутри него: кнопка «Надбавки по типам и категориям» ниже или «%» у строки. Пусто — берётся с уровня выше.</p>
            </InfoHint>
          </div>
          <div className="flex gap-2">
            {([["upFur", "Шкура"], ["upLining", "Подкладка"], ["upWork", "Работа"], ["c4", "4 % на сырьё"]] as const).map(([k, label]) => (
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="block-title">Состав бюджета
            <InfoHint label="Как считается бюджет" wide>
              <p>Изделий × (шкур × цена шкуры + подкладка, м × цена за м + работа) + {formatPercent(params.c4)} на мех и подкладку.</p>
              <p className="mt-1">Мелкие «ср.» под суммами — средневзвешенные: цена шкуры, цена метра, работа и надбавка на изделие, шкур на изделие. Если у категории есть артикулы, её итог — сумма артикулов.</p>
              <p className="mt-1">Точка у строки — качество данных: зелёная — достаточно данных системы, жёлтая — малая выборка, красная — нет данных, серая — вручную. Закрытый замок — строка ручная.</p>
            </InfoHint>
          </h2>
          <div role="group" aria-label="Режим таблицы" className={SEG_BOX}>
            {([["summary", "Сводка"], ["detail", "Детально"], ["unit", "На 1 изделие"]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                className={segBtn(view === v)}>{l}</button>
            ))}
          </div>
          <div role="group" aria-label="Показать" className={SEG_BOX}>
            {([["all", "Все"], ["cloth", "Одежда"], ["acc", "Аксессуары"]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => pickScope(v)} aria-pressed={scope === v}
                className={segBtn(scope === v)}>{l}</button>
            ))}
          </div>
          <label title="Мелкие подписи под суммами: среднее за шкуру, за метр, на изделие" className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 text-xs text-neutral-600 md:min-h-0">
            <input type="checkbox" checked={subOn} onChange={(e) => toggleSub(e.target.checked)} className="h-4 w-4" />Средние
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" onClick={expandAll} className="inline-flex min-h-10 items-center text-neutral-600 hover:underline md:min-h-0">Развернуть всё</button>
          <button type="button" onClick={collapseToFurs} className="inline-flex min-h-10 items-center text-neutral-600 hover:underline md:min-h-0">Только типы сырья</button>
          <button type="button" onClick={collapseAll} disabled={!hasArt} title={hasArt ? "Свернуть категории: артикулы скроются" : "В бюджете пока нет артикулов"} className="hidden min-h-10 items-center text-neutral-600 hover:underline disabled:cursor-not-allowed disabled:text-neutral-500 disabled:no-underline md:min-h-0 xl:inline-flex">Скрыть артикулы</button>
          <button type="button" onClick={downloadXlsx} disabled={busy} className={BTN}>Скачать Excel</button>
          <button type="button" onClick={() => window.print()} className={BTN}>Печать</button>
        </div>
      </div>

      {scopeName ? <p className="hidden text-xs text-neutral-600 print:block">Показано: {scopeName}. Сохранённый бюджет включает все позиции.</p> : null}
      {nodes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Бюджет пуст. {canEdit ? "Нажмите «+ Тип сырья» и добавьте категории и артикулы либо «Загрузить из файла»." : ""}
        </div>
      ) : (
        <>
          <div className={(view === "summary" ? "" : view === "unit" ? "hidden " : "hidden print:block ") + "max-h-[78vh] overflow-auto rounded-lg border border-neutral-200 bg-white print:max-h-none print:overflow-visible print:border-0"}>
            <table data-sub={subOn ? "on" : "off"} className="w-full min-w-[980px] xl:min-w-0 border-separate border-spacing-0 text-left print:min-w-0 print:w-full print:text-[11px]">
              <SummaryHead />
              <tbody>
                {sumRow("total", <><TotalLabel />{scopeName ? <span className="font-normal"> · {scopeName}</span> : null}</>, total, { bg: "row-total", bold: true })}
                {summaryRows(null, 0)}
                {sumRow("total-bottom", <><TotalLabel />{scopeName ? <span className="font-normal"> · {scopeName}</span> : null}</>, total, { bg: "row-total", bold: true })}
              </tbody>
            </table>
          </div>

          <div className={(view === "unit" ? "" : "hidden ") + "print:hidden"}>
            <div className="mb-2 flex flex-wrap items-center justify-end gap-2 text-xs text-neutral-500">
              <span>Нажмите на категорию: сравнение длин и расходы на 1 изделие.</span>
              {canEdit ? <button type="button" onClick={() => setUpAll(true)} className={BTN}>Надбавки…</button> : null}
            </div>
            <div className="max-h-[78vh] overflow-auto rounded-lg border border-neutral-200 bg-white">
              <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left">
                <UnitHead params={params} />
                <tbody>{unitRows(null, 0)}</tbody>
              </table>
            </div>
          </div>
          <div className={(view === "detail" ? "hidden md:block " : "hidden ") + "max-h-[78vh] overflow-auto rounded-lg border border-neutral-200 bg-white print:hidden"}>
            <table data-sub={subOn ? "on" : "off"} className="w-max min-w-full border-separate border-spacing-0 text-left">
              <DetailHead />
              <tbody>
                <TotalRowDetail total={total} scopeName={scopeName} />
                {tableRows(null, 0)}
              </tbody>
            </table>
          </div>
          <div className={(view === "detail" ? "md:hidden " : "hidden ") + "flex flex-col gap-2 print:hidden"}>{cards(null, 0)}</div>
        </>
      )}

      {confirmNode}
      {renaming ? <EditCardDialog name={p.name} season={p.season} onClose={() => setRenaming(false)} onSave={async (name, seasonV) => { const r = await renameBudget(p.id, name, seasonV); if (r.ok) { setRenaming(false); router.refresh(); } return r.ok ? null : r.error ?? "Не удалось сохранить"; }} /> : null}
      {adding ? (
        <AddDialog kind={adding.kind} names={adding.kind === "fur" ? p.furNames : p.catNames} articles={p.articles} taken={takenIn(adding.kind, adding.parentId)}
          catName={adding.kind === "art" && adding.parentId ? (catOf(adding.parentId)?.statCat || catOf(adding.parentId)?.name) : undefined}
          lenMode={adding.kind === "art" && adding.parentId && byId.get(adding.parentId)?.kind === "cat" ? addInfo(byId.get(adding.parentId)!).lenMode : undefined}
          takenLens={adding.parentId ? takenIn("len", adding.parentId) : undefined}
          pairLabel={adding.parentId ? `${byId.get(byId.get(adding.parentId)?.parentId ?? "")?.name ?? "тип сырья"} × ${byId.get(adding.parentId)?.name}` : undefined}
          context={adding.kind === "art" && adding.parentId ? `Артикул добавится в «${pathLabel(adding.parentId)}». Выберите из списка системы или создайте новый плановый.` : undefined}
          onClose={() => setAdding(null)} onPick={(v) => addNode(adding.kind, adding.parentId, v)} />
      ) : null}
      {statFor && byId.get(statFor) ? <StatModal statFor={statFor} byId={byId} pairOptions={pairOptions} setStat={setStat} setStatFor={setStatFor} /> : null}
      {unitFor && byId.get(unitFor) ? (
        <Modal title={`${byId.get(byId.get(unitFor)!.parentId ?? "")?.name ?? ""} · ${byId.get(unitFor)!.name}: на 1 изделие`} onClose={() => setUnitFor(null)} xl>
          <CatCard cat={byId.get(unitFor)!} byId={byId} vKids={vKids} calc={calc} params={params} />
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3"><button type="button" className={BTN_PRIMARY} onClick={() => setUnitFor(null)}>Закрыть</button></div>
        </Modal>
      ) : null}
      {upAll ? <UpAllModal kids={kids} byId={byId} params={params} setUp={setUp} setUpAll={setUpAll} /> : null}
      {upNode ? <UpNodeModal upNode={upNode} byId={byId} params={params} setUp={setUp} setUpFor={setUpFor} /> : null}
      {preview ? <ImportPreviewModal preview={preview} importStats={importStats} setPreview={setPreview} applyImport={applyImport} /> : null}
      {reverting ? (
        <Modal title="Отменить изменения?" onClose={() => setReverting(false)}>
          <p className="text-sm text-neutral-700">Все правки после последнего сохранения ({savedTime}) пропадут, бюджет вернётся к сохранённой версии.</p>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3 gap-2">
            <button type="button" className={BTN} onClick={() => setReverting(false)}>Не отменять</button>
            <button type="button" className="inline-flex min-h-10 items-center rounded-lg bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 md:min-h-8" onClick={revert}>Отменить изменения</button>
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
