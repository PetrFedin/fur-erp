/**
 * Мастер «Внести оплату и разнести»: чистые правила предложения разнесения (без базы — работают и в браузере, и в сценарии проверки).
 *   • поставщику: если основание называет цель (№ счёта Веллмех / УПД / спецификации / аукцион) — платёж идёт на неё; если
 *     счёт относится к нескольким аукционам — делится между ними пропорционально остатку (в пределах остатка; закрывает остатки, если денег хватает), как делил Веллмех
 *     (п/п 53423 по счёту №83: СП 05.25 + РП 05.25; счёт №197: РП 04.26 + СП 05.26); лишнее остаётся авансом.
 *     Основание назвало документ (счёт / УПД / спецификацию), но его нет ни у одной закупки — НИЧЕГО не угадываем (не «самый старый
 *     остаток»), вся сумма — авансом с пояснением. Основание пустое — самые старые остатки (хвосты меньше 1 000 ₽ — округления — пропускаются);
 *   • по работе (ТЗ): ТЗ называются только явно («ТЗ 88», «ТЗ 97–100», «П-2026-0183») — голые числа из основания («34 ед.», «№181»)
 *     ТЗ не опознают; назвали несколько ТЗ — платёж делится пропорционально работе в пределах остатка (аванс 70% = 70% с каждого ТЗ);
 *     «партия N» — так же по ТЗ партии (splitByWeights, как в payment-alloc); без основания — самые старые ТЗ с остатком;
 *     всё, что не вошло, — не разнесено. 4% (надбавка на мех и подкладку) в разнесении НЕ участвует: остаток по работе = работа − разнесено.
 * Суммы — в копейках (целые), чтобы не копить ошибок округления.
 */
import { splitByWeights } from "@/lib/payment-alloc-core";
import { extractDocRefs } from "@/lib/source-docs";

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

/**
 * Опознана ли цель в основании: целый номер среди слов либо (для длинных ссылок вроде «тест10.26») вхождение в основание без пробелов.
 * Номер с годом («117@2026» — счёт №117 от 2026 года) опознаётся, только если год основания не противоречит: номера счетов Веллмех
 * повторяются из года в год (№117 за 2025 и за 2026).
 */
export function refHit(refs: string[], basis: string): boolean {
  const tokens = new Set(basisTokens(basis));
  const compact = basisCompact(basis);
  const years = new Map<string, Set<string>>();
  for (const x of extractDocRefs(basis)) {
    if (!x.number || !x.date) continue;
    const k = normRef(x.number);
    years.set(k, (years.get(k) ?? new Set()).add(x.date.slice(0, 4)));
  }
  return refs.some((r) => {
    if (!r) return false;
    const at = r.indexOf("@");
    if (at > 0) {
      const num = r.slice(0, at);
      if (!tokens.has(num)) return false;
      const ys = years.get(num);
      return !ys || ys.has(r.slice(at + 1));
    }
    return tokens.has(r) || (r.length >= 5 && compact.includes(r));
  });
}

export function basisTokens(basis: string): string[] {
  const out = new Set<string>();
  for (const m of basis.matchAll(/[\p{L}\d][\p{L}\d\-/.]*[\p{L}\d]|\d/gu)) {
    const t = normRef(m[0]);
    if (t.length >= 1) out.add(t);
  }
  return [...out];
}

/** Хвосты остатка меньше этого (коп.) — округления и копеечные расхождения: в «самый старый остаток» не берём. */
export const TINY_REMAINDER_CENTS = 100_000;

/** Основание называет документ (счёт / УПД / спецификацию / накладную), а не только дату или п/п. */
export const mentionsDocument = (basis: string): boolean => /(сч[её]т|упд|спецификаци|накладн|инвойс|invoice)\p{L}*\s*(?:№|n|#)?\s*[\p{L}\d]/iu.test(basis);

/** Предложение разнесения платежа поставщику. */
export function suggestSupplierAlloc(amountCents: number, targets: SupTarget[], basis: string): { parts: SupPart[]; restCents: number; hint?: string } {
  const parts: SupPart[] = [];
  let left = amountCents;
  const take = (t: SupTarget, why: string, limit = Infinity) => {
    const room = remainingOf(t);
    if (left <= 0 || room <= 0 || parts.some((p) => p.key === t.key)) return;
    const c = Math.min(left, room, limit);
    if (c <= 0) return;
    parts.push({ key: t.key, cents: c, why });
    left -= c;
  };
  const named = basis.trim() ? targets.filter((t) => refHit(t.refs, basis)) : [];
  if (named.length > 0) {
    let open = named.filter((t) => remainingOf(t) >= 100); // остаток меньше 1 ₽ — цель закрыта
    // из нескольких целей хвост меньше 100 ₽ (копеечные расхождения, напр. 1,15 ₽ у СП 05.25) за цель не считаем
    if (open.length > 1) open = open.filter((t) => remainingOf(t) >= 10_000);
    if (open.length === 0) open = named.filter((t) => remainingOf(t) >= 100);
    if (open.length > 1) {
      // документ относится к нескольким аукционам: делим пропорционально стоимости, но не больше остатка каждого
      const split = splitByWeights(left, open.map((t) => ({ id: t.key, weight: remainingOf(t), cap: remainingOf(t) })));
      for (const t of [...open].sort((a, b) => a.date.localeCompare(b.date))) {
        const c = split.get(t.key) ?? 0;
        if (c > 0) { parts.push({ key: t.key, cents: c, why: "названа в основании; документ относится к нескольким аукционам — пропорционально остатку" }); left -= c; }
      }
    } else {
      for (const t of open) take(t, "названа в основании");
    }
    return {
      parts,
      restCents: left,
      hint: parts.length === 0 ? "Цель из основания найдена, но по ней нет остатка к оплате — вся сумма останется авансом." : left >= 100 ? `Сумма больше остатка названных целей на ${(left / 100).toFixed(2).replace(".", ",")} ₽: разница останется авансом без привязки — сверьте счёт с закупкой.` : open.length > 1 ? "Документ относится к нескольким аукционам: как делить между ними, решает владелец (Веллмех делил по-разному) — проверьте суммы в таблице." : undefined,
    };
  }
  if (basis.trim() && mentionsDocument(basis)) {
    return { parts, restCents: left, hint: "Документ из основания не найден ни у одной закупки или аукциона (его нет в номерах счетов / УПД / спецификаций). Цель не угадываем: сумма останется авансом — выберите закупку или аукцион вручную («+ Строка»)." };
  }
  for (const t of [...targets].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "ru"))) {
    if (remainingOf(t) >= TINY_REMAINDER_CENTS) take(t, "самый старый неоплаченный остаток");
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

/** Номера ТЗ, названные в основании явно: «ТЗ 88», «ТЗ 88, 91 и 92», «ТЗ 97–100», «заказы 5/6», «П-2026-0183». Голые числа ТЗ не называют. */
export function orderRefsOf(basis: string): Set<string> {
  const out = new Set<string>();
  const list = /(?:тз|заказ\p{L}*|приложени\p{L}*)\s*(?:№|n|#)?\s*((?:\d{1,4}(?:\s*[–—-]\s*\d{1,4})?(?:\s*(?:,|;|\/|и)\s*)?)+)/giu;
  for (const m of basis.matchAll(list)) {
    for (const x of m[1].matchAll(/(\d{1,4})(?:\s*[–—-]\s*(\d{1,4}))?/g)) {
      const a = Number(x[1]);
      const b = x[2] ? Number(x[2]) : a;
      if (b >= a && b - a <= 60) for (let n = a; n <= b; n++) out.add(normRef(String(n)));
    }
  }
  for (const m of basis.matchAll(/П-\d{4}-\d{3,5}/gu)) out.add(normRef(m[0]));
  return out;
}

/**
 * Предложение разнесения платежа заказчика / по работе. Основание «ТЗ 88» — эти ТЗ делят платёж пропорционально работе в пределах
 * остатка (лишнее не разнесено); «партия 18» — так же по ТЗ партии (как autoAllocatePayment); пустое/неопознанное основание —
 * самые старые ТЗ заказчика по порядку, каждое в пределах своего остатка. Остаток считается по РАБОТЕ: 4% на мех/подкладку сюда не входит.
 */
export function suggestWorkAlloc(amountCents: number, targets: WorkTarget[], basis: string): { parts: WorkPart[]; restCents: number } {
  const parts = new Map<string, WorkPart>();
  let left = amountCents;
  const room = (t: WorkTarget) => Math.max(0, t.workCents - t.paidCents - (parts.get(t.id)?.cents ?? 0));
  const refs = orderRefsOf(basis);
  const named = refs.size > 0 ? targets.filter((t) => t.refs.some((r) => refs.has(r))) : [];
  if (left > 0 && named.length > 0) {
    const split = splitByWeights(left, named.filter((t) => room(t) > 0).map((t) => ({ id: t.id, weight: t.workCents, cap: room(t) })));
    for (const [id, c] of split) {
      if (c <= 0) continue;
      parts.set(id, { id, cents: c, why: named.length > 1 ? "ТЗ названы в основании: пропорционально работе" : "названо в основании" });
      left -= c;
    }
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
