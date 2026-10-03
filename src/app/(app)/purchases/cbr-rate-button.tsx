"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCbrRate } from "./cbr-actions";

/**
 * «Подставить курс ЦБ на дату»: запрашивает курс и кладёт его в поле exchangeRate
 * той же формы. Ничего не сохраняет — пользователь проверяет и жмёт обычную кнопку формы.
 * dateInputId — id поля даты в форме (форма закупки); без него показываем своё поле даты.
 */
export function CbrRateButton({
  currency,
  defaultDate,
  dateInputId,
}: {
  currency: string;
  defaultDate?: string;
  dateInputId?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, start] = useTransition();

  function run() {
    const iso = dateInputId ? ((document.getElementById(dateInputId) as HTMLInputElement | null)?.value ?? "") : date;
    setMsg(null);
    start(async () => {
      let res;
      try {
        res = await getCbrRate(currency, iso);
      } catch {
        setMsg({ text: "Не удалось получить курс. Введите курс вручную.", error: true });
        return;
      }
      if (res.error || !res.rate) {
        setMsg({ text: res.error ?? "Курс не получен.", error: true });
        return;
      }
      const input = ref.current?.closest("form")?.elements.namedItem("exchangeRate") as HTMLInputElement | null;
      if (!input) return;
      // Поле «Курс закупки» текстовое (запятая), остальные — type=number (точка).
      const value = input.type === "number" ? res.rate : res.rate.replace(".", ",");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      setMsg({ text: `Курс ЦБ на ${res.date}: ${res.rate.replace(".", ",")} — проверьте и сохраните.`, error: false });
    });
  }

  // Для рублёвой закупки курс всегда 1 — кнопка не нужна.
  if (currency === "RUB") return null;

  return (
    <span ref={ref} className="flex flex-wrap items-end gap-2">
      {!dateInputId && (
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" aria-label="Дата курса ЦБ" />
      )}
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={run}>
        {pending ? "Запрос к ЦБ…" : "Подставить курс ЦБ на дату"}
      </Button>
      {msg && <span className={"text-xs " + (msg.error ? "text-red-600" : "text-neutral-500")}>{msg.text}</span>}
    </span>
  );
}
