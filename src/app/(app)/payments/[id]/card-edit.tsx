"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-dialog";
import { deletePaymentCard, updatePaymentCard, type CardConfirm } from "../card-actions";
import { ICON_BTN, ICON_BTN_DANGER, IconPencil, IconTrash } from "@/components/icons";

export type CardEditProps = {
  code: string;
  version: string;
  defaults: { amount: string; paidAt: string; method: string; invoiceNo: string; ppNo: string; notes: string; purchaseId: string };
  /** Закупки того же поставщика для переноса оплаты; null — привязку здесь не меняют. */
  targets: { id: string; label: string }[] | null;
  /** Текущая привязка словами (для подписи поля). */
  linkText: string;
  /** Сколько записей в этой оплате (мастер разносит одну оплату на несколько записей). */
  parts: number;
  confirmed: boolean;
};

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-neutral-500 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

function ChangesBox({ c }: { c: CardConfirm }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">Что изменится</h3>
      <ul className="flex flex-col gap-1">
        {c.changes.map((x) => (
          <li key={x.label}><b>{x.label}:</b> <span className="text-neutral-600">{x.from}</span> → <b>{x.to}</b></li>
        ))}
      </ul>
      {c.effects.length > 0 && <ul className="list-disc pl-4 text-neutral-700">{c.effects.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {c.warns.length > 0 && <ul className="list-disc rounded-md bg-red-50 py-2 pl-6 pr-2 text-red-700">{c.warns.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    </div>
  );
}

/** Правка оплаты на месте: «Изменить» открывает форму прямо в карточке, «Удалить» спрашивает подтверждение. Действия — в ../card-actions.ts. */
export function PaymentCardEdit(p: CardEditProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const { ask, node } = useConfirm();

  function save(form: HTMLFormElement) {
    const fd = new FormData(form);
    setError("");
    startTransition(async () => {
      try {
        let res = await updatePaymentCard(p.code, fd);
        if (res.confirm) {
          if (!(await ask(<ChangesBox c={res.confirm} />, { ok: "Сохранить изменения", danger: res.confirm.danger, wide: true }))) return;
          fd.set("confirmChange", "1");
          res = await updatePaymentCard(p.code, fd);
        }
        if (res.error) { setError(res.error); return; }
        setOpen(false);
        router.refresh();
      } catch {
        setError("Не удалось сохранить: сервер отклонил запрос или пропала связь. Введённое сохранено в форме — попробуйте ещё раз.");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const text = (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Удалить оплату?</h3>
          <p>Оплата будет удалена, остатки по закупкам и долг пересчитаются. Действие нельзя отменить.</p>
          {p.confirmed && <p className="rounded-md bg-red-50 px-2 py-1 text-red-700">Оплата подтверждена: подтверждение связанных закупок или партии тоже сбросится.</p>}
          {p.parts > 1 && <p className="text-neutral-700">Эта оплата разнесена на {p.parts} записей — удаляется только эта запись, остальные части останутся.</p>}
        </div>
      );
      if (!(await ask(text, { ok: "Удалить", danger: true }))) return;
      setError("");
      try {
        const res = await deletePaymentCard(p.code);
        if (res.error) { setError(res.error); return; }
        router.push("/payments");
        router.refresh();
      } catch {
        setError("Не удалось удалить. Попробуйте ещё раз.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 print:hidden">
      {node}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className={open ? undefined : ICON_BTN} onClick={() => setOpen((v) => !v)} disabled={pending} title="Изменить">{open ? "Закрыть форму" : <IconPencil />}</Button>
        <Button type="button" variant="ghost" size="sm" className={ICON_BTN_DANGER} onClick={remove} disabled={pending} title="Удалить" aria-label="Удалить"><IconTrash /></Button>
      </div>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {open && (
        <form
          onSubmit={(e) => { e.preventDefault(); save(e.currentTarget); }}
          className="grid grid-cols-1 gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 sm:grid-cols-2"
        >
          <input type="hidden" name="_v" value={p.version} />
          {p.parts > 1 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-2">
              Эта оплата разнесена на {p.parts} записей. Дата, способ, № счёта и № п/п изменятся у всех частей; сумма, привязка и заметка — только у этой записи.
            </p>
          )}
          <Field label="Сумма, ₽"><Input name="amount" inputMode="decimal" defaultValue={p.defaults.amount} required /></Field>
          <Field label="Дата оплаты"><Input name="paidAt" type="date" defaultValue={p.defaults.paidAt} required /></Field>
          <Field label="Способ оплаты">
            <Select name="method" defaultValue={p.defaults.method}>
              <option value="BANK_TRANSFER">Банковский перевод</option>
              <option value="CASH">Наличные</option>
              <option value="CARD">Карта</option>
              <option value="OTHER">Другое</option>
            </Select>
          </Field>
          <Field label="№ счёта"><Input name="invoiceNo" defaultValue={p.defaults.invoiceNo} maxLength={40} autoComplete="off" /></Field>
          <Field label="№ п/п"><Input name="ppNo" defaultValue={p.defaults.ppNo} maxLength={40} autoComplete="off" /></Field>
          {p.targets ? (
            <Field label="Привязка">
              <Select name="targetPurchaseId" defaultValue={p.defaults.purchaseId}>
                {p.defaults.purchaseId === "" && <option value="">Без привязки (аванс)</option>}
                {p.targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Привязка"><span className="py-2 text-sm text-neutral-800">{p.linkText}</span></Field>
          )}
          <Field label="Заметка" wide><Textarea name="notes" rows={2} defaultValue={p.defaults.notes} maxLength={1000} /></Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Отмена</Button>
          </div>
        </form>
      )}
    </div>
  );
}
