"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cancelShipment, markShipped, updateShippedShipment } from "../actions";

export function PlannedActions({ id, today }: { id: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [date, setDate] = useState(today);

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        setMarking(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!marking && (
          <Button onClick={() => setMarking(true)} disabled={pending}>
            Отметить отгруженной
          </Button>
        )}
        <Link href={`/shipments/${id}/edit`} className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-50">
          Изменить
        </Link>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (confirm("Отменить отгрузку? Запись останется в журнале со статусом «Отменена».")) run(() => cancelShipment(id));
          }}
        >
          Отменить отгрузку
        </Button>
      </div>
      {marking && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-3">
          <div>
            <Label htmlFor="shippedDate">Фактическая дата отгрузки</Label>
            <Input id="shippedDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          <Button disabled={pending} onClick={() => run(() => markShipped(id, date))}>
            {pending ? "Сохраняем..." : "Подтвердить"}
          </Button>
          <Button variant="ghost" onClick={() => setMarking(false)}>
            Отмена
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function ShippedEdit({ id, shippedDate, notes }: { id: string; shippedDate: string; notes: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(shippedDate);
  const [text, setText] = useState(notes);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="flex max-w-xl flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSaved(false);
        start(async () => {
          const r = await updateShippedShipment(id, date, text);
          if (r.error) setError(r.error);
          else {
            setSaved(true);
            router.refresh();
          }
        });
      }}
    >
      <div className="text-sm font-medium">Правка отгруженной: только дата и заметка</div>
      <div>
        <Label htmlFor="sd">Фактическая дата отгрузки</Label>
        <Input id="sd" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" required />
      </div>
      <div>
        <Label htmlFor="sn">Заметка</Label>
        <Textarea id="sn" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Сохранить
        </Button>
        {saved && <span className="text-sm text-emerald-600">Сохранено</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}
