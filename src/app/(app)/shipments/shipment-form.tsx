"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { suggestSizeRows, type SizeRow } from "@/lib/shipments";
import type { ShipmentInput, ShipmentState } from "./actions";

export type FormOrder = {
  id: string;
  label: string; // «ТЗ №141»
  modelName: string;
  clientKey: string; // id заказчика или "none"
  sizeText: string;
  plannedQty: number;
  shippedElsewhere: number; // уже в других отгрузках (без отменённых)
};

export type ShipmentFormProps = {
  clients: { id: string; name: string }[];
  orders: FormOrder[];
  initial: {
    plannedDate: string;
    clientKey: string; // "" — не выбран
    notes: string;
    rows: Record<string, SizeRow[]>; // выбранные ТЗ и их строки
  };
  submit: (input: ShipmentInput) => Promise<ShipmentState>;
  submitLabel: string;
  cancelHref: string;
};

const fmt = (n: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n);

export function ShipmentForm({ clients, orders, initial, submit, submitLabel, cancelHref }: ShipmentFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [plannedDate, setPlannedDate] = useState(initial.plannedDate);
  const [clientKey, setClientKey] = useState(initial.clientKey);
  const [notes, setNotes] = useState(initial.notes);
  const [rows, setRows] = useState<Record<string, SizeRow[]>>(initial.rows);

  const list = clientKey ? orders.filter((o) => o.clientKey === clientKey) : [];

  function toggle(o: FormOrder, on: boolean) {
    setRows((prev) => {
      const next = { ...prev };
      if (on) {
        const rest = Math.max(0, o.plannedQty - o.shippedElsewhere);
        next[o.id] = suggestSizeRows(o.sizeText, rest || o.plannedQty);
      } else delete next[o.id];
      return next;
    });
  }
  function setRow(oid: string, i: number, patch: Partial<SizeRow>) {
    setRows((prev) => ({ ...prev, [oid]: prev[oid].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  }
  function addRow(oid: string) {
    setRows((prev) => ({ ...prev, [oid]: [...prev[oid], { size: "", quantity: "1" }] }));
  }
  function delRow(oid: string, i: number) {
    setRows((prev) => ({ ...prev, [oid]: prev[oid].filter((_, j) => j !== i) }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!plannedDate) return setError("Укажите плановую дату отгрузки");
    const lines: ShipmentInput["lines"] = [];
    for (const o of list) {
      for (const r of rows[o.id] ?? []) {
        const q = r.quantity.trim();
        if (q === "") continue;
        const n = Number(q.replace(",", "."));
        if (!Number.isInteger(n)) return setError(`${o.label}: количество должно быть целым числом`);
        if (n <= 0) continue;
        lines.push({ productionOrderId: o.id, size: r.size.trim() || undefined, quantity: n });
      }
    }
    if (lines.length === 0) return setError("Выберите ТЗ и укажите количество больше 0 хотя бы в одной строке");
    start(async () => {
      const res = await submit({
        plannedDate,
        clientId: clientKey && clientKey !== "none" ? clientKey : undefined,
        notes,
        lines,
      });
      if (res.error) setError(res.error);
      else router.push(`/shipments/${res.id}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <div>
          <Label htmlFor="plannedDate">Плановая дата отгрузки</Label>
          <Input id="plannedDate" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} className="w-44" required />
        </div>
        <div className="min-w-64 flex-1">
          <Label htmlFor="client">Заказчик</Label>
          <Select
            id="client"
            value={clientKey}
            onChange={(e) => {
              setClientKey(e.target.value);
              setRows({});
            }}
          >
            <option value="">— выберите заказчика —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">Без заказчика (свои ТЗ)</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium text-neutral-700">ТЗ к отгрузке</div>
        {!clientKey && <p className="text-sm text-neutral-500">Сначала выберите заказчика — здесь появятся его ТЗ.</p>}
        {clientKey && list.length === 0 && <p className="text-sm text-neutral-500">У этого заказчика нет ТЗ.</p>}
        {list.map((o) => {
          const on = o.id in rows;
          const rs = rows[o.id] ?? [];
          const inThis = rs.reduce((s, r) => {
            const n = Number(r.quantity.replace(",", "."));
            return s + (Number.isFinite(n) && n > 0 ? n : 0);
          }, 0);
          const remaining = o.plannedQty - o.shippedElsewhere - inThis;
          const over = o.shippedElsewhere + inThis > o.plannedQty;
          return (
            <div key={o.id} className={`rounded-lg border p-3 ${on ? "border-neutral-400 bg-white" : "border-neutral-200 bg-white"}`}>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={on} onChange={(e) => toggle(o, e.target.checked)} />
                <span>
                  <span className="font-medium">{o.label}</span>{" "}
                  <span className="text-neutral-600">
                    ({o.modelName}
                    {o.sizeText ? `, размеры ${o.sizeText}` : ""}, план {fmt(o.plannedQty)} шт., уже в отгрузках {fmt(o.shippedElsewhere)} шт.)
                  </span>
                </span>
              </label>
              {on && (
                <div className="mt-2 flex flex-col gap-1.5 pl-6">
                  <div className="grid grid-cols-[8rem_6rem_auto] gap-2 text-xs text-neutral-500">
                    <span>Размер</span>
                    <span>Кол-во</span>
                    <span />
                  </div>
                  {rs.map((r, i) => (
                    <div key={i} className="grid grid-cols-[8rem_6rem_auto] items-center gap-2">
                      <Input value={r.size} onChange={(e) => setRow(o.id, i, { size: e.target.value })} placeholder="—" aria-label="Размер" />
                      <Input
                        value={r.quantity}
                        inputMode="numeric"
                        onChange={(e) => setRow(o.id, i, { quantity: e.target.value })}
                        aria-label="Количество"
                      />
                      <button type="button" className="justify-self-start text-sm text-neutral-400 hover:text-red-600" onClick={() => delRow(o.id, i)} title="Удалить строку">
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <button type="button" className="text-neutral-600 hover:underline" onClick={() => addRow(o.id)}>
                      + размер
                    </button>
                    <span className="text-neutral-500">
                      {remaining >= 0 ? `осталось отгрузить ${fmt(remaining)} шт.` : ""}
                    </span>
                  </div>
                  {over && (
                    <p className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-700">
                      Внимание: в отгрузках по этому ТЗ будет {fmt(o.shippedElsewhere + inThis)} шт. при плане {fmt(o.plannedQty)} шт. Сохранить всё равно можно.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <Label htmlFor="notes">Заметка</Label>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Сохраняем..." : submitLabel}
        </Button>
        <Link href={cancelHref} className="text-sm text-neutral-500 hover:underline">
          Отмена
        </Link>
      </div>
    </form>
  );
}
