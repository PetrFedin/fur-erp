"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateSellingPrice } from "@/app/(app)/models/actions";

/**
 * «Принять рекомендацию»: записывает рекомендуемую цену как розничную цену модели — тем же действием,
 * что и поле цены на странице «Изделия» (updateSellingPrice: права проверяются на сервере).
 * Перед записью — подтверждение с цифрами.
 */
export function AcceptPriceButton({
  modelId,
  modelName,
  price,
  priceText,
  currentText,
  basis,
}: {
  modelId: string;
  modelName: string;
  /** Цена в рублях без пробелов, например "1850000". */
  price: string;
  priceText: string;
  currentText: string | null;
  /** Откуда цифра: «наценка 350%, база — материалы, без 4%». */
  basis: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onClick = () => {
    const ok = window.confirm(
      `Модель ${modelName}: установить розничную цену ${priceText}?\n` +
        (currentText ? `Сейчас: ${currentText}.\n` : "Сейчас цена не задана.\n") +
        `Основание: ${basis}.\n` +
        "Цена применится и к незавершённым ТЗ этой модели (в плане и в работе); у завершённых не меняется.",
    );
    if (!ok) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("sellingPrice", price);
      const res = await updateSellingPrice(modelId, fd);
      if (res?.error) setError(res.error);
      else {
        setDone(true);
        router.refresh();
      }
    });
  };

  if (done) return <span className="text-xs text-emerald-700">Цена задана</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onClick} className="max-md:h-10">
        {pending ? "Сохраняю…" : "Принять рекомендацию"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
