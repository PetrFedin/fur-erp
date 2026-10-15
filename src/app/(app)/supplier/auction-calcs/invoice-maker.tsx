"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { PAYMENT_KINDS, defaultDescription, suggestAmount, type PaymentKind } from "@/lib/vendor-invoice-core";
import { WELLMEKH_REQ } from "@/lib/vendor-requisites";
import type { CalcPayload } from "@/lib/supplier-calc";

/** «Счёт на оплату (Excel)» по расчёту: сумма и текст подставляются из расчёта, вводятся только номер счёта, дата и спецификация. */
export function InvoiceMaker({ id, payload }: { id: string | null; payload: CalcPayload }) {
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<PaymentKind>("Аванс");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today);
  const [specNumber, setSpecNumber] = useState("");
  const [specDate, setSpecDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [desc, setDesc] = useState<string | null>(null);
  const [amt, setAmt] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState(true);
  const router = useRouter();
  const autoAmount = suggestAmount(kind, payload);
  const description = desc ?? defaultDescription(kind, payload, specNumber, specDate, WELLMEKH_REQ);
  const amount = amt ?? (autoAmount ? String(autoAmount).replace(".", ",") : "");
  const num = Number(amount.replace(/\s/g, "").replace(",", "."));

  const make = async () => {
    if (!number.trim()) return setMsg({ text: "Укажите номер счёта — это ваша нумерация", bad: true });
    if (!(num > 0)) return setMsg({ text: "Укажите сумму счёта", bad: true });
    setBusy(true);
    try {
      const res = await fetch(`/api/supplier/auction-calcs/${id ?? "new"}/invoice`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, number, date, specNumber, specDate, dueDate, description, amount: num, vat: payload.header.vat, attach: attach && !!id }),
      });
      if (!res.ok) return setMsg({ text: res.status === 422 ? "Для этого поставщика реквизиты счёта не заведены" : "Не удалось сформировать счёт", bad: true });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `Счет на оплату № ${number} от ${date.split("-").reverse().join(".")}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      const done = res.headers.get("X-Attached") === "1";
      setMsg({ text: done ? "Счёт скачан и приложен к расчёту — уйдёт нам вместе с ним. Проверьте его; при необходимости сохраните как PDF." : "Счёт скачан. Проверьте и при необходимости сохраните как PDF." });
      if (done) router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <details className="rounded-md border border-neutral-200 p-3">
      <summary className="cursor-pointer text-sm font-medium">Счёт на оплату (Excel) — собрать по расчёту</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-xs text-neutral-500">Реквизиты, договор №{WELLMEKH_REQ.contract.number} и текст подставляются сами; сумма — из расчёта («К оплате: аванс 1»), НДС выделяется из суммы. Введите номер счёта и спецификацию.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label>Вид платежа</Label><Select value={kind} onChange={(e) => { setKind(e.target.value as PaymentKind); setAmt(null); setDesc(null); }}>{PAYMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select></div>
          <div><Label>Номер счёта</Label><Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="141" /></div>
          <div><Label>Дата счёта</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>Спецификация №</Label><Input value={specNumber} onChange={(e) => { setSpecNumber(e.target.value); setDesc(null); }} placeholder="10" /></div>
          <div><Label>Дата спецификации</Label><Input type="date" value={specDate} onChange={(e) => { setSpecDate(e.target.value); setDesc(null); }} /></div>
          <div><Label>Оплатить не позднее (по желанию)</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Текст строки счёта</Label><Input value={description} onChange={(e) => setDesc(e.target.value)} /></div>
          <div><Label>Сумма, ₽ (с НДС)</Label><Input value={amount} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" /><p className="mt-1 text-xs text-neutral-500">У Веллмеха бывает округление до 100 — впишите сумму как в их счёте.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={make}>Скачать счёт (Excel)</Button>
          {id && <label className="flex items-center gap-1.5 text-xs text-neutral-600"><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />приложить к расчёту (уйдёт к нам вместе с ним)</label>}
          {msg && <span role="status" className={msg.bad ? "text-sm text-red-600" : "text-sm text-green-700"}>{msg.text}</span>}
        </div>
      </div>
    </details>
  );
}
