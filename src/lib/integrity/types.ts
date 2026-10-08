// Типы движка самопроверки. Без server-only и React: годятся и для скрипта, и для клиентских компонентов.

export type Severity = "error" | "warn" | "info";

/** Вид записи, к которой относится расхождение (для ссылки «где исправлять» и плашек на карточках). */
export type EntityKind = "purchase" | "lot" | "order" | "batch" | "payment" | "prodPayment" | "auction" | "model" | "item" | "system";

export type EntityRef = { kind: EntityKind; id: string; label: string };

export type Violation = {
  /** Стабильный ключ расхождения внутри проверки (по нему сопоставляются «известные»). */
  key: string;
  /** Что не сходится — человеческим языком. */
  message: string;
  /** Величина расхождения (₽, шт., м — зависит от проверки); null, если число не имеет смысла. */
  delta: number | null;
  /** Единица величины. */
  unit: "₽" | "шт." | "ед." | "";
  entity: EntityRef;
  /** Куда идти исправлять. */
  href: string;
  /** Дополнительные записи, которых касается расхождение (подсветка на их карточках). */
  also?: EntityRef[];
  /** Служебные метки для списка «известных» (например, "lining-pool", "batch:5"). */
  tags?: string[];
};

export type KnownViolation = Violation & {
  /** Почему расхождение известно и допустимо. */
  reason: string;
  /** Решение владельца или документ, где это зафиксировано. */
  decision: string;
};

export type CheckStatus = "ok" | "known" | "fail";

export type CheckResult = {
  id: string;
  title: string;
  group: string;
  severity: Severity;
  /** Допуск словами («до 50 ₽ на закупку»). */
  tolerance: string;
  /** Что проверяется (одно предложение). */
  what: string;
  /** Где исправлять в общем случае. */
  fix: string;
  /** ok — расхождений нет; known — есть только объяснённые; fail — есть неизвестные. */
  status: CheckStatus;
  violations: Violation[];
  known: KnownViolation[];
  /** Сколько записей проверено. */
  checked: number;
  ms: number;
  /** Проверка не смогла выполниться. */
  error?: string;
};

export type IntegrityReport = {
  checkedAt: string;
  orgId: string;
  ms: number;
  results: CheckResult[];
  /** Число неизвестных расхождений (по всем проверкам). */
  failing: number;
  failingErrors: number;
  failingWarns: number;
  knownCount: number;
  checksTotal: number;
  checksFailed: number;
  ok: boolean;
};

/** Сжатый вид для колокольчика и API. */
export type IntegritySummary = {
  checkedAt: string;
  failing: number;
  failingErrors: number;
  knownCount: number;
  ok: boolean;
  items: { checkId: string; title: string; severity: Severity; message: string; delta: number | null; unit: Violation["unit"]; href: string; entityLabel: string }[];
  /** Сколько расхождений не поместилось в items. */
  more: number;
};
