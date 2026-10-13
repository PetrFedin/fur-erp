"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { formatMoney } from "@/lib/utils";
import type { VerifyRow } from "@/lib/verification";
import { bulkVerifyReady } from "./actions";
import { VerifyRowCard } from "./row";

const KIND_LABEL: Record<string, string> = { payment: "Оплата поставщику", prodPayment: "Оплата производства", purchase: "Закупка", order: "ТЗ", batch: "Партия" };
const KIND_ORDER = ["payment", "prodPayment", "purchase", "order", "batch"];

/** «1 234,50 ₽» → 1234.5; не число — null. */
function moneyOf(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.replace(/[\s  ₽]/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}
const amountOf = (r: VerifyRow) => moneyOf(r.edit?.amount) ?? moneyOf(r.amountText);

type Item = { row: VerifyRow; canEdit: boolean };

/**
 * Очередь подтверждения: чекбоксы у строк «готово к подтверждению», «Подтвердить выбранные» и «Подтвердить все готовые».
 * Окно «Что будет подтверждено» (сущности и суммы); подтверждаются только строки без замечаний — сервер проверяет заново.
 */
export function VerifyQueue({ items, readyAll }: { items: Item[]; readyAll: { key: string; row: VerifyRow }[] }) {
  const router = useRouter();
  const { ask, node } = useConfirm();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const selectable = useMemo(() => items.filter((i) => !i.row.verified && i.row.ready && i.canEdit).map((i) => i.row.key), [items]);
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function run(rows: VerifyRow[], scope: string) {
    if (rows.length === 0) return;
    const groups = KIND_ORDER.map((k) => ({ k, rows: rows.filter((r) => r.kind === k) })).filter((g) => g.rows.length > 0);
    const text = (
      <div className="flex flex-col gap-2">
        <p className="font-semibold">Что будет подтверждено ({scope}): {rows.length}</p>
        {groups.map((g) => {
          const amounts = g.rows.map(amountOf);
          const sum = amounts.every((a) => a !== null) ? amounts.reduce((s, a) => s + (a as number), 0) : null;
          return (
            <div key={g.k}>
              <div className="text-xs font-medium text-neutral-500">{KIND_LABEL[g.k]}: {g.rows.length}{sum !== null ? ` · на сумму ${formatMoney(sum)}` : ""}</div>
              <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-neutral-700">
                {g.rows.map((r) => <li key={r.key}>{r.title}{r.sub ? ` — ${r.sub.slice(0, 60)}` : ""}{amountOf(r) !== null ? ` · ${r.amountText ?? formatMoney(amountOf(r)!)}` : ""}</li>)}
              </ul>
            </div>
          );
        })}
        <p className="text-xs text-neutral-500">Подтверждаются только строки без замечаний (сервер проверит заново); отметка «подтвердил» и журнал изменений пишутся как при обычном «Подтвердить».</p>
      </div>
    );
    if (!(await ask(text, { ok: `Подтвердить (${rows.length})`, wide: true }))) return;
    setMsg({});
    start(async () => {
      try {
        const r = await bulkVerifyReady(rows.map((x) => x.key));
        if (r.error) setMsg({ error: r.error });
        else {
          setMsg({ ok: r.message });
          setSel(new Set());
          router.refresh();
        }
      } catch {
        setMsg({ error: "Не удалось выполнить: пропала связь или сервер отклонил запрос." });
      }
    });
  }

  const selectedRows = items.filter((i) => sel.has(i.row.key)).map((i) => i.row);
  return (
    <div className="flex flex-col gap-3">
      {node}
      <div className="flex flex-wrap items-center gap-2" data-verify-toolbar>
        {selectable.length > 0 && (
          <>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setSel(new Set(selectable))} className="btn-accent max-md:h-9">Выбрать все готовые на странице ({selectable.length})</Button>
            <Button type="button" variant="outline" size="sm" disabled={pending || sel.size === 0} onClick={() => setSel(new Set())} className="max-md:h-9">Снять выбор</Button>
            <Button type="button" size="sm" disabled={pending || sel.size === 0} onClick={() => run(selectedRows, "выбранные")} className="max-md:h-9">Подтвердить выбранные ({sel.size})</Button>
          </>
        )}
        {readyAll.length > 0 ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => run(readyAll.map((x) => x.row), "все готовые")} className="max-md:h-9">Подтвердить все готовые ({readyAll.length}, по всем вкладкам)…</Button>
        ) : (
          <span className="text-xs text-neutral-500">Готовых к подтверждению строк без замечаний сейчас нет.</span>
        )}
        {pending && <span className="text-xs text-neutral-500">Подтверждаем…</span>}
        {msg.ok && <span className="text-xs text-emerald-700" role="status">{msg.ok}</span>}
        {msg.error && <span className="text-xs text-red-600" role="alert">{msg.error}</span>}
      </div>
      {items.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {items.map(({ row, canEdit }) => {
            const can = !row.verified && row.ready && canEdit;
            return (
              <li key={row.key} className="flex items-start gap-2">
                {can ? (
                  <input type="checkbox" checked={sel.has(row.key)} onChange={() => toggle(row.key)} aria-label={`Выбрать: ${row.title}`} className="mt-3.5 size-4 shrink-0" />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <ul><VerifyRowCard row={row} canEdit={canEdit} /></ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
