"use client";

import type { ReactNode } from "react";
import { formatPercent } from "@/lib/utils";
import { effLocked, effUp, srcInfo, type BudgetNode, type BudgetParams, type EffUp } from "@/lib/budget-calc";
import { Badge, NumInput } from "../ui";
import { DOT, ICON_BTN, KIND_LABEL, type NumKey, type UpKey } from "./parts";
import type { AddKind } from "../add-dialog";

/** Мелкие элементы строки дерева бюджета: замок, точка качества данных, надбавка, действия, ячейки ввода. Состояние — в BudgetEditor, сюда передаются значения и обработчики. */
export type RowKitCtx = {
  canEdit: boolean; busy: boolean; byId: Map<string, BudgetNode>; kids: Map<string | null, BudgetNode[]>; params: BudgetParams;
  toggle: (id: string) => void; toggleLock: (id: string) => void; runAuto: (scopeId?: string) => void; setUpFor: (id: string | null) => void;
  setAdding: (v: { kind: AddKind; parentId: string | null } | null) => void; setRemoving: (id: string | null) => void; removeNode: (id: string) => void; setStatFor: (id: string | null) => void;
  patch: (id: string, pt: Partial<BudgetNode>) => void; editNum: (id: string, k: NumKey, v: number) => void; addInfo: (n: BudgetNode) => { lenMode: "both" | "only" | undefined; label: string };
};

export function makeRowKit(ctx: RowKitCtx) {
  const { canEdit, busy, byId, kids, params, toggle, toggleLock, runAuto, setUpFor, setAdding, setRemoving, removeNode, setStatFor, patch, editNum, addInfo } = ctx;
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
    return <span title={own ? "Надбавка задана на этой строке" : "Надбавка унаследована от уровня выше"} className={"w-11 shrink-0 text-right text-[11px] leading-none text-emerald-600 " + (own ? "font-bold underline" : "")}>{formatPercent(v, { sign: true })}</span>;
  };

  const hasOwnUp = (n: BudgetNode) => [n.upFur, n.upLining, n.upWork].some((v) => typeof v === "number");

  const actions = (n: BudgetNode, hasKids: boolean) => (
    <div className="flex items-center justify-end gap-1 print:hidden">
      {canEdit ? (
        <>
          <button type="button" className={ICON_BTN + (n.locked ? " border-[var(--ui-accent)] bg-[var(--ui-soft)] text-[var(--ui-accent-text)]" : "")} onClick={() => toggleLock(n.id)} aria-pressed={n.locked} aria-label={n.locked ? "Замок закрыт" : "Замок открыт"}
            title={n.locked ? "Замок закрыт: значения ручные, автоматический расчёт не трогает. Нажмите, чтобы вернуть автоматический расчёт" : "Замок открыт: считается автоматически. Ручная правка значения закроет замок"}>{n.locked ? "🔒" : <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>}</button>
          <button type="button" className={ICON_BTN} disabled={busy} onClick={() => runAuto(n.id)} aria-label="Автоматический расчёт для блока" title="Автоматический расчёт только для этого блока">↻</button>
          <button type="button" className={ICON_BTN + (hasOwnUp(n) ? " border-[var(--ui-accent)] bg-[var(--ui-soft)] text-[var(--ui-accent-text)]" : "")} onClick={() => setUpFor(n.id)} aria-label="Надбавки для этой строки" title="Надбавки для этой строки и всего, что внутри">%</button>
          {n.kind !== "art" ? <button type="button" className={ICON_BTN} onClick={() => setAdding({ kind: n.kind === "fur" ? "cat" : "art", parentId: n.id })} aria-label={"Добавить: " + addInfo(n).label} title={"Добавить: " + addInfo(n).label}>＋</button> : null}
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

  // ---- Детально: таблица с полями (планшет и компьютер)
  const numCell = (n: BudgetNode, k: NumKey, label: string, w: string, tag?: UpKey, below?: ReactNode) => (
    <td className={"px-1.5 py-1 " + w}>
      <div className="flex items-center gap-1">{tag ? upTag(n, tag) : null}<NumInput value={n[k]} ariaLabel={`${label}: ${n.name}`} disabled={!canEdit} onChange={(v) => editNum(n.id, k, v)} className={n.est ? "italic" : ""} /></div>
      {below}
    </td>
  );

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
            title={n.kind === "fur" ? "Добавить категорию в этот тип сырья" : n.kind === "len" ? "Добавить артикул в эту длину: из списка системы или новый плановый" : "Добавить в эту категорию: " + (addInfo(n).lenMode ? "длину (Short/Regular/Long) или артикул" : "артикул из списка системы или новый плановый")}
            className="shrink-0 whitespace-nowrap rounded px-1 text-[11px] text-blue-700 hover:underline">+ {addInfo(n).label}</button>
        ) : null}
      </div>
    </td>
  );

  // ---- Карточки (телефон, режим «Детально»)
  const cardField = (n: BudgetNode, k: NumKey, label: string, tag?: UpKey) => (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-500"><span className="flex items-center justify-between gap-1">{label}{tag ? upTag(n, tag) : null}</span><NumInput value={n[k]} ariaLabel={`${label}: ${n.name}`} disabled={!canEdit} onChange={(v) => editNum(n.id, k, v)} className={"!py-2 !text-base" + (n.est ? " italic" : "")} /></label>
  );

  return { leafOf, dot, upTag, actions, lockBtn, chevron, numCell, nameCell, cardField };
}

export type RowKit = ReturnType<typeof makeRowKit>;
