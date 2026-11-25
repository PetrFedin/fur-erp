// Основания и факты для «Подтверждено»: подпись «кто и когда», п/п, реестр сверки, шаблонные даты ТЗ (вынесено из verification.ts без изменений).
import { Decimal } from "@prisma/client/runtime/library";
import { formatDate, formatMoney } from "@/lib/utils";
import type { Registry } from "@/app/(app)/reconciliation/model";

/** Допуск на округление лотов в расчёте себестоимости против УПД (максимум ≈0,65 ₽ на лот × десятки лотов). */
export const ROUND_TOL_RUB = 50;

export const fmtRub = (n: number | Decimal) => formatMoney(new Decimal(n).toDecimalPlaces(2).toString());
export const iso = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------- подпись «кто и когда»

export function stampOf(at: Date | null | undefined, by: string | null | undefined, userId: string | null, names: Map<string, string>): { text: string | null; auto: boolean } {
  if (!at) return { text: null, auto: false };
  const auto = !!by && by.startsWith("auto:");
  const who = auto ? "авто по документам" : by && userId && by === userId ? "вы" : by ? (names.get(by) ?? "сотрудник") : "–";
  return { text: `${formatDate(at)} · ${who}`, auto };
}

// ---------------------------------------------------------------------------------------------- основание оплаты

/** Пометки «приблизительно»: дата не из платёжки. */
export const APPROX_RE = /дата по (письму|fin|расч[её]ту)|приблизительн|гипотез/i;
const PP_RE = /п\/п\s*№\s*(\d{3,})/i;
const DATE_RE = /\d{2}\.\d{2}\.\d{4}/;
export const ppNoOf = (ref: string | null | undefined): string | null => PP_RE.exec(ref ?? "")?.[1] ?? null;

/** Основание в поле «документ»: п/п с номером или письмо «оплачено» с датой. Пометка «отмечено вручную» и просто «счёт №…» — не основание. */
export function refEvidence(ref: string | null | undefined): "pp" | "letter" | null {
  const r = (ref ?? "").trim();
  if (!r) return null;
  if (ppNoOf(r)) return "pp";
  if (/п\/п/i.test(r) && DATE_RE.test(r)) return "pp";
  if (/письм/i.test(r) && DATE_RE.test(r)) return "letter";
  return null;
}

// ----------------------------------------------------------------------------- факты оплат из реестра сверки (документы)

type RegFact = { amount: number; date: string; ppNo: string | null; basis: string | null };
const factsCache = new WeakMap<Registry, { byPp: Map<string, RegFact[]>; all: RegFact[] }>();
function registryFacts(reg: Registry) {
  const cached = factsCache.get(reg);
  if (cached) return cached;
  const byPp = new Map<string, RegFact[]>();
  const all: RegFact[] = [];
  const seen = new Set<string>();
  for (const inv of reg.invoices) {
    for (const p of inv.paid) {
      if (p.evidence !== "fact" || !p.date || p.dateApprox) continue;
      const k = `${p.ppNo ?? ""}|${p.date}|${p.amountRub}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const f: RegFact = { amount: p.amountRub, date: p.date, ppNo: p.ppNo, basis: p.basis };
      all.push(f);
      if (p.ppNo) byPp.set(p.ppNo, [...(byPp.get(p.ppNo) ?? []), f]);
    }
  }
  const built = { byPp, all };
  factsCache.set(reg, built);
  return built;
}

/** Названа ли такая п/п в документах реестра сверки (для статуса «расходится»: п/п есть, а сумма или дата не совпали). */
export function registryKnowsPp(ppNo: string, reg: Registry): boolean {
  return registryFacts(reg).byPp.has(ppNo);
}

/**
 * Подтверждает ли оплату реестр сверки (документы Drive «мех»): тот же п/п (сумма всех оплат БД по этому п/п = сумме в документах)
 * либо, если п/п в основании не назван, — оплата с той же датой и суммой. Только «факт» с датой, без приблизительных.
 * Возвращает описание либо null.
 */
export function registryFactFor(p: { amount: number; paidIso: string; ppNo: string | null }, dbSumByPp: Map<string, number>, reg: Registry): string | null {
  const { byPp, all } = registryFacts(reg);
  if (p.ppNo) {
    const facts = byPp.get(p.ppNo);
    if (!facts?.length) return null;
    const reg = facts.reduce((s, f) => s + f.amount, 0);
    const db = dbSumByPp.get(p.ppNo) ?? p.amount;
    if (Math.abs(reg - db) <= 1 && facts.every((f) => f.date === p.paidIso)) return `документы: п/п №${p.ppNo} от ${formatDate(p.paidIso)}, сумма ${fmtRub(reg)}`;
    return null;
  }
  const hit = all.find((f) => f.date === p.paidIso && Math.abs(f.amount - p.amount) <= 1);
  return hit ? `документы: оплата ${formatDate(hit.date)} на ${fmtRub(hit.amount)}${hit.ppNo ? `, п/п №${hit.ppNo}` : ""}` : null;
}

// ------------------------------------------------------------------------------------------------- шаблонные даты ТЗ

const TEMPLATE_DATES: { from: number; to: number; ymd: [number, number, number][] }[] = [
  { from: 113, to: 115, ymd: [[2026, 1, 12]] },
  { from: 118, to: 118, ymd: [[2026, 3, 17], [2026, 1, 12]] },
];
const tzOrdinal = (num: string) => {
  const m = /(\d+)\s*$/.exec(num);
  return m ? parseInt(m[1], 10) : NaN;
};
/** Дата ТЗ — шаблон: 16.05.2025 (дата договора из приложений ТЗ 1–96), 12.01.2026 (ТЗ 113–115), 17.03.2026 (ТЗ 118). */
export function templateDateIssue(number: string, d: Date): string | null {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  if (y === 2025 && m === 5 && day === 16) return `дата ТЗ ${formatDate(d)} — это дата договора, а не ТЗ (шаблон)`;
  const ord = tzOrdinal(number);
  for (const t of TEMPLATE_DATES) if (ord >= t.from && ord <= t.to && t.ymd.some(([yy, mm, dd]) => yy === y && mm === m && dd === day)) return `дата ТЗ ${formatDate(d)} похожа на шаблон — проверьте по оригиналу`;
  return null;
}

export const NON_STOCK_RE = /лоскут|бобр|фонди|подрядчик|давальч|сырь[её]\s+(заказчик|клиент|подрядчик)|тут нет продаж/i;

/**
 * Какие документы, привязанные к оплате, считаются основанием «оплата была»: платёжка и баланс/выписка с оплатой.
 * Счёт на оплату, УПД и письмо-согласование — НЕ основание (это «можно оплачивать», а не «оплачено»).
 */
export const PROOF_DOC_TYPES = ["PAYMENT_PROOF", "BALANCE"] as const;

/** Оплата с суммой больше нуля — единственные оплаты, которые считаются «ждут документа или проверки» (и в реестре оплат, и в «Подтвердить»). */
export const isCountedPayment = (amount: number | string | { toString(): string }) => Number(amount.toString()) > 0;
