/**
 * Домен денег «Сырья»: чистые функции без базы и без React. Единственное место, где определено, как считаются
 * «куплено − оплачено = долг», долг или переплата, пересчёт «без НДС», надбавка 4 % и перенос переплаты между аукционами.
 * Экраны, витрина и тесты используют эти функции и не заводят вторых формул (проверяет scripts/test-domain-money.ts).
 */

/** Ниже этой суммы (₽) разница — округление, а не долг и не переплата. */
export const RUB_EPS = 0.5;

/** Сумма в двух вариантах показа. */
export type VatPair = { incl: number; excl: number };

export const sumPairs = (list: VatPair[]): VatPair => list.reduce((a, p) => ({ incl: a.incl + p.incl, excl: a.excl + p.excl }), { incl: 0, excl: 0 });

/** Доля «без НДС» от «с НДС» по стоимости закупленного; нет стоимости — 1 (пересчитывать нечего). */
export const vatShare = (incl: number, excl: number): number => (incl > 0 ? excl / incl : 1);

/**
 * Оплата и долг по документам идут с НДС. В режиме «Без НДС» их показывают в той же доле, что «Куплено»,
 * чтобы «куплено − оплачено = долг» сходилось в обоих режимах.
 */
export const payPair = (amountIncl: number, share: number): VatPair => ({ incl: amountIncl, excl: amountIncl * share });

export type DebtKind = "debt" | "overpay" | "none";
export type DebtState = {
  kind: DebtKind;
  /** Абсолютная величина (≥ 0): долг или переплата; 0 при «none». */
  amount: number;
  /** Куплено − оплачено, со знаком. */
  signed: number;
};

/** Долг, переплата или «ничего» с допуском RUB_EPS на округление. */
export function debtState(total: number, paid: number): DebtState {
  const signed = total - paid;
  if (signed > RUB_EPS) return { kind: "debt", amount: signed, signed };
  if (signed < -RUB_EPS) return { kind: "overpay", amount: -signed, signed };
  return { kind: "none", amount: 0, signed };
}
/** То же по готовому остатку (куплено − оплачено уже посчитано). */
export const debtStateOfRest = (rest: number): DebtState => debtState(rest, 0);

/** Надбавка 4 % к использованному: «С 4 %» — списано плюс надбавка и отдельно сама надбавка; «Без 4 %» — как есть, без упоминаний. */
export type C4 = "on" | "off";
export const withExtra = (c4: C4): boolean => c4 === "on";
export function usedByMode(c4: C4, used: number, extra: number): { value: number; extra: number } {
  const on = c4 === "on";
  return { value: on ? used + extra : used, extra: on && extra > RUB_EPS ? extra : 0 };
}

export type PayTotals = { total: number; paid: number; remaining: number };

/**
 * Переплата аукциона, зачтённая по документам в счёте другого аукциона (например подкладка 05.26 → AME 05.26), переносится туда на
 * верхнем уровне: у источника оплата уменьшается, у получателя растёт; итог закупок не меняется.
 * over — аукционы с переплатой (amount > 0) и аукцион-получатель; mine — аукционы этого вида (мех или подкладка).
 */
export function transferOverpay(pay: PayTotals, over: { name: string; amount: number; to: string | null }[], mine: ReadonlySet<string>): PayTotals {
  let out = { ...pay };
  for (const o of over) {
    if (!o.to || o.amount <= RUB_EPS) continue;
    const fromHere = mine.has(o.name), toHere = mine.has(o.to);
    if (fromHere && !toHere) out = { total: out.total, paid: out.paid - o.amount, remaining: out.remaining + o.amount };
    else if (!fromHere && toHere) out = { total: out.total, paid: out.paid + o.amount, remaining: out.remaining - o.amount };
  }
  return out;
}
