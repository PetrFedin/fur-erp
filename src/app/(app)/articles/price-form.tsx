"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/utils";
import { updateSellingPrice } from "../models/actions";

function groupDigits(raw: string): string {
  const t = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return raw;
  const [int, frac] = t.split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (frac ? "," + frac : "");
}

/** Проверка до отправки: то же, что parsePrice на сервере (сообщение показываем рядом с полем). */
function checkPrice(raw: string): string | null {
  const t = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (t === "") return null; // пусто — цена убирается
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return "Цена: укажите число";
  const n = Number(t);
  if (n < 0) return "Цена не может быть отрицательной";
  if (n === 0) return "Цена должна быть больше 0";
  return null;
}

/** Розничная цена модели: сохраняется по Enter или при уходе из поля, если значение изменилось. Без права правки — текст. */
export function ArticlePriceForm({
  modelId,
  sellingPrice,
  mobile = false,
  canEdit = true,
}: {
  modelId: string;
  sellingPrice: string;
  mobile?: boolean;
  canEdit?: boolean;
}) {
  const bound = updateSellingPrice.bind(null, modelId);
  const formRef = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState(sellingPrice);
  const [value, setValue] = useState(sellingPrice);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = value !== saved;
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 3000);
    return () => clearTimeout(t);
  }, [justSaved]);

  if (!canEdit) {
    return <span>{sellingPrice ? formatMoney(sellingPrice) : "—"}</span>;
  }

  return (
    <form
      ref={formRef}
      id={mobile ? `price-m-${modelId}` : `price-${modelId}`}
      action={async (formData) => {
        if (value === saved) {
          setError(null);
          return;
        }
        const msg = checkPrice(value);
        if (msg) {
          setError(msg);
          return;
        }
        setError(null);
        setPending(true);
        const res = await bound(formData);
        setPending(false);
        if (res?.error) setError(res.error);
        else {
          setSaved(value.trim());
          setJustSaved(true);
        }
      }}
      className="flex flex-wrap items-center justify-end gap-1"
    >
      <input type="hidden" name="sellingPrice" value={value} />
      <Input
        type="text"
        inputMode="decimal"
        value={focused ? value : value ? `${groupDigits(value)} ₽` : ""}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (dirty && !pending) formRef.current?.requestSubmit();
        }}
        aria-label="Розничная цена"
        aria-invalid={error ? true : undefined}
        title="Цена применяется к незавершённым ТЗ (в плане и в работе); у завершённых не меняется"
        className="ui-field h-8 w-36 rounded-lg text-right tabular-nums"
      />
      {dirty && !pending ? (
        <button type="submit" className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs font-medium hover:bg-neutral-50">Сохранить</button>
      ) : null}
      <span
        role={error ? "alert" : "status"}
        className={`text-xs ${error ? "text-red-600" : justSaved ? "text-emerald-700" : "text-neutral-500"}`}
      >
        {error ?? (pending ? "Сохраняю…" : justSaved ? "✓ Сохранено" : dirty ? "Не сохранено" : saved ? "" : "Не задана")}
      </span>
    </form>
  );
}
