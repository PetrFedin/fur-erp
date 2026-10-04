"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { VerifyControl } from "@/components/verify-control";
import type { VerifyRow } from "@/lib/verification";
import { patchOrderRow, patchPaymentRow, patchPurchaseRow, bulkVerifyReady, type VerifyState } from "./actions";

const field = "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm";

/** Быстрый ручной ввод прямо в строке: дата, сумма, номер п/п / документа (через server actions правки). */
function QuickEdit({ row }: { row: VerifyRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  if (!row.edit) return null;
  const e = row.edit;
  const submit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setMsg({});
    start(async () => {
      let r: VerifyState;
      try {
        r = row.kind === "payment" || row.kind === "prodPayment" ? await patchPaymentRow(row.kind, row.id, fd) : row.kind === "purchase" ? await patchPurchaseRow(row.id, fd) : await patchOrderRow(row.id, fd);
      } catch {
        return setMsg({ error: "Не удалось сохранить: пропала связь или сервер отклонил запрос." });
      }
      if (r.error) setMsg({ error: r.error });
      else {
        setMsg({ ok: r.message });
        router.refresh();
      }
    });
  };
  const isPay = row.kind === "payment" || row.kind === "prodPayment";
  return (
    <details className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-neutral-700">Внести данные руками (дата, {isPay ? "сумма, п/п" : row.kind === "purchase" ? "номер документа" : "номер ТЗ"})</summary>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-neutral-500">
          {row.kind === "purchase" ? "Дата заказа" : row.kind === "order" ? "Дата ТЗ по документу" : "Дата оплаты"}
          <input name="date" type="date" defaultValue={e.date ?? ""} className={field} />
        </label>
        {isPay && (
          <label className="flex flex-col gap-1 text-neutral-500">
            Сумма, ₽
            <input name="amount" inputMode="decimal" defaultValue={e.amount ?? ""} className={`${field} w-36`} />
          </label>
        )}
        {(row.kind === "purchase" || row.kind === "order") && (
          <label className="flex flex-col gap-1 text-neutral-500">
            {row.kind === "purchase" ? "№ счёта / УПД" : "№ ТЗ"}
            <input name="number" defaultValue={e.number ?? ""} maxLength={100} className={`${field} w-40`} />
          </label>
        )}
        {(isPay || row.kind === "purchase") && (
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-neutral-500">
            {isPay ? "№ п/п / документ-основание" : "Передаточный документ (УПД)"}
            <input name="ref" defaultValue={e.ref ?? ""} maxLength={300} className={field} placeholder={isPay ? "напр. п/п №43831 от 12.05.2026; счёт Веллмех №131" : ""} />
          </label>
        )}
        <Button type="submit" size="sm" disabled={pending} className="max-md:h-9">
          {pending ? "Сохраняем…" : "Сохранить"}
        </Button>
        {msg.ok && <span className="text-emerald-700">{msg.ok}</span>}
        {msg.error && <span role="alert" className="w-full text-red-600">{msg.error}</span>}
      </form>
      <p className="mt-1.5 text-neutral-500">После правки подтверждение этой строки и связанных сбрасывается — проверьте и нажмите «Подтвердить» снова.</p>
    </details>
  );
}

export function VerifyRowCard({ row, canEdit, purchaseIds }: { row: VerifyRow; canEdit: boolean; purchaseIds?: string[] }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5" data-verify-row={row.key}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <Link href={row.href} className="text-sm font-semibold text-blue-700 hover:underline">
          {row.title}
        </Link>
        {row.amountText && row.kind !== "payment" && row.kind !== "prodPayment" && <span className="text-sm tabular-nums text-neutral-700">{row.amountText}</span>}
        {row.sub && <span className="min-w-0 break-words text-xs text-neutral-500">{row.sub}</span>}
        {row.year && <span className="rounded bg-neutral-100 px-1.5 text-xs text-neutral-600">{row.year}</span>}
      </div>
      {row.registryFact && !row.verified && <p className="text-xs text-emerald-700">Реестр сверки подтверждает: {row.registryFact}</p>}
      {row.members.length > 0 && <p className="text-xs text-neutral-500">ТЗ партии: {row.members.join(", ")}</p>}
      <VerifyControl v={row} canEdit={canEdit} compact purchaseIds={purchaseIds} />
      {canEdit && !row.verified && <QuickEdit row={row} />}
    </li>
  );
}

/** «Подтвердить все готовые (без блокеров)»: предпросмотр списка и подтверждение. */
export function BulkVerify({ items, canEdit }: { items: { key: string; title: string; kind: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  if (!canEdit) return null;
  if (items.length === 0) return <p className="text-xs text-neutral-500">Готовых к подтверждению строк без блокеров сейчас нет.</p>;
  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <div>
          <Button type="button" onClick={() => setOpen(true)} className="max-md:h-10 max-md:w-full">
            Подтвердить все готовые ({items.length})…
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-300 bg-white p-3">
          <p className="text-sm font-semibold">Будет подтверждено строк: {items.length} (только без замечаний; решение сервер проверит заново)</p>
          <ul className="max-h-64 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-neutral-700">
            {items.map((i) => (
              <li key={i.key}>{i.title}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setMsg({});
                  try {
                    const r = await bulkVerifyReady(items.map((i) => i.key));
                    if (r.error) setMsg({ error: r.error });
                    else {
                      setMsg({ ok: r.message });
                      setOpen(false);
                      router.refresh();
                    }
                  } catch {
                    setMsg({ error: "Не удалось выполнить: пропала связь или сервер отклонил запрос." });
                  }
                })
              }
            >
              {pending ? "Подтверждаем…" : "Да, подтвердить все"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Отмена
            </Button>
            {msg.error && <span role="alert" className="text-xs text-red-600">{msg.error}</span>}
          </div>
        </div>
      )}
      {msg.ok && <p className="text-xs text-emerald-700">{msg.ok}</p>}
    </div>
  );
}
