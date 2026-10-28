"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BTN, BTN_PRIMARY, FIELD, Modal, dateRu } from "./ui";
import { createPcs, duplicatePcs, removePcs, renamePcs } from "./pcs/actions";

export type PcsCard = { id: string; name: string; season: string; updatedAt: string; updatedBy: string | null };
const ICON = "btn-accent inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-50 md:h-7 md:w-7 max-xl:min-h-11 max-xl:min-w-11";
type Dialog = { kind: "new" } | { kind: "rename"; f: PcsCard } | { kind: "delete"; f: PcsCard } | null;
const svg = (d: string) => <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export function PcsCards({ items, canEdit }: { items: PcsCard[]; canEdit: boolean }) {
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
    <section aria-label="Budget PCS" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Бюджет FW27 + статистика</h2>
        {canEdit ? <button type="button" onClick={() => setDialog({ kind: "new" })} className={BTN_PRIMARY}>+ Новый файл</button> : null}
      </div>
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((f) => (
          <li key={f.id} className="relative flex flex-col rounded-lg border border-neutral-200 bg-white p-4 tile-click">
            <Link href={`/budget/pcs/${f.id}`} className="absolute inset-0 z-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900" aria-label={`Открыть файл: ${f.name}`} />
            <div className="flex items-start justify-between gap-2">
              <div className="pointer-events-none relative z-10 min-w-0">
                <span className="block truncate text-base font-semibold">{f.name}</span>
                {f.season && !f.name.includes(f.season) ? <div className="mt-1 text-xs text-neutral-500">{f.season}</div> : null}
              </div>
              <div className="relative z-10 flex shrink-0 items-center gap-1">
                <Link href={`/budget/pcs/${f.id}`} className={ICON} aria-label={`Открыть: ${f.name}`} title="Открыть">{svg("M14 4H7a1 1 0 0 0-1 1v15M14 4v16M14 4l5 1.5V19l-5 1M3 20h18")}</Link>
                {canEdit ? (
                  <>
                    <button type="button" className={ICON} onClick={() => setDialog({ kind: "rename", f })} aria-label={`Переименовать: ${f.name}`} title="Переименовать">{svg("M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4")}</button>
                    <button type="button" className={ICON} disabled={busy} onClick={() => run(() => duplicatePcs(f.id))} aria-label={`Копия: ${f.name}`} title="Сделать копию">{svg("M9 9h11v11H9zM5 15V6a2 2 0 0 1 2-2h9")}</button>
                    <button type="button" className={ICON + " hover:text-red-700"} onClick={() => setDialog({ kind: "delete", f })} aria-label={`Удалить: ${f.name}`} title="Удалить">{svg("M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3")}</button>
                  </>
                ) : null}
              </div>
            </div>
            <p className="pointer-events-none relative z-10 mt-3 text-xs text-neutral-600">Штуки, расход шкур на изделие (AVG) и итог шкур (TTL) по типам меха, категориям и длинам. Можно править в режиме «Детально» и скачать в Excel.</p>
            <p className="mt-2 text-[11px] text-neutral-600">Изменён {dateRu(f.updatedAt)}{f.updatedBy ? ` · ${f.updatedBy}` : ""}</p>
          </li>
        ))}
      </ul>
      {dialog?.kind === "new" ? <NameDialog title="Новый файл Budget PCS" items={items} busy={busy} onClose={() => setDialog(null)} onSave={(name, season, fromId) => run(() => createPcs({ name, season, fromId }), (id) => router.push(`/budget/pcs/${id}`))} /> : null}
      {dialog?.kind === "rename" ? <NameDialog title="Переименовать файл" f={dialog.f} busy={busy} onClose={() => setDialog(null)} onSave={(name, season) => run(() => renamePcs(dialog.f.id, name, season))} /> : null}
      {dialog?.kind === "delete" ? (
        <Modal title="Удалить файл?" onClose={() => setDialog(null)}>
          <p className="text-sm text-neutral-700">Файл «{dialog.f.name}» будет удалён вместе с введёнными значениями. Это нельзя отменить.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setDialog(null)}>Отмена</button>
            <button type="button" disabled={busy} className="inline-flex min-h-10 items-center rounded-lg bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 md:min-h-8" onClick={() => run(() => removePcs(dialog.f.id))}>Удалить</button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function NameDialog({ title, f, items, busy, onClose, onSave }: { title: string; f?: PcsCard; items?: PcsCard[]; busy: boolean; onClose: () => void; onSave: (name: string, season: string, fromId?: string) => void }) {
  const [name, setName] = useState(f?.name ?? "");
  const [season, setSeason] = useState(f?.season ?? "");
  const [from, setFrom] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSave(name, season, from || undefined); }}>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Название<input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={FIELD} maxLength={80} /></label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Сезон<input value={season} onChange={(e) => setSeason(e.target.value)} className={FIELD} maxLength={40} placeholder="2027" /></label>
        {items && items.length ? (
          <label className="flex flex-col gap-1 text-xs text-neutral-500">Взять значения из
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={FIELD}><option value="">Расчёт по данным системы</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={BTN} onClick={onClose}>Отмена</button>
          <button type="submit" disabled={busy || !name.trim()} className={BTN_PRIMARY}>{f ? "Сохранить" : "Создать"}</button>
        </div>
      </form>
    </Modal>
  );
}
