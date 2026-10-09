"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "../dashboard/tile";
import { BTN, BTN_PRIMARY, Badge, FIELD, Modal, dateRu, money, pct, qty } from "./ui";
import { createBudget, deleteBudget, duplicateBudget, renameBudget, setBudgetStatus } from "./actions";

export type BudgetSummary = {
  id: string; name: string; season: string; status: "DRAFT" | "APPROVED"; comment: string | null; parentName: string | null;
  total: number; pcs: number; perUnit: number | null; nowPerUnit: number | null; varPct: number | null; updatedAt: string; updatedBy: string | null;
};

type Dialog = { kind: "new" } | { kind: "rename"; b: BudgetSummary } | { kind: "delete"; b: BudgetSummary } | null;

export function BudgetList({ items, canEdit }: { items: BudgetSummary[]; canEdit: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, then?: (id?: string) => void) =>
    start(async () => {
      setError(null);
      try {
        const r = await fn();
        if (!r.ok) { setError(r.error ?? "Не удалось выполнить действие"); return; }
        setDialog(null);
        if (then) then(r.id); else router.refresh();
      } catch { setError("Не удалось выполнить действие. Попробуйте ещё раз."); }
    });

  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]));
  const approved = items.filter((b) => b.status === "APPROVED");
  const main = approved[0] ?? items[0] ?? null;
  const last = items[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Бюджет</h1>
          <p className="mt-0.5 text-xs text-neutral-500">Версии бюджета расходов по меху: тип сырья → категория → артикул, расчёт идёт сам. Сделайте копию, чтобы сравнить варианты.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {picked.length === 2 ? <Link href={`/budget/compare?a=${picked[0]}&b=${picked[1]}`} className={BTN_PRIMARY}>Сравнить выбранные</Link> : <span className="text-xs text-neutral-500">Отметьте две версии, чтобы сравнить</span>}
          {canEdit ? <button type="button" onClick={() => setDialog({ kind: "new" })} className={BTN_PRIMARY}>+ Новый бюджет</button> : null}
        </div>
      </div>
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      <WidgetRow id="budget-list" title="Сводка по версиям">
        <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
          <div className={TILE_BOX + " min-w-[240px] shrink-0 snap-start shadow-sm md:min-w-0"}>
            <TileHead>Версий бюджета</TileHead>
            <TileValue>{items.length}</TileValue>
            <TileCaption>утверждено {approved.length}, черновиков {items.length - approved.length}</TileCaption>
          </div>
          <div className={TILE_BOX + " min-w-[240px] shrink-0 snap-start shadow-sm md:min-w-0"}>
            <TileHead>{approved.length ? "Утверждённый бюджет" : "Главный бюджет"}</TileHead>
            <TileValue className="whitespace-nowrap">{main ? money(main.total) : "—"}</TileValue>
            <TileCaption>{main ? `${main.name} · ${qty(main.pcs, 0)} изд. · на 1 изд. ${money(main.perUnit)}` : "Пока нет ни одной версии"}</TileCaption>
          </div>
          <div className={TILE_BOX + " min-w-[240px] shrink-0 snap-start shadow-sm md:min-w-0"}>
            <TileHead>Последнее изменение</TileHead>
            <TileValue className="text-lg">{last ? last.name : "—"}</TileValue>
            <TileCaption>{last ? `${dateRu(last.updatedAt)}${last.updatedBy ? ` · ${last.updatedBy}` : ""}` : ""}</TileCaption>
          </div>
        </div>
      </WidgetRow>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Бюджетов пока нет. {canEdit ? "Нажмите «Новый бюджет» и выберите шаблон «по Budget PCS FW27» или пустой." : ""}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => (
            <li key={b.id} className={"flex flex-col rounded-lg border bg-white p-4 shadow-sm " + (picked.includes(b.id) ? "border-neutral-900" : "border-neutral-200")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/budget/${b.id}`} className="block truncate text-base font-semibold hover:underline">{b.name}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                    <span>{b.season}</span>
                    <Badge tone={b.status === "APPROVED" ? "ok" : "manual"}>{b.status === "APPROVED" ? "Утверждён" : "Черновик"}</Badge>
                    {b.parentName ? <span title="Получен копированием">копия «{b.parentName}»</span> : null}
                  </div>
                </div>
                <label className="flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 text-xs text-neutral-500 md:min-h-0">
                  <input type="checkbox" checked={picked.includes(b.id)} onChange={() => togglePick(b.id)} className="h-4 w-4 accent-neutral-900" aria-label={`Сравнить: ${b.name}`} />
                  сравнить
                </label>
              </div>
              <div className="mt-3 text-2xl font-semibold tabular-nums">{money(b.total)}</div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-neutral-500">Изделий</dt><dd className="mt-0.5 text-sm font-medium tabular-nums">{qty(b.pcs, 0)}</dd></div>
                <div><dt className="text-neutral-500">На 1 изделие</dt><dd className="mt-0.5 text-sm font-medium tabular-nums">{money(b.perUnit)}</dd></div>
                <div><dt className="text-neutral-500">К текущим ценам</dt><dd className="mt-0.5 text-sm font-medium tabular-nums">{pct(b.varPct)}</dd></div>
              </dl>
              {b.comment ? <p className="mt-2 line-clamp-2 text-xs text-neutral-500">{b.comment}</p> : null}
              <p className="mt-2 text-[11px] text-neutral-400">Изменён {dateRu(b.updatedAt)}{b.updatedBy ? ` · ${b.updatedBy}` : ""}</p>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                <Link href={`/budget/${b.id}`} className={BTN_PRIMARY}>Открыть</Link>
                {canEdit ? (
                  <>
                    <button type="button" className={BTN} disabled={busy} onClick={() => run(() => duplicateBudget(b.id))}>Копия</button>
                    <button type="button" className={BTN} onClick={() => setDialog({ kind: "rename", b })}>Переименовать</button>
                    <button type="button" className={BTN} disabled={busy} onClick={() => run(() => setBudgetStatus(b.id, b.status === "APPROVED" ? "DRAFT" : "APPROVED"))}>{b.status === "APPROVED" ? "В черновик" : "Утвердить"}</button>
                    <button type="button" className={BTN + " text-red-700"} onClick={() => setDialog({ kind: "delete", b })}>Удалить</button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "new" ? <NewDialog items={items} busy={busy} onClose={() => setDialog(null)} onCreate={(v) => run(() => createBudget(v), (id) => router.push(`/budget/${id}`))} /> : null}
      {dialog?.kind === "rename" ? <RenameDialog b={dialog.b} busy={busy} onClose={() => setDialog(null)} onSave={(name, season) => run(() => renameBudget(dialog.b.id, name, season))} /> : null}
      {dialog?.kind === "delete" ? (
        <Modal title="Удалить бюджет?" onClose={() => setDialog(null)}>
          <p className="text-sm text-neutral-700">Бюджет «{dialog.b.name}» ({dialog.b.season}) будет удалён вместе со всеми строками. Это нельзя отменить.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setDialog(null)}>Отмена</button>
            <button type="button" disabled={busy} className="inline-flex min-h-10 items-center rounded-lg bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 md:min-h-8" onClick={() => run(() => deleteBudget(dialog.b.id), () => { setPicked((p) => p.filter((x) => x !== dialog.b.id)); router.refresh(); })}>Удалить</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function NewDialog({ items, busy, onClose, onCreate }: { items: BudgetSummary[]; busy: boolean; onClose: () => void; onCreate: (v: { name: string; season: string; template: "empty" | "copy" | "fw27"; copyFromId?: string }) => void }) {
  const [name, setName] = useState("");
  const [season, setSeason] = useState("FW27");
  const [template, setTemplate] = useState<"empty" | "copy" | "fw27">("fw27");
  const [copyFromId, setCopyFromId] = useState(items[0]?.id ?? "");
  const opts: Array<["fw27" | "empty" | "copy", string, string]> = [
    ["fw27", "По Budget PCS FW27", "Готовые строки из отчёта: типы сырья, категории и бюджет по штукам; цены заполнены по данным системы, рысь вручную."],
    ["empty", "Пустой", "Только название: типы сырья, категории и артикулы добавляете сами."],
    ["copy", "Копия существующего", "Все строки и надбавки выбранной версии."],
  ];
  return (
    <Modal title="Новый бюджет" onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Название
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, FW27 v2" className={FIELD} maxLength={80} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Сезон
          <input value={season} onChange={(e) => setSeason(e.target.value)} className={FIELD} maxLength={20} />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-neutral-500">Шаблон</legend>
          {opts.map(([v, t, d]) => (
            <label key={v} className={"flex cursor-pointer gap-2 rounded-lg border p-3 text-sm " + (template === v ? "border-neutral-900 bg-neutral-50" : "border-neutral-200")}>
              <input type="radio" name="tpl" checked={template === v} onChange={() => setTemplate(v)} className="mt-0.5 accent-neutral-900" disabled={v === "copy" && items.length === 0} />
              <span><span className="font-medium">{t}</span><span className="mt-0.5 block text-xs text-neutral-500">{d}</span></span>
            </label>
          ))}
        </fieldset>
        {template === "copy" ? (
          <select value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)} className={FIELD} aria-label="Какой бюджет копировать">
            {items.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.season}</option>)}
          </select>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={BTN} onClick={onClose}>Отмена</button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !name.trim()} onClick={() => onCreate({ name, season, template, copyFromId: template === "copy" ? copyFromId : undefined })}>{busy ? "Создаю…" : "Создать"}</button>
        </div>
      </div>
    </Modal>
  );
}

function RenameDialog({ b, busy, onClose, onSave }: { b: BudgetSummary; busy: boolean; onClose: () => void; onSave: (name: string, season: string) => void }) {
  const [name, setName] = useState(b.name);
  const [season, setSeason] = useState(b.season);
  return (
    <Modal title="Переименовать бюджет" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Название<input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={FIELD} maxLength={80} /></label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Сезон<input value={season} onChange={(e) => setSeason(e.target.value)} className={FIELD} maxLength={20} /></label>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose}>Отмена</button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !name.trim()} onClick={() => onSave(name, season)}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}
