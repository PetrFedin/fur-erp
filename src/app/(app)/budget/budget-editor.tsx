"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { WidgetRow } from "@/components/widget-row";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../dashboard/tile";
import {
  autoCalc, blankNode, childrenMap, computeTree, effLocked, grandTotal, nowPerUnit, perUnit, reapplyParams, srcInfo, varPct,
  type Agg, type BudgetNode, type BudgetParams, type BudgetStat,
} from "@/lib/budget-calc";
import { refreshBudgetStats, saveBudget, setBudgetStatus } from "./actions";
import { AddDialog, type AddKind, type ArticleOpt } from "./add-dialog";
import { BTN, BTN_PRIMARY, Badge, FIELD, Modal, NumInput, money, pct, qty, share } from "./ui";

type Props = {
  id: string; name: string; season: string; status: "DRAFT" | "APPROVED"; initialComment: string; initialParams: BudgetParams; initialNodes: BudgetNode[];
  initialStats: BudgetStat[]; furNames: string[]; catNames: string[]; articles: ArticleOpt[]; canEdit: boolean; savedAt: string; savedBy: string | null;
};

const ZERO: Agg = { pcs: 0, hides: 0, mex: 0, meters: 0, lining: 0, work: 0, c4: 0, total: 0, nowTotal: 0, nowPcs: 0, cmpTotal: 0 };
type NumKey = "pcs" | "hides" | "hidePrice" | "meters" | "meterPrice" | "work";
const KIND_LABEL = { fur: "тип сырья", cat: "категория", art: "артикул" } as const;

const ICON_BTN = "inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-neutral-200 bg-white px-1.5 text-sm text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-40 md:h-8 md:min-w-8";

/** Короткая подпись колонки + «i»-подсказка (title), чтобы шапка не превращалась в простыню. */
function Th({ children, tip, className = "" }: { children: ReactNode; tip: string; className?: string }) {
  return (
    <th scope="col" className={"whitespace-nowrap px-2 pb-1.5 pt-1 text-right text-[11px] font-medium text-neutral-500 " + className}>
      {children} <span title={tip} aria-label={tip} className="ml-0.5 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-neutral-300 align-middle text-[9px] font-normal leading-none text-neutral-400">i</span>
    </th>
  );
}

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
  const [status, setStatus] = useState(p.status);
  const [adding, setAdding] = useState<{ kind: AddKind; parentId: string | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [statFor, setStatFor] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
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
        .then((r) => { if (r.ok) lastSaved.current = cur; setSaveState(r.ok ? "saved" : "error"); setSaveError(r.ok ? null : r.error); })
        .catch(() => { setSaveState("error"); setSaveError("Нет связи с сервером"); });
    }, 900);
    return () => clearTimeout(t);
  }, [nodes, params, comment, p.id, canEdit]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const kids = useMemo(() => childrenMap(nodes), [nodes]);
  const calc = useMemo(() => computeTree(nodes, params), [nodes, params]);
  const total = useMemo(() => grandTotal(nodes, params), [nodes, params]);
  const furs = kids.get(null) ?? [];
  const pairOptions = useMemo(() => stats.filter((s) => !s.modelId), [stats]);

  const setParam = (k: keyof BudgetParams, v: number) => {
    const np = { ...params, [k]: v };
    setParams(np);
    setNodes((ns) => reapplyParams(ns, np));
  };
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
  const collapseAll = () => setCollapsed(new Set(nodes.filter((n) => n.kind !== "art").map((n) => n.id)));

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

  const changeStatus = () => startBusy(async () => {
    const to = status === "APPROVED" ? "DRAFT" : "APPROVED";
    if (to === "APPROVED" && canEdit) {
      const r = await saveBudget(p.id, params, nodes, comment);
      if (!r.ok) { setMsg(r.error); return; }
      lastSaved.current = JSON.stringify([params, nodes, comment]);
    }
    const r = await setBudgetStatus(p.id, to);
    if (r.ok) { setStatus(to); router.refresh(); } else setMsg(r.error);
  });

  const staff = p.canEdit;
  const takenIn = (kind: AddKind, parentId: string | null) =>
    (kids.get(parentId) ?? []).filter((n) => n.kind === kind).map((n) => (kind === "art" ? (n.modelId ?? "") : n.name.toLowerCase()));

  // ---- Плитки
  const perT = perUnit(total);
  const nowT = nowPerUnit(total);
  const totalTiles = (
    <div className="-mx-3 flex snap-x items-stretch gap-3 overflow-x-auto px-3 pb-1 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] md:overflow-visible md:px-0">
      {[
        { h: "Итого бюджет", v: money(total.total), c: `${qty(total.pcs, 0)} изд. · на 1 изд. ${money(perT)}`, big: true, items: [{ k: "Сейчас на 1 изд.", v: money(nowT) }, { k: "Var к текущим ценам", v: pct(varPct(total)) }] },
        { h: "Мех", v: money(total.mex), c: `${qty(total.hides, 0)} шкур`, items: [{ k: "Цена шкуры (средняя)", v: money(total.hides ? total.mex / total.hides : null) }, { k: "Доля", v: share(total.mex, total.total) }] },
        { h: "Подкладка", v: money(total.lining), c: `${qty(total.meters, 1)} м`, items: [{ k: "Цена за м (средняя)", v: money(total.meters ? total.lining / total.meters : null) }, { k: "Доля", v: share(total.lining, total.total) }] },
        { h: "Работа", v: money(total.work), c: `${qty(total.pcs, 0)} изд.`, items: [{ k: "На 1 изделие", v: money(total.pcs ? total.work / total.pcs : null) }, { k: "Доля", v: share(total.work, total.total) }] },
        { h: `Надбавка ${qty(params.c4, 1)}%`, v: money(total.c4), c: "на мех и подкладку", items: [{ k: "Доля", v: share(total.c4, total.total) }] },
      ].map((t) => (
        <div key={t.h} className={TILE_BOX + " min-w-[240px] shrink-0 snap-start shadow-sm md:min-w-0" + (t.big ? " border-neutral-400" : "")}>
          <TileHead>{t.h}</TileHead>
          <TileValue className={t.big ? "text-3xl" : ""}>{t.v}</TileValue>
          <TileCaption>{t.c}</TileCaption>
          <TileList items={t.items} />
        </div>
      ))}
    </div>
  );
  const furTiles = (
    <div className="-mx-3 flex snap-x items-stretch gap-3 overflow-x-auto px-3 pb-1 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] md:overflow-visible md:px-0">
      {furs.map((f) => {
        const a = calc.get(f.id) ?? ZERO;
        return (
          <div key={f.id} className={TILE_BOX + " min-w-[220px] shrink-0 snap-start shadow-sm md:min-w-0"}>
            <TileHead>{f.name}</TileHead>
            <TileValue>{money(a.total)}</TileValue>
            <TileCaption>{qty(a.pcs, 0)} изд. · {qty(a.hides, 0)} шкур</TileCaption>
            <TileList items={[{ k: "На 1 изделие", v: money(perUnit(a)) }, { k: "Доля бюджета", v: share(a.total, total.total) }]} />
          </div>
        );
      })}
      {furs.length === 0 ? <div className={TILE_BOX + " text-sm text-neutral-500"}>Добавьте тип сырья — здесь появятся его итоги.</div> : null}
    </div>
  );

  // ---- Таблица (планшет и компьютер)
  const numCell = (n: BudgetNode, k: NumKey, label: string, w: string) => (
    <td className={"px-1.5 py-1 " + w}><NumInput value={n[k]} ariaLabel={`${label}: ${n.name}`} disabled={!canEdit} onChange={(v) => editNum(n.id, k, v)} /></td>
  );
  const avg = (a: Agg) => ({
    hides: a.pcs > 0 ? a.hides / a.pcs : null, hidePrice: a.hides > 0 ? a.mex / a.hides : null,
    meters: a.pcs > 0 ? a.meters / a.pcs : null, meterPrice: a.meters > 0 ? a.lining / a.meters : null, work: a.pcs > 0 ? a.work / a.pcs : null,
  });

  const actions = (n: BudgetNode, hasKids: boolean) => (
    <div className="flex items-center justify-end gap-1">
      {canEdit ? (
        <>
          <button type="button" className={ICON_BTN + (n.locked ? " border-amber-300 bg-amber-50 text-amber-800" : "")} onClick={() => toggleLock(n.id)} aria-pressed={n.locked} aria-label={n.locked ? "Замок закрыт" : "Замок открыт"}
            title={n.locked ? "Замок закрыт: значения ручные, автоматический расчёт не трогает. Нажмите, чтобы вернуть автоматический расчёт" : "Замок открыт: считается автоматически. Ручная правка значения закроет замок"}>{n.locked ? "🔒" : "🔓"}</button>
          <button type="button" className={ICON_BTN} disabled={busy} onClick={() => runAuto(n.id)} aria-label="Автоматический расчёт для блока" title="Автоматический расчёт только для этого блока">↻</button>
          {n.kind !== "art" ? <button type="button" className={ICON_BTN} onClick={() => setAdding({ kind: n.kind === "fur" ? "cat" : "art", parentId: n.id })} aria-label={n.kind === "fur" ? "Добавить категорию" : "Добавить артикул"} title={n.kind === "fur" ? "Добавить категорию" : "Добавить артикул"}>＋</button> : null}
          <button type="button" className={ICON_BTN + " hover:text-red-700"} onClick={() => (hasKids || n.pcs > 0 ? setRemoving(n.id) : removeNode(n.id))} aria-label={`Удалить: ${n.name}`} title="Удалить">×</button>
        </>
      ) : n.locked ? <span title="Замок: ручные значения" aria-label="Замок закрыт">🔒</span> : null}
    </div>
  );

  const nameCell = (n: BudgetNode, depth: number, hasKids: boolean, open: boolean, bg: string, a: Agg) => {
    const leaf = n.kind !== "fur" && !hasKids;
    const si = leaf ? srcInfo(n) : null;
    const nestedCount = (kids.get(n.id) ?? []).length;
    return (
      <td className={`sticky left-0 z-10 min-w-[200px] max-w-[320px] lg:min-w-[270px] border-r border-neutral-200 px-2 py-1.5 align-middle ${bg}`}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
          {n.kind !== "art" && (hasKids || n.kind === "fur") ? (
            <button type="button" onClick={() => toggle(n.id)} aria-expanded={open} aria-label={open ? "Свернуть" : "Развернуть"} className="inline-flex h-7 w-6 shrink-0 items-center justify-center text-neutral-500 hover:text-neutral-900">
              <span aria-hidden className={"inline-block transition-transform " + (open ? "rotate-90" : "")}>›</span>
            </button>
          ) : <span className="w-6 shrink-0" />}
          {canEdit ? (
            <input value={n.name} onChange={(e) => patch(n.id, { name: e.target.value })} aria-label={`Название (${KIND_LABEL[n.kind]})`}
              className={"min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 hover:border-neutral-300 focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:outline-none " + (n.kind === "fur" ? "text-sm font-semibold" : n.kind === "cat" ? "text-sm font-medium" : "text-sm")} />
          ) : <span className={"min-w-0 flex-1 truncate px-1 " + (n.kind === "fur" ? "text-sm font-semibold" : "text-sm")}>{n.name}</span>}
          {n.kind === "art" ? <Badge tone={n.modelId ? "info" : "manual"} title={n.modelId ? "Артикул из каталога системы" : "Плановый артикул: есть только в бюджете"}>{n.modelId ? "арт." : "план"}</Badge> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-neutral-500" style={{ paddingLeft: depth * 18 + 30 }}>
          {si ? (
            n.kind === "cat" && canEdit && !effLocked(n, byId)
              ? <button type="button" onClick={() => setStatFor(n.id)} title="Выбрать, по какой статистике системы считать эту категорию" className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900"><Badge tone={si.tone}>{si.label} ▾</Badge></button>
              : <Badge tone={si.tone}>{si.label}</Badge>
          ) : <span>{n.kind === "fur" ? `${nestedCount} кат.` : `${nestedCount} арт.`} · {qty(a.pcs, 0)} изд.</span>}
        </div>
      </td>
    );
  };

  const tableRows = (parentId: string | null, depth: number): ReactNode[] =>
    (kids.get(parentId) ?? []).flatMap((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = kids.get(n.id) ?? [];
      const hasKids = ch.length > 0;
      const leaf = n.kind !== "fur" && !hasKids;
      const open = !collapsed.has(n.id);
      const bg = n.kind === "fur" ? "bg-neutral-100" : hasKids ? "bg-neutral-50" : "bg-white";
      const av = avg(a);
      const g = (v: number | null, d = 1) => <td className="px-2 text-right text-xs tabular-nums text-neutral-500" title={hasKids || n.kind === "fur" ? "Среднее по строкам внутри" : undefined}>{qty(v, d)}</td>;
      const gm = (v: number | null) => <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500">{v == null ? "—" : money(v)}</td>;
      const row = (
        <tr key={n.id} className={`border-t border-neutral-100 ${bg} ${n.kind === "fur" ? "font-semibold" : ""}`}>
          {nameCell(n, depth, hasKids, open, bg, a)}
          {leaf ? numCell(n, "pcs", "Бюджет, шт.", "w-[84px] min-w-[84px] border-l border-neutral-200") : <td className="whitespace-nowrap border-l border-neutral-200 px-2 text-right text-sm tabular-nums">{qty(a.pcs, 0)}</td>}
          {leaf ? numCell(n, "hides", "Шкур на изделие", "w-[80px] min-w-[80px]") : g(av.hides)}
          <td className="px-2 text-right text-xs tabular-nums text-neutral-600">{qty(a.hides, 0)}</td>
          {leaf ? numCell(n, "hidePrice", "Цена шкуры", "w-[112px] min-w-[112px] border-l border-neutral-200") : <td className="whitespace-nowrap border-l border-neutral-200 px-2 text-right text-xs tabular-nums text-neutral-500">{av.hidePrice == null ? "—" : money(av.hidePrice)}</td>}
          {leaf ? numCell(n, "meters", "Подкладка, м на изделие", "w-[84px] min-w-[84px]") : g(av.meters)}
          {leaf ? numCell(n, "meterPrice", "Цена подкладки за м", "w-[96px] min-w-[96px]") : gm(av.meterPrice)}
          {leaf ? numCell(n, "work", "Работа на изделие", "w-[112px] min-w-[112px]") : gm(av.work)}
          <td className="whitespace-nowrap border-l border-neutral-200 px-2 text-right text-xs tabular-nums text-neutral-600">{money(a.mex)}</td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600">{money(a.lining)}</td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600">{money(a.work)}</td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500">{money(a.c4)}</td>
          <td className="whitespace-nowrap px-2 text-right text-sm font-semibold tabular-nums">{money(a.total)}</td>
          <td className="whitespace-nowrap px-2 text-right text-sm tabular-nums">{money(perUnit(a))}</td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500">{money(nowPerUnit(a))}</td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500">{pct(varPct(a))}</td>
          <td className={`border-l border-neutral-200 px-1.5 py-1 lg:sticky lg:right-0 lg:z-10 ${bg}`}>{actions(n, hasKids)}</td>
        </tr>
      );
      return [row, ...(open ? tableRows(n.id, depth + 1) : [])];
    });

  // ---- Карточки (телефон)
  const cardField = (n: BudgetNode, k: NumKey, label: string) => (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-500">{label}<NumInput value={n[k]} ariaLabel={`${label}: ${n.name}`} disabled={!canEdit} onChange={(v) => editNum(n.id, k, v)} className="!py-2 !text-base" /></label>
  );
  const cards = (parentId: string | null, depth: number): ReactNode[] =>
    (kids.get(parentId) ?? []).map((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = kids.get(n.id) ?? [];
      const hasKids = ch.length > 0;
      const leaf = n.kind !== "fur" && !hasKids;
      const open = !collapsed.has(n.id);
      const si = leaf ? srcInfo(n) : null;
      return (
        <div key={n.id} className={depth > 0 ? "ml-3 border-l-2 border-neutral-200 pl-2" : ""}>
          <div className={"rounded-lg border p-3 " + (n.kind === "fur" ? "border-neutral-300 bg-neutral-100" : "border-neutral-200 bg-white")}>
            <div className="flex items-center gap-1">
              {n.kind !== "art" && (hasKids || n.kind === "fur") ? (
                <button type="button" onClick={() => toggle(n.id)} aria-expanded={open} aria-label={open ? "Свернуть" : "Развернуть"} className="inline-flex h-10 w-8 shrink-0 items-center justify-center text-lg text-neutral-500"><span className={"inline-block transition-transform " + (open ? "rotate-90" : "")}>›</span></button>
              ) : null}
              {canEdit ? <input value={n.name} onChange={(e) => patch(n.id, { name: e.target.value })} aria-label={`Название (${KIND_LABEL[n.kind]})`} className="min-h-10 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:outline-none" />
                : <span className="min-w-0 flex-1 px-1 text-sm font-semibold">{n.name}</span>}
              {n.kind === "art" ? <Badge tone={n.modelId ? "info" : "manual"}>{n.modelId ? "арт." : "план"}</Badge> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              {si ? (n.kind === "cat" && canEdit && !effLocked(n, byId)
                ? <button type="button" onClick={() => setStatFor(n.id)} className="min-h-8"><Badge tone={si.tone}>{si.label} ▾</Badge></button>
                : <Badge tone={si.tone}>{si.label}</Badge>) : <span>{ch.length} {n.kind === "fur" ? "кат." : "арт."}</span>}
              <span className="tabular-nums">{qty(a.pcs, 0)} изд.</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-xl font-semibold tabular-nums">{money(a.total)}</span>
              <span className="text-xs text-neutral-500 tabular-nums">на 1 изд. {money(perUnit(a))}</span>
            </div>
            {leaf ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {cardField(n, "pcs", "Бюджет, шт.")}{cardField(n, "hides", "Шкур на изделие")}
                  {cardField(n, "hidePrice", "Цена шкуры, ₽")}{cardField(n, "meters", "Подкладка, м/изд.")}
                  {cardField(n, "meterPrice", "Цена за м, ₽")}{cardField(n, "work", "Работа/изд., ₽")}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {[["Всего шкур", qty(a.hides, 0)], ["Мех", money(a.mex)], ["Подкладка", money(a.lining)], ["Работа", money(a.work)], ["Надбавка", money(a.c4)], ["Сейчас на 1 изд.", money(nowPerUnit(a))], ["Var", pct(varPct(a))]].map(([k, v]) => (
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
  const grp = "border-l border-neutral-200 px-2 pt-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/budget" className="text-xs text-neutral-500 hover:underline">← Все бюджеты</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{p.name}</h1>
            {p.season !== p.name ? <span className="text-sm text-neutral-500">{p.season}</span> : null}
            <Badge tone={status === "APPROVED" ? "ok" : "manual"}>{status === "APPROVED" ? "Утверждён" : "Черновик"}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500" role="status">{saveText}{p.savedBy ? ` · изменял(а) ${p.savedBy}` : ""}</p>
        </div>
        {staff ? (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? <button type="button" onClick={() => runAuto()} disabled={busy} className={BTN_PRIMARY}>{busy ? "Считаю…" : "Автоматический расчёт"}</button> : null}
            {canEdit ? <button type="button" onClick={() => setAdding({ kind: "fur", parentId: null })} className={BTN}>+ Тип сырья</button> : null}
            <button type="button" onClick={changeStatus} disabled={busy} className={BTN}>{status === "APPROVED" ? "Вернуть в черновик" : "Утвердить"}</button>
          </div>
        ) : null}
      </div>
      {msg ? <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700" role="status">{msg}</p> : null}

      <section aria-label="Параметры" className="rounded-lg border border-neutral-200 bg-white p-3">
        <div className="mb-2 flex items-center gap-1 text-sm font-medium">Надбавки, %
          <InfoHint label="Что такое надбавки" wide>
            <p>Автоматический расчёт берёт из системы средневзвешенные цены и увеличивает на заданный процент: цену шкуры, цену подкладки и стоимость работы (по умолчанию 10%). Любой процент, в том числе 0.</p>
            <p className="mt-1">Надбавка 4% — как в системе, на мех и подкладку. Смена процента сразу пересчитывает строки без замка.</p>
          </InfoHint>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["upFur", "К цене шкуры"], ["upLining", "К цене подкладки"], ["upWork", "К работе"], ["c4", "4% на мех и подкладку"]] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-neutral-500">{label}
              <span className="flex items-center gap-1"><NumInput value={params[k]} ariaLabel={label} disabled={!canEdit} onChange={(v) => setParam(k, v)} className="!py-2 md:!py-1.5" /><span>%</span></span>
            </label>
          ))}
        </div>
        <label className="mt-3 flex flex-col gap-1 text-xs text-neutral-500">Комментарий к версии
          <input value={comment} onChange={(e) => setComment(e.target.value)} disabled={!canEdit} maxLength={500} placeholder="Что в этой версии изменилось" className={FIELD + " disabled:border-transparent disabled:bg-transparent"} />
        </label>
      </section>

      <WidgetRow id="budget-totals" title="Итого по бюджету">{totalTiles}</WidgetRow>
      <WidgetRow id="budget-by-fur" title="Итоги по типам сырья">{furTiles}</WidgetRow>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Состав бюджета</h2>
        <div className="flex items-center gap-2 text-xs">
          <button type="button" onClick={expandAll} className="inline-flex min-h-10 items-center text-neutral-600 hover:underline md:min-h-0">Развернуть всё</button>
          <button type="button" onClick={collapseAll} className="inline-flex min-h-10 items-center text-neutral-600 hover:underline md:min-h-0">Свернуть до типов сырья</button>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Бюджет пуст. {canEdit ? "Нажмите «+ Тип сырья», затем добавьте категории и артикулы." : ""}
        </div>
      ) : (
        <>
          <div className="hidden max-h-[78vh] overflow-auto rounded-lg border border-neutral-200 bg-white md:block">
            <table className="w-max min-w-full border-separate border-spacing-0 text-left [&_td]:border-t-0">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="h-7 border-b border-neutral-200">
                  <th rowSpan={2} scope="col" className="sticky left-0 z-30 min-w-[200px] lg:min-w-[270px] border-b border-r border-neutral-200 bg-white px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Тип сырья · категория · артикул</th>
                  <th colSpan={3} className={grp}>Количество</th>
                  <th colSpan={4} className={grp}>Цены на 1 изделие</th>
                  <th colSpan={8} className={grp}>Результат</th>
                  <th rowSpan={2} scope="col" className="min-w-[150px] border-b border-l lg:sticky lg:right-0 lg:z-30 border-neutral-200 bg-white px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Действия</th>
                </tr>
                <tr className="border-b border-neutral-200">
                  <Th tip="Сколько изделий заложено в бюджет" className="border-l border-neutral-200">Бюджет, шт.</Th>
                  <Th tip="Сколько шкур уходит на одно изделие">Шкур/изд.</Th>
                  <Th tip="Бюджет изделий × шкур на изделие">Всего шкур</Th>
                  <Th tip="Цена одной шкуры, ₽ (с надбавкой). Ручная правка закрывает замок" className="border-l border-neutral-200">Цена шкуры, ₽</Th>
                  <Th tip="Подкладка, метров на одно изделие">Подкл., м/изд.</Th>
                  <Th tip="Цена подкладки за метр, ₽">Цена, ₽/м</Th>
                  <Th tip="Стоимость работы на одно изделие, ₽">Работа/изд., ₽</Th>
                  <Th tip="Мех = всего шкур × цена шкуры" className="border-l border-neutral-200">Мех</Th>
                  <Th tip="Подкладка = бюджет × м на изделие × цена за метр">Подкладка</Th>
                  <Th tip="Работа = бюджет × работа на изделие">Работа</Th>
                  <Th tip="Надбавка на мех и подкладку (по умолчанию 4%)">4%</Th>
                  <Th tip="Мех + подкладка + работа + 4%">Итого</Th>
                  <Th tip="Итого ÷ бюджет изделий">На 1 изд.</Th>
                  <Th tip="Стоимость одного изделия по текущим ценам системы (без надбавок, с 4%)">Сейчас</Th>
                  <Th tip="Бюджет к текущим ценам системы, %">Var</Th>
                </tr>
              </thead>
              <tbody>
                {tableRows(null, 0)}
                <tr className="bg-neutral-100 font-semibold">
                  <td className="sticky left-0 z-10 border-r border-t border-neutral-300 bg-neutral-100 px-3 py-2 text-sm">Всего по бюджету</td>
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-sm tabular-nums">{qty(total.pcs, 0)}</td>
                  <td className="border-t border-neutral-300" />
                  <td className="border-t border-neutral-300 px-2 text-right text-xs tabular-nums text-neutral-600">{qty(total.hides, 0)}</td>
                  <td className="border-t border-neutral-300" colSpan={4} />
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-xs tabular-nums text-neutral-600">{money(total.mex)}</td>
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-xs tabular-nums text-neutral-600">{money(total.lining)}</td>
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-xs tabular-nums text-neutral-600">{money(total.work)}</td>
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-xs tabular-nums text-neutral-500">{money(total.c4)}</td>
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-sm tabular-nums">{money(total.total)}</td>
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-sm tabular-nums">{money(perT)}</td>
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-xs tabular-nums text-neutral-500">{money(nowT)}</td>
                  <td className="whitespace-nowrap border-t border-neutral-300 px-2 text-right text-xs tabular-nums text-neutral-500">{pct(varPct(total))}</td>
                  <td className="border-l border-t border-neutral-300 bg-neutral-100 lg:sticky lg:right-0 lg:z-10" />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 md:hidden">{cards(null, 0)}</div>
        </>
      )}
      <p className="text-xs text-neutral-500">Как считается: изделий × (шкур × цена шкуры + подкладка м × цена за м + работа) + {qty(params.c4, 1)}% на мех и подкладку. «Сейчас» — те же количества по текущим ценам системы без надбавок; Var — бюджет к «сейчас». Если у категории есть артикулы, её итог — сумма артикулов. Серые числа у категорий и типов сырья — средние по строкам внутри. Замок закрыт — строка ручная; любое ручное изменение цены или количества на изделие закрывает замок.</p>

      {adding ? (
        <AddDialog kind={adding.kind} names={adding.kind === "fur" ? p.furNames : p.catNames} articles={p.articles} taken={takenIn(adding.kind, adding.parentId)}
          onClose={() => setAdding(null)} onPick={(v) => addNode(adding.kind, adding.parentId, v)} />
      ) : null}
      {statFor && byId.get(statFor) ? (
        <Modal title={`Данные системы: ${byId.get(statFor)?.name}`} onClose={() => setStatFor(null)}>
          <p className="mb-2 text-xs text-neutral-500">По какой статистике «мех × категория» считать эту категорию. «По названию» — мех блока и название категории.</p>
          <select aria-label="Статистика системы" className={FIELD} value={`${byId.get(statFor)?.statFur ?? ""}|${byId.get(statFor)?.statCat ?? ""}`} onChange={(e) => { setStat(statFor, e.target.value); setStatFor(null); }}>
            <option value="|">По названию</option>
            {byId.get(statFor)?.statFur && !pairOptions.some((x) => x.key === `${byId.get(statFor)?.statFur}|${byId.get(statFor)?.statCat}`) ? <option value={`${byId.get(statFor)?.statFur}|${byId.get(statFor)?.statCat}`}>{byId.get(statFor)?.statFur} · {byId.get(statFor)?.statCat}</option> : null}
            {pairOptions.map((x) => <option key={x.key} value={x.key}>{x.fur} · {x.cat} ({x.qty} изд.)</option>)}
          </select>
        </Modal>
      ) : null}
      {removing ? (
        <Modal title="Удалить строку?" onClose={() => setRemoving(null)}>
          <p className="text-sm text-neutral-700">«{byId.get(removing)?.name}» будет удалена{(kids.get(removing) ?? []).length ? " вместе со всеми вложенными строками" : ""}. Введённые значения пропадут.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setRemoving(null)}>Отмена</button>
            <button type="button" className="inline-flex min-h-10 items-center rounded-lg bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 md:min-h-8" onClick={() => removeNode(removing)}>Удалить</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
