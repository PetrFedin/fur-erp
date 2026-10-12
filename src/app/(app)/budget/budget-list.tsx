"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoHint } from "@/components/info-hint";
import { BTN, BTN_PRIMARY, Badge, FIELD, Modal, dateRu, money, pct, qty } from "./ui";
import { createBudget, deleteBudget, duplicateBudget, renameBudget } from "./actions";

export type BudgetSummary = {
  id: string; name: string; season: string; status: "DRAFT" | "APPROVED"; comment: string | null; parentName: string | null;
  total: number; pcs: number; hides: number; perUnit: number | null; nowPerUnit: number | null; varPct: number | null; updatedAt: string; updatedBy: string | null;
};

const ICON = "btn-accent inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-50 md:h-7 md:w-7";

type Dialog = { kind: "new" } | { kind: "rename"; b: BudgetSummary } | { kind: "delete"; b: BudgetSummary } | null;

export function BudgetList({ items, canEdit }: { items: BudgetSummary[]; canEdit: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
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


  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Бюджет
            <InfoHint label="Что такое бюджет" wide>
              <p>Версии бюджета расходов по меху: тип сырья → категория → артикул, расчёт идёт сам. Сделайте копию, чтобы сравнить варианты.</p>
            </InfoHint>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? <button type="button" onClick={() => setDialog({ kind: "new" })} className={BTN_PRIMARY}>+ Новый бюджет</button> : null}
        </div>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Бюджетов пока нет. {canEdit ? "Нажмите «Новый бюджет» и выберите шаблон «по Budget PCS FW27» или пустой." : ""}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => (
            <li key={b.id} className="relative flex flex-col rounded-lg border border-neutral-200 bg-white p-4 tile-click">
              <Link href={`/budget/${b.id}`} className="absolute inset-0 z-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900" aria-label={`Открыть бюджет: ${b.name}`} />
              <div className="flex items-start justify-between gap-2">
                <div className="pointer-events-none relative z-10 min-w-0">
                  <span className="block truncate text-base font-semibold">{b.name}</span>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                    <span>{b.season}</span>
                    {b.status === "APPROVED" ? <Badge tone="ok">Утверждён</Badge> : null}
                    {b.parentName ? <span title="Получен копированием">копия «{b.parentName}»</span> : null}
                  </div>
                </div>
                <div className="relative z-10 flex shrink-0 items-center gap-1">
                  <Link href={`/budget/${b.id}`} className={ICON} aria-label={`Открыть: ${b.name}`} title="Открыть">
                    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4H7a1 1 0 0 0-1 1v15M14 4v16M14 4l5 1.5V19l-5 1M3 20h18" /><circle cx="11.5" cy="12" r=".6" fill="currentColor" /></svg>
                  </Link>
                  {canEdit ? (
                    <>
                      <button type="button" className={ICON} onClick={() => setDialog({ kind: "rename", b })} aria-label={`Переименовать: ${b.name}`} title="Переименовать">
                        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                      </button>
                      <button type="button" className={ICON} disabled={busy} onClick={() => run(() => duplicateBudget(b.id))} aria-label={`Копия: ${b.name}`} title="Сделать копию">
                        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
                      </button>
                      <button type="button" className={ICON + " hover:text-red-700"} onClick={() => setDialog({ kind: "delete", b })} aria-label={`Удалить: ${b.name}`} title="Удалить">
                        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                <div><dt className="text-neutral-500">Изделий</dt><dd className="mt-0.5 text-sm font-medium tabular-nums">{qty(b.pcs, 0)}</dd></div>
                <div><dt className="text-neutral-500">Шкур</dt><dd className="mt-0.5 text-sm font-medium tabular-nums">{qty(b.hides, 0)}</dd></div>
                <div><dt className="text-neutral-500">К текущим ценам</dt><dd className="mt-0.5 text-sm font-medium tabular-nums">{pct(b.varPct)}</dd></div>
                <div className="col-span-3 border-t border-neutral-200 pt-2"><dt className="text-neutral-500">Сумма</dt><dd className="mt-0.5 whitespace-nowrap text-xl font-semibold tabular-nums">{money(b.total)}</dd></div>
              </dl>
              {b.comment ? <p className="mt-2 line-clamp-2 text-xs text-neutral-500">{b.comment}</p> : null}
              <p className="mt-2 text-[11px] text-neutral-400">Изменён {dateRu(b.updatedAt)}{b.updatedBy ? ` · ${b.updatedBy}` : ""}</p>
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
            <button type="button" disabled={busy} className="inline-flex min-h-10 items-center rounded-lg bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 md:min-h-8" onClick={() => run(() => deleteBudget(dialog.b.id), () => router.refresh())}>Удалить</button>
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
