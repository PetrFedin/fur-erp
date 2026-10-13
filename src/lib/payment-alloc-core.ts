/**
 * Разнесение оплаты производства по ТЗ: чистая логика без БД (используется страницами, действиями, скриптом и тестом).
 *
 * Модель: у платежа есть сумма (ProductionPayment.amount) и строки разнесения (PaymentAllocation: ТЗ + сумма).
 * Правило: Σ строк <= сумма платежа; остаток платежа — «неразнесённый аванс» (не относится ни к одному ТЗ).
 * Все расчёты — в копейках (целые числа), чтобы сумма долей совпадала с суммой платежа до копейки.
 */

export const toCents = (v: number | string | { toString(): string }): number => Math.round(Number(v.toString()) * 100);
export const fromCents = (c: number): string => (c / 100).toFixed(2);

export type SplitItem = {
  id: string;
  /** Вес доли — работа ТЗ, коп. Нулевой вес — ТЗ ничего не получает. */
  weight: number;
  /** Сколько ещё можно отнести на ТЗ (работа минус уже разнесённое), коп. */
  cap: number;
};

/**
 * Делит сумму `total` (коп.) между ТЗ пропорционально весу, но не больше `cap` у каждого.
 * Если на все ТЗ хватает с запасом (сумма >= Σcap) — каждое получает свой cap, лишнее остаётся неразнесённым.
 * Если веса нулевые, ничего не делится (однозначного распределения нет).
 */
export function splitByWeights(total: number, items: SplitItem[]): Map<string, number> {
  const out = new Map<string, number>();
  let active = items.filter((i) => i.weight > 0 && i.cap > 0);
  let left = total;
  while (left > 0 && active.length > 0) {
    const sumCap = active.reduce((s, i) => s + i.cap, 0);
    if (left >= sumCap) {
      for (const i of active) out.set(i.id, i.cap);
      break;
    }
    const sumW = active.reduce((s, i) => s + BigInt(i.weight), BigInt(0));
    const L = BigInt(left);
    const parts = active.map((i) => {
      const num = L * BigInt(i.weight);
      return { i, share: Number(num / sumW), frac: num % sumW };
    });
    let given = parts.reduce((s, p) => s + p.share, 0);
    // остаток копеек — тем, у кого дробная часть больше (при равенстве — по порядку ТЗ)
    const order = parts.map((p, idx) => ({ p, idx })).sort((a, b) => (a.p.frac === b.p.frac ? a.idx - b.idx : a.p.frac > b.p.frac ? -1 : 1));
    for (const { p } of order) {
      if (given >= left) break;
      p.share += 1;
      given += 1;
    }
    const over = parts.filter((p) => p.share >= p.i.cap);
    if (over.length === 0) {
      for (const p of parts) out.set(p.i.id, p.share);
      break;
    }
    // кто упёрся в потолок — получает его целиком и выпадает; остаток делим заново между остальными
    for (const p of over) {
      out.set(p.i.id, p.i.cap);
      left -= p.i.cap;
    }
    active = active.filter((i) => !out.has(i.id));
  }
  for (const [k, v] of out) if (v <= 0) out.delete(k);
  return out;
}

export type AllocLine = { orderId: string; amountCents: number };

/** Проверка набора строк: Σ <= сумма платежа, суммы положительные, ТЗ без повторов. Возвращает текст ошибки или null. */
export function checkAllocation(paymentCents: number, lines: AllocLine[]): string | null {
  const seen = new Set<string>();
  let sum = 0;
  for (const l of lines) {
    if (!Number.isFinite(l.amountCents) || l.amountCents <= 0) return "Сумма по ТЗ должна быть больше нуля";
    if (seen.has(l.orderId)) return "Одно ТЗ указано дважды";
    seen.add(l.orderId);
    sum += l.amountCents;
  }
  if (sum > paymentCents) return `Разнесено ${fromCents(sum)} — больше суммы платежа ${fromCents(paymentCents)}`;
  return null;
}

export type UnallocatedKind = "advance" | "excess";

/**
 * Что это за неразнесённый остаток: «аванс без разнесения» (платёж без ТЗ или аванс) либо «сверх работы»
 * (платёж привязан к ТЗ, но превышает их работу — например, включены шкуры подрядчика).
 */
export function unallocatedKind(p: { paymentType: string; linkedOrders: number }): UnallocatedKind {
  return p.linkedOrders > 0 && p.paymentType !== "ADVANCE" ? "excess" : "advance";
}

/** Вариант ТЗ в редакторе разнесения оплаты. */
export type AllocOrderOpt = {
  id: string;
  label: string;
  /** ТЗ входит в набор, который покрывает платёж. */
  linked: boolean;
  /** Работа ТЗ, коп. */
  workCents: number;
  /** Уже разнесено на ТЗ от ДРУГИХ платежей, коп. */
  otherCents: number;
  /** Номер партии ТЗ (для «Разнести на партию»). */
  batch?: number | null;
};
