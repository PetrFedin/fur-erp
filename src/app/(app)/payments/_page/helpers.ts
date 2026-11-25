import { formatMoney, formatPercent } from "@/lib/utils";
import { tidyDocRef } from "@/lib/pay-ref";
import { defineFilters, pick, type FilterSchema, type FilterValues } from "@/lib/filters";
import { type AuctionPay } from "@/lib/auction-payments";
import { docNo } from "@/lib/payment-parties";
import { loadPaymentsLeft } from "@/lib/payments-overview";

export async function overviewLeft(orgId: string) {
  const l = await loadPaymentsLeft(orgId);
  return { byYear: Object.fromEntries(l.byYear), raw: l.raw, prod: l.prod, advance: l.advance };
}

// Баннер ?error= показываем только для известных кодов — произвольный текст из URL не выводим.
export const FLASH_ERRORS: Record<string, string> = {
  forbidden: "Недостаточно прав для этого действия",
  "not-found": "Запись не найдена или уже удалена",
  invalid: "Проверьте поля формы",
};

/** Процент с нужной точностью: малые доли не округляем до нуля. */
export function fmtPct(v: number): string {
  return formatPercent(v);
}

/** Остаток: отрицательный — «переплата X ₽». */
export function isPastRu(date: string): boolean {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59).getTime() < Date.now() : false;
}

export function fmtRemaining(r: { toString(): string; lessThan(n: number): boolean; neg(): { toString(): string } }): string {
  // Остаток в пределах копейки — ноль, а не «-0 ₽».
  return r.lessThan(-0.005) ? `Переплата ${formatMoney(r.neg().toString())}` : r.lessThan(0.005) ? formatMoney("0") : formatMoney(r.toString());
}

export const FRESH_MS = 365 * 24 * 3600 * 1000;

// Фильтры вкладок: поставщикам — партия закупки (мультивыбор), поиск по названию, поставщик, остаток, подтверждение, период оплат;
// от заказчиков — заказчик, подтверждение, период. `f=rest` — старое имя «С остатком».
export const PAY_FILTERS = defineFilters({
  ptype: { kind: "multi", label: "Тип оплаты", allowed: ["ADVANCE", "PARTIAL", "FINAL"] },
  stat: { kind: "multi", label: "Статья", allowed: ["raw", "prod"] },
  ...pick(["auction", "q", "from", "to", "tab", "batch"], {
    q: { aliases: ["dq"], label: "Название партии" },
    from: { label: "Оплата с" },
    to: { label: "Оплата по" },
  }),
});

export type PayFilterValues = typeof PAY_FILTERS extends FilterSchema<infer D> ? FilterValues<D> : never;

export const KIND_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Окончательный расчёт",
  OTHER: "Другое",
};

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Окончательный расчёт",
};

export const INVOICE_RX = /сч[её]т[^№;·]*№\s*([^\s;·,()]+)(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i;

/** Счёт оплаты: «103 от 03.07.2025» (слово «счёт» — в заголовке колонки). Берём из основания платежа, иначе из закупки. */
export function payInvoice(docRef: string | null, purchase?: { id: string; number: string; invoiceNumber: string | null } | null): { text: string; href?: string } | undefined {
  const m = INVOICE_RX.exec(docRef ?? "");
  const text = m ? docNo(m[1], m[2]) : purchase?.invoiceNumber ? docNo(purchase.invoiceNumber.replace(/^сч[её]т\s*/i, "")) : "";
  if (!text) return undefined;
  return { text, href: purchase ? `/purchases/${purchase.id}` : undefined };
}

/** Комментарий к оплате: основание без п/п (своя колонка), без счёта (своя колонка) и без повтора даты платежа. */
export function payComment(docRef: string | null, dateText: string): string {
  return tidyDocRef(docRef, dateText)
    .split(" · ")
    .filter((x) => !/^п\/п\s*№?\s*\d+/i.test(x) && !INVOICE_RX.test(x))
    .join(" · ");
}

// Год и месяц партии закупки — из названия («СП 09.26» → 2026-09); без года — в конце.
export const auctionPeriod = (name: string) => {
  const m = /(\d{2})[-.](\d{2})\s*$/.exec(name.trim());
  return m ? { year: 2000 + Number(m[2]), month: Number(m[1]) } : null;
};
export const sortByPeriod = (list: AuctionPay[]) =>
  [...list].sort((a, b) => {
    const pa = auctionPeriod(a.name), pb = auctionPeriod(b.name);
    if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
    return pa.year - pb.year || pa.month - pb.month;
  });
