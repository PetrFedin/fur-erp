import "server-only";

/**
 * «Что не заведено»: живые проверки полноты данных, ничего не хранится.
 * Отменённые закупки, ТЗ и оплаты не считаются. Документные пробелы — на /documents (doc-coverage.ts).
 */

export type AttentionPriority = "red" | "yellow" | "gray";

export type AttentionSection = "purchases" | "production" | "data";

export type AttentionKind = "purchase" | "payment" | "auction" | "tz" | "batch" | "model" | "material" | "supplier" | "client";

/** Одна проблема сущности: короткая формулировка (бейдж). */
export type AttentionProblem = {
  text: string;
  priority: AttentionPriority;
  /** К какому блоку «Требует внимания» относится проблема (см. GROUPS). */
  group: AttentionGroupId;
  /** Ссылка именно на эту проблему (если ведёт не туда же, куда сама сущность). */
  href?: string;
  linkLabel?: string;
};

/**
 * Принцип «одна запись — один источник»: каждая сущность (закупка, оплата, аукцион, ТЗ, партия, справочник)
 * показывается один раз, а все её проблемы — списком бейджей. Проблемы про ДОКУМЕНТЫ здесь не считаются —
 * они живут только на странице «Покрытие документами» (/documents).
 */
export type AttentionEntity = {
  id: string;
  kind: AttentionKind;
  section: AttentionSection;
  /** Что это: «Закупка З-2026-0010». */
  title: string;
  sub?: string;
  href: string;
  problems: AttentionProblem[];
  /** Высший приоритет среди проблем. */
  priority: AttentionPriority;
  /** Год записи для общего фильтра года (закупка — orderDate, оплата — paidAt, ТЗ — дата ТЗ/партии); null — справочник. */
  year: number | null;
  /** Сумма, на которую влияет проблема (для оплат), ₽. */
  amount?: number;
};

/**
 * Блоки «Требует внимания». Одна проблема — один блок. Что считается «записью для решения»:
 *  - kind "decision": каждая сущность (оплата, закупка, ТЗ, аукцион) — отдельная запись, по ней нужно ваше решение или документ;
 *  - kind "bulk": однотипный пробел, которого по природе нет в документах Drive (даты ТЗ 1–96, даты выпуска партий,
 *    партии без оплат за работу, закупки без названия аукциона, лоты с датой импорта) — вся группа это ОДНА запись,
 *    её не исправить без новых документов; список раскрывается, ничего не потеряно;
 *  - kind "info": справочно (ожидаемые поставки, справочники) — в число не входит.
 */
export type AttentionGroupId =
  | "no-receipt" | "advance-unlinked" | "auction-unpaid" | "overpaid" | "late-delivery" | "raw-overdue" | "tz-requisites" | "suspect-date"
  | "model-dup" | "supplier-new-article" | "no-auction"
  | "tz-no-date" | "tz-end-date" | "batch-no-pay" | "no-auction-info" | "stub-lots" | "production-status"
  | "awaiting" | "no-usage" | "dict";
