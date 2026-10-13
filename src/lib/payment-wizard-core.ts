/**
 * Мастер «Внести оплату и разнести»: чистые правила предложения разнесения (без базы — работают и в браузере, и в сценарии проверки).
 *   • поставщику: если основание называет цель (№ счёта / спецификации / аукцион) — платёж идёт на неё, лишнее остаётся авансом;
 *     если основание пустое или ничего не опознано — самые старые неоплаченные остатки (меньше 1 ₽ пропускаются), остаток — авансом;
 *   • по работе (ТЗ): ТЗ из основания — в пределах остатка работы; «партия N» — пропорционально работе ТЗ партии (splitByWeights,
 *     как в payment-alloc); без основания — самые старые ТЗ с остатком; всё, что не вошло, — не разнесено.
 * Суммы — в копейках (целые), чтобы не копить ошибок округления.
 */
import { splitByWeights } from "@/lib/payment-alloc-core";

export type SupTarget = {
  /** "a:<название аукциона>" либо "p:<id закупки>" — как в allocateAdvance. */
  key: string;
  label: string;
  supplierIds: string[];
  totalCents: number;
  paidCents: number;
  /** Нормализованные номера, по которым цель опознаётся в основании (счета, УПД, спецификации, номер закупки, название аукциона). */
  refs: string[];
  /** yyyy-mm-dd для порядка «старые вперёд». */
  date: string;
};
export type SupPart = { key: string; cents: number; why: string };

export const remainingOf = (t: { totalCents: number; paidCents: number }) => t.totalCents - t.paidCents;
export const normRef = (s: string) => s.toLowerCase().replace(/[\s№#]/g, "").replace(/^0+(?=\d)/, "");

/** Номера в тексте основания: слова/числа длиной от 2 символов, нормализованные. */
export const basisCompact = (basis: string): string => normRef(basis);

/** Опознана ли цель в основании: целый номер среди слов либо (для длинных ссылок вроде «тест10.26») вхождение в основание без пробелов. */
export function refHit(refs: string[], basis: string): boolean {
  const tokens = new Set(basisTokens(basis));
  const compact = basisCompact(basis);
  return refs.some((r) => !!r && (tokens.has(r) || (r.length >= 5 && compact.includes(r))));
}

export function basisTokens(basis: string): string[] {
  const out = new Set<string>();
  for (const m of basis.matchAll(/[\p{L}\d][\p{L}\d\-/.]*[\p{L}\d]|\d/gu)) {
    const t = normRef(m[0]);
    if (t.length >= 1) out.add(t);
  }
  return [...out];
}

/** Предложение разнесения платежа поставщику. */
export function suggestSupplierAlloc(amountCents: number, targets: SupTarget[], basis: string): { parts: SupPart[]; restCents: number } {
  const parts: SupPart[] = [];
  let left = amountCents;
  const take = (t: SupTarget, why: string) => {
    const room = remainingOf(t);
    if (left <= 0 || room <= 0 || parts.some((p) => p.key === t.key)) return;
    const c = Math.min(left, room);
    parts.push({ key: t.key, cents: c, why });
    left -= c;
  };
  const named = basis.trim() ? targets.filter((t) => refHit(t.refs, basis)) : [];
  if (named.length > 0) {
    // основание назвало цель: платёж идёт на неё (несколько — по порядку дат), лишнее остаётся авансом
    for (const t of [...named].sort((a, b) => a.date.localeCompare(b.date))) take(t, "названа в основании");
    return { parts, restCents: left };
  }
  for (const t of [...targets].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "ru"))) {
    if (remainingOf(t) >= 100) take(t, "самый старый неоплаченный остаток");
  }
  return { parts, restCents: left };
}

export type WorkTarget = {
  id: string;
  label: string;
  clientId: string | null;
  batch: number | null;
  workCents: number;
  paidCents: number;
  /** Нормализованные номера ТЗ (рабочий номер и системный). */
  refs: string[];
};
export type WorkPart = { id: string; cents: number; why: string };

/**
 * Предложение разнесения платежа заказчика / по работе. Основание «ТЗ 88» — эти ТЗ получают платёж в пределах остатка (лишнее не разнесено);
 * «партия 18» — платёж делится между ТЗ партии пропорционально работе (как autoAllocatePayment); пустое/неопознанное основание —
 * самые старые ТЗ заказчика по порядку, каждое в пределах своего остатка.
 */
export function suggestWorkAlloc(amountCents: number, targets: WorkTarget[], basis: string): { parts: WorkPart[]; restCents: number } {
  const parts = new Map<string, WorkPart>();
  let left = amountCents;
  const room = (t: WorkTarget) => Math.max(0, t.workCents - t.paidCents - (parts.get(t.id)?.cents ?? 0));
  const named = basis.trim() ? targets.filter((t) => refHit(t.refs, basis)) : [];
  for (const t of named) {
    const c = Math.min(left, room(t));
    if (c > 0) { parts.set(t.id, { id: t.id, cents: c, why: "названо в основании" }); left -= c; }
  }
  const batches = new Set([...basis.matchAll(/парти[яиюе]\s*(?:№|n)?\s*(\d{1,4})(?!\d)/giu)].map((m) => Number(m[1])));
  const inBatch = targets.filter((t) => t.batch !== null && batches.has(t.batch) && !parts.has(t.id));
  if (left > 0 && inBatch.length > 0) {
    const split = splitByWeights(left, inBatch.filter((t) => room(t) > 0).map((t) => ({ id: t.id, weight: t.workCents, cap: room(t) })));
    for (const [id, c] of split) {
      if (c <= 0) continue;
      parts.set(id, { id, cents: c, why: "партия из основания: пропорционально работе" });
      left -= c;
    }
  }
  if (left > 0 && named.length === 0 && inBatch.length === 0) {
    for (const t of targets) {
      if (left <= 0) break;
      const c = Math.min(left, room(t));
      if (c >= 100) { parts.set(t.id, { id: t.id, cents: c, why: "самое старое ТЗ с остатком" }); left -= c; }
    }
  }
  return { parts: [...parts.values()], restCents: left };
}

export const centsOf = (s: string): number => {
  const t = s.replace(/[\s  ]/g, "").replace(",", ".");
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Math.round(Number(t) * 100) : NaN;
};
export const rubOf = (c: number): string => (c / 100).toFixed(2).replace(".", ",");
