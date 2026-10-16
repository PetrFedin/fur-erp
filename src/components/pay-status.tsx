import { InfoHint } from "@/components/info-hint";
import { formatDate, formatMoney } from "@/lib/utils";
import { PAY_KIND_LABEL, PAY_STATE_LABEL, type PayInfo } from "@/lib/supplier-pay-core";

const CLS = { PAID: "bg-green-100 text-green-800", PARTIAL: "bg-amber-100 text-amber-900", UNPAID: "bg-neutral-100 text-neutral-700" } as const;

/** Подсказка «i» — одна на все места, где подрядчик видит статус оплаты. */
export const PAY_HINT = "Статус появляется, когда мы подтвердили оплату у себя. Снимем подтверждение — статус обновится. Показаны только оплаты вашего счёта, аукциона или ТЗ.";

/** Чип «Оплачено / Частично / Не оплачено» (+ сумма и дата последней подтверждённой оплаты). info = null — оплат не касается: ничего не рисуем. */
export function PayChip({ info, compact = false }: { info: PayInfo | null; compact?: boolean }) {
  if (!info) return null;
  const tail = info.paid > 0 ? ` · ${formatMoney(info.paid)}${info.date ? ` · ${formatDate(info.date)}` : ""}` : "";
  return (
    <span className="inline-flex items-center gap-1">
      <span data-testid="pay-status" data-state={info.state} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${CLS[info.state]}`}>{PAY_STATE_LABEL[info.state]}{compact ? "" : tail}</span>
      {compact && info.paid > 0 && <span className="whitespace-nowrap text-xs tabular-nums text-neutral-600">{formatMoney(info.paid)}{info.date ? ` · ${formatDate(info.date)}` : ""}</span>}
      <InfoHint label="Об оплате">{PAY_HINT}</InfoHint>
    </span>
  );
}

/** Список подтверждённых оплат: «Аванс — 1 000 000 ₽ · 05.10.2026». Пусто — ничего. */
export function PayLines({ info }: { info: PayInfo | null }) {
  if (!info || info.lines.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs tabular-nums text-neutral-700">
      {info.lines.map((l, i) => <li key={i}>{PAY_KIND_LABEL[l.kind] ?? "Оплата"} — <b>{formatMoney(l.amount)}</b> · {formatDate(l.paidAt)}</li>)}
    </ul>
  );
}
