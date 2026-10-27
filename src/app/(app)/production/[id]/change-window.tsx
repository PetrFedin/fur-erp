"use client";

import { useState, type ReactNode } from "react";
import { formatMoney, formatQty } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { previewOrderEdit, type EditPreview, type OrderEdit } from "../actions";

const UNIT_LABELS: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

export type ChangeField = { label: string; before: string; after: string };

function Line({ label, before, after }: ChangeField) {
  const same = before === after;
  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="py-1 pr-3 text-neutral-600">{label}</td>
      <td className="py-1 pr-2 text-right tabular-nums">{before}</td>
      <td className="py-1 pr-2 text-neutral-600">→</td>
      <td className={"py-1 text-right font-medium tabular-nums " + (same ? "" : "text-neutral-900")}>{after}</td>
    </tr>
  );
}

/** Окно «что изменится» (было → станет) для правки по месту на карточке ТЗ. */
export function ChangeView({ title, fields, pv }: { title: string; fields: ChangeField[]; pv: EditPreview }) {
  const money = (v: string) => formatMoney(v);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-semibold">{title}</p>
      {pv.completed ? <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">ТЗ завершено: правка пересчитает его себестоимость и стоимость готовой продукции на складе.</p> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-xs text-neutral-500">
            <th className="py-1 text-left font-medium" />
            <th className="py-1 pr-2 text-right font-medium">Было</th>
            <th />
            <th className="py-1 text-right font-medium">Станет</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => <Line key={f.label} {...f} />)}
          {pv.lots?.map((l) => (
            <Line key={l.name} label={`Остаток лота: ${l.name}`} before={`${formatQty(l.before)} ${UNIT_LABELS[l.unit] ?? l.unit}`} after={`${formatQty(l.after)} ${UNIT_LABELS[l.unit] ?? l.unit}`} />
          ))}
          {pv.cost ? <Line label="Себестоимость ТЗ (с 4 % и работой)" before={money(pv.cost.before)} after={money(pv.cost.after)} /> : null}
          {pv.unit ? <Line label="На 1 изделие" before={money(pv.unit.before)} after={money(pv.unit.after)} /> : null}
          {pv.stock ? <Line label="Стоимость готовой продукции на складе" before={money(pv.stock.before)} after={money(pv.stock.after)} /> : null}
        </tbody>
      </table>
      {pv.note ? <p className="text-xs text-neutral-600">{pv.note}</p> : null}
    </div>
  );
}

/**
 * Явное сохранение правки ТЗ: предпросмотр на сервере (в откатываемой транзакции) → окно «было → станет» → запись прежним действием.
 * Одно окно: отдельного подтверждения «ТЗ завершено» для таких правок нет — предупреждение уже в окне.
 */
export function useDraftEdit(orderId: string) {
  const { ask, node } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (title: string, edit: OrderEdit, fields: ChangeField[], write: () => Promise<{ error?: string } | void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const pv = await previewOrderEdit(orderId, edit);
      if (pv.error) { setError(pv.error); return false; }
      const ok = await ask(<ChangeView title={title} fields={fields} pv={pv} />, { ok: "Сохранить", wide: true });
      if (!ok) return false;
      const r = await write();
      if (r && r.error) { setError(r.error); return false; }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, setError, node };
}

/** «Не сохранено» + «Сохранить» / «Отменить» рядом с изменённой строкой. */
export function DraftBar({ dirty, busy, error, onSave, onCancel }: { dirty: boolean; busy: boolean; error: string | null; onSave: () => void; onCancel: () => void }): ReactNode {
  if (!dirty && !error) return null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center justify-end gap-1 text-xs font-normal">
      {dirty ? <span className="text-amber-700">Не сохранено</span> : null}
      {dirty ? (
        <>
          <button type="button" disabled={busy} onClick={onSave} className="rounded bg-neutral-900 px-2 py-0.5 text-white hover:bg-neutral-700 disabled:opacity-50">{busy ? "…" : "Сохранить"}</button>
          <button type="button" disabled={busy} onClick={onCancel} className="rounded border border-neutral-300 px-2 py-0.5 text-neutral-700 hover:bg-neutral-100 disabled:opacity-50">Отменить</button>
        </>
      ) : null}
      {error ? <span className="basis-full text-right text-red-600">{error}</span> : null}
    </span>
  );
}
