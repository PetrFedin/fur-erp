"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { updateSellingPrice } from "../models/actions";

/** Розничная цена модели: сохраняется по Enter или при уходе из поля, если значение изменилось. */
export function ArticlePriceForm({ modelId, sellingPrice, mobile = false }: { modelId: string; sellingPrice: string; mobile?: boolean }) {
  const bound = updateSellingPrice.bind(null, modelId);
  const formRef = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState(sellingPrice);
  const [value, setValue] = useState(sellingPrice);
  const [pending, setPending] = useState(false);
  const dirty = value !== saved;

  return (
    <form
      ref={formRef}
      id={mobile ? `price-m-${modelId}` : `price-${modelId}`}
      action={async (formData) => {
        if (value === saved) return;
        setPending(true);
        const res = await bound(formData);
        setPending(false);
        if (res?.error) window.alert(res.error);
        else setSaved(value);
      }}
      className="flex flex-wrap items-center gap-1"
    >
      <Input
        name="sellingPrice"
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (dirty && !pending) formRef.current?.requestSubmit();
        }}
        aria-label="Розничная цена"
        title="Цена применяется к незавершённым ТЗ (в плане и в работе); у завершённых не меняется"
        className="h-8 w-28"
      />
      <span className={`text-xs ${pending ? "text-neutral-500" : dirty ? "text-neutral-500" : saved ? "text-neutral-500" : "text-amber-600"}`}>
        {pending ? "Сохраняю…" : dirty ? "Enter — сохранить; цена применяется к незавершённым ТЗ" : saved ? "Задана" : "Не задана"}
      </span>
    </form>
  );
}
