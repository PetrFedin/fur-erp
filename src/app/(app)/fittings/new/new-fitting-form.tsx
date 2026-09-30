"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { PhotoPicker, validatePicked } from "../photo-picker";
import { FITTING_STATUS, FITTING_STATUS_KEYS } from "@/lib/fittings";

export type OrderOption = { id: string; label: string; sizes: string[] };

function defaultStatus(date: string, today: string) {
  return date > today ? "PLANNED" : "HELD_OK";
}

export function NewFittingForm({
  orders,
  initialOrderId,
  today,
}: {
  orders: OrderOption[];
  initialOrderId: string;
  today: string;
}) {
  const router = useRouter();
  const initial = orders.find((o) => o.id === initialOrderId);
  const [orderText, setOrderText] = useState(initial?.label ?? "");
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState(defaultStatus(today, today));
  const [statusTouched, setStatusTouched] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const order = orders.find((o) => o.label === orderText.trim());
  const sizes = order?.sizes ?? [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!order) return setError("Выберите ТЗ из списка: начните вводить № ТЗ или модель");
    const pickErr = validatePicked(files);
    if (pickErr) return setError(pickErr);
    const fd = new FormData(e.currentTarget);
    fd.set("orderId", order.id);
    fd.set("date", date);
    fd.set("status", status);
    for (const f of files) fd.append("photos", f);
    setPending(true);
    try {
      const res = await fetch("/api/fittings", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? `Не удалось сохранить (ошибка ${res.status})`);
        setPending(false);
        return;
      }
      router.push(`/fittings/${data.id}`);
    } catch {
      setError("Нет связи с сервером — примерка не сохранена");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="orderText">ТЗ</Label>
        <Input
          id="orderText"
          list="order-options"
          value={orderText}
          onChange={(e) => setOrderText(e.target.value)}
          placeholder="№ ТЗ или модель — начните вводить"
          autoComplete="off"
          required
        />
        <datalist id="order-options">
          {orders.map((o) => (
            <option key={o.id} value={o.label} />
          ))}
        </datalist>
        {orderText && !order && <p className="text-xs text-amber-700">Выберите вариант из выпадающего списка</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="date">Дата</Label>
          <Input
            id="date"
            type="date"
            value={date}
            required
            onChange={(e) => {
              setDate(e.target.value);
              if (!statusTouched && e.target.value) setStatus(defaultStatus(e.target.value, today));
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="size">Размер (необязательно)</Label>
          <Input id="size" name="size" list="size-options" placeholder="напр. 46" autoComplete="off" />
          <datalist id="size-options">
            {sizes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {sizes.length > 1 && <p className="text-xs text-neutral-500">В ТЗ размеры: {sizes.join(", ")}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Итог</Label>
          <Select
            id="status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setStatusTouched(true);
            }}
          >
            {FITTING_STATUS_KEYS.map((k) => (
              <option key={k} value={k}>
                {FITTING_STATUS[k].label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comment">Комментарий</Label>
        <Textarea id="comment" name="comment" rows={5} maxLength={5000} placeholder="Что сидит не так, что поправить, кто присутствовал" />
      </div>

      <div className="flex flex-col gap-1">
        <Label>Фото</Label>
        <PhotoPicker files={files} onChange={setFiles} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
