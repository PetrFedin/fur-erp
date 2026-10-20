"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateSellingPrice } from "@/app/(app)/models/actions";
import { useConfirm } from "@/components/confirm-dialog";
import { countOpenOrdersForModel } from "./actions";

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
  label = "Принять рекомендацию",
}: {
  modelId: string;
  modelName: string;
  /** Цена в рублях без пробелов, например "1850000". */
  price: string;
  priceText: string;
  currentText: string | null;
  /** Откуда цифра: «наценка 350%, база — материалы, без 4%». */
  basis: string;
  /** Текст кнопки; по умолчанию «Принять рекомендацию», из прайса — «Взять из прайса». */
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { ask, node } = useConfirm();

  const onClick = async () => {
    let n: number | null = null;
    try { n = await countOpenOrdersForModel(modelId); } catch { n = null; }
    const ok = await ask(
      <div className="space-y-1">
        <div className="font-semibold">Цена артикула {modelName}</div>
        <div>{currentText ? `было ${currentText}` : "было: не задана"} → станет {priceText}</div>
        <div className="text-xs text-neutral-600">Основание: {basis}.</div>
        <div className="text-xs text-neutral-600">{n == null ? "Цена перенесётся на ТЗ в плане и в работе" : `Перенесётся на ${n} ТЗ в плане и в работе`}; у завершённых не меняется.</div>
      </div>,
      { ok: label === "Принять рекомендацию" ? "Принять" : "Взять" },
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
        {pending ? "Сохраняю…" : label}
      </Button>
      {node}
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
