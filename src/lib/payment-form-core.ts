// Единая форма оплаты: справочники видов, документов и правила (чистые функции, без базы — можно импортировать и в клиентском коде).
import { guessDocType } from "@/lib/drive-docs";

export type PayKind = "ADVANCE" | "INVOICE" | "FINAL" | "TOPUP" | "PERCENT" | "REFUND" | "OTHER";

/** db — как вид записывается в схему (PaymentKind / ProductionPaymentType); label — что видит человек. Схему не меняем: вид «по счёту/процент/возврат» сохраняется пометкой в заметке. */
export const PAY_KINDS: { v: PayKind; label: string; db: "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER"; hint: string; supplierOnly?: boolean }[] = [
  { v: "ADVANCE", label: "Аванс", db: "ADVANCE", hint: "Предоплата до поставки/работ; можно не разносить сразу" },
  { v: "INVOICE", label: "Оплата по счёту", db: "PARTIAL", hint: "Платёж по выставленному счёту" },
  { v: "FINAL", label: "Окончательная оплата", db: "FINAL", hint: "Закрывает остаток" },
  { v: "TOPUP", label: "Доплата", db: "PARTIAL", hint: "Дополнительный платёж к уже внесённым" },
  { v: "PERCENT", label: "Процент от суммы", db: "PARTIAL", hint: "30% / 50% / 70% от суммы к оплате" },
  { v: "REFUND", label: "Возврат / зачёт", db: "OTHER", hint: "Уменьшает оплаченное (запись с минусом); нужна пометка", supplierOnly: true },
  { v: "OTHER", label: "Другое (с пометкой)", db: "OTHER", hint: "Опишите в пометке, что это за платёж" },
];

/** Пометка, которая сохраняется в заметке, если вид не совпадает один-в-один со схемой. */
export function kindNote(kind: PayKind): string {
  const k = PAY_KINDS.find((x) => x.v === kind)!;
  return kind === "ADVANCE" || kind === "FINAL" ? "" : `Вид: ${k.label.toLowerCase()}`;
}

export const PRESET_PERCENTS = [30, 50, 70] as const;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Сумма от базы по проценту (кнопки 30/50/70%). */
export function percentAmount(base: number, pct: number): number {
  return round2((base * pct) / 100);
}

export type DocRole = "PAYMENT_PROOF" | "PAYMENT_INVOICE" | "APPROVAL_EMAIL" | "OTHER";
export const DOC_ROLES: { v: DocRole; label: string }[] = [
  { v: "PAYMENT_PROOF", label: "Платёжка (п/п)" },
  { v: "PAYMENT_INVOICE", label: "Счёт" },
  { v: "APPROVAL_EMAIL", label: "Письмо-согласование" },
  { v: "OTHER", label: "Другое" },
];
export const LETTER_HINT = "Письмо-согласование — это «согласовано», а не «оплачено»: оплатой оно не считается. Платёж подтверждается платёжкой или номером п/п с датой и суммой.";

/** Тип документа по имени файла (та же догадка, что в Drive-документах). Не угадали — «Другое». */
export function guessDocRole(fileName: string): DocRole {
  const t = guessDocType(fileName);
  if (t === "PAYMENT_PROOF") return "PAYMENT_PROOF";
  if (t === "PAYMENT_INVOICE" || t === "AUCTION_INVOICE") return "PAYMENT_INVOICE";
  if (t === "APPROVAL_EMAIL") return "APPROVAL_EMAIL";
  return "OTHER";
}

/** «Отметить подтверждено» разрешено, только если есть платёжка или п/п с датой и суммой. */
export function canConfirm(x: { hasProofFile: boolean; ppNo: string; paidAt: string; amount: number }): boolean {
  if (x.hasProofFile) return true;
  return x.ppNo.trim().length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(x.paidAt) && Number.isFinite(x.amount) && x.amount !== 0;
}

/** Строка основания в Payment.docRef / ProductionPayment.docRef: по ней проверка находит «п/п № NNN». */
export function docRefOf(ppNo: string, paidAt: string): string | null {
  const n = ppNo.replace(/^\s*(?:п\/п\s*)?№?\s*/i, "").trim().slice(0, 40);
  if (!n) return null;
  const [y, m, d] = paidAt.split("-");
  return `п/п № ${n}${y && m && d ? ` от ${d}.${m}.${y}` : ""}`;
}

export const SAVED_LATER_NOTE = "разнести позже";
