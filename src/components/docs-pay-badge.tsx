import { TONE_DOT, type Tone } from "@/lib/doc-panel";
import { cn } from "@/lib/utils";

/** Всё в порядке: документы есть, оплачено, платёжки на месте. Тогда индикатор не показываем. */
export function docsPayIsOk(a: { missing: number; noDocs?: boolean; payOk: boolean; proofMissing?: number }): boolean {
  return a.missing <= 0 && !a.noDocs && a.payOk && !(a.proofMissing && a.proofMissing > 0);
}

/**
 * Индикатор «документы и оплата» для списков: показывает только отклонения одним чипом
 * («нет документов: 2 · оплата 60%»). Если всё в порядке, не выводит ничего.
 */
export function DocsPayBadge({
  tone,
  missing,
  noDocs = false,
  payText,
  payOk = false,
  proofMissing = 0,
  className,
}: {
  tone: Tone;
  missing: number;
  noDocs?: boolean;
  payText: string;
  /** Оплачено полностью: текст оплаты не выводим. */
  payOk?: boolean;
  proofMissing?: number;
  className?: string;
}) {
  if (docsPayIsOk({ missing, noDocs, payOk, proofMissing })) return null;
  const parts = [
    noDocs ? "нет документов" : missing > 0 ? `нет документов: ${missing}` : null,
    payOk ? null : payText,
    proofMissing > 0 ? `платёжек нет: ${proofMissing}` : null,
  ].filter(Boolean) as string[];
  const bad = missing > 0 || noDocs || tone === "bad";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", bad ? "font-semibold text-red-700" : "text-amber-800", className)}
      title={parts.join(" · ")}
    >
      <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      {parts.join(" · ")}
    </span>
  );
}
