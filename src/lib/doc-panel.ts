import { Decimal } from "@prisma/client/runtime/library";
import { formatMoney } from "@/lib/utils";

/**
 * Общая «панель документов и оплаты» для аукционов (закупок) и производства (партий, ТЗ).
 * Типы — только сериализуемые данные (строки, числа), чтобы их можно было передать в клиентский компонент.
 * Статусы оплаты и их подписи считаются ОДНОЙ функцией buildPanelPay — её же использует «Реестр сверки»
 * и сводка на /documents, поэтому формулировки нигде не расходятся.
 */

export type Tone = "ok" | "warn" | "bad" | "muted";

export type PanelDoc = {
  id: string;
  title: string;
  meta: string;
  /** Открыть оригинал в приложении. */
  href: string | null;
  driveUrl: string | null;
  /** Заменить файл: файл закупки (PurchaseDocument) или документ Drive (DriveDocument). */
  replace: { action: "purchaseDoc" | "driveDoc"; id: string } | null;
};

/** Документ, который упомянут в файлах Drive «мех», но в приложении не привязан: его можно привязать одним кликом. */
export type PanelMention = {
  text: string;
  driveUrl: string | null;
  attach: { entity: "purchase" | "order" | "batch"; id: string; fileId: string; title: string; docType: string; docNumber: string | null; docDate: string | null } | null;
};

/** Куда и как загружается файл. */
export type UploadTarget =
  | { action: "purchaseDoc"; purchaseId: string; kind: string; scope: "batch" | "purchase"; label: string }
  | { action: "driveDoc"; entity: "order" | "batch"; id: string; docType: string; label: string }
  | { action: "paymentProof"; target: "supplier" | "production"; paymentId: string; label: string };

export type PanelItem = {
  key: string;
  label: string;
  need: "required" | "optional" | "na";
  ok: boolean;
  docs: PanelDoc[];
  mentions: PanelMention[];
  /** «НЕТ — подгрузить: …» (только для обязательных и отсутствующих). */
  missing: string | null;
  /** Пояснение справа от названия (почему «не нужен», «после приёмки» и т. п.). */
  note: string | null;
  uploads: UploadTarget[];
};

export type PanelPayState = "PAID" | "PARTIAL" | "UNPAID" | "OVERPAID" | "NOBASE";

export type PanelPay = {
  state: PanelPayState;
  tone: Tone;
  /** Короткий статус: «Оплачено полностью», «Частично 60% (…)», «Не оплачено» … */
  label: string;
  /** Уточнение: «оплата упомянута в документе X, но платёжки нет». */
  note: string | null;
  percent: number;
  totalText: string;
  paidText: string;
  remainingText: string;
  /** Остаток числом (для подстановки в форму «оплачено полностью»), строка с копейками; "0.00" если остатка нет. */
  remaining: string;
  total: string;
  paid: string;
};

export type PanelPayment = {
  id: string;
  dateIso: string;
  dateText: string;
  amountText: string;
  kindText: string;
  docRef: string | null;
  confirmed: boolean;
  /** Есть платёжка / подтверждение (файл, ссылка Drive или номер п/п при подтверждённой оплате). */
  hasProof: boolean;
  proofTitle: string | null;
  proofHref: string | null;
  scopeText: string | null;
  /** Оплата, отмеченная вручную: её можно откатить прямо здесь. */
  manual: boolean;
  rollback: { action: "auction" | "purchase" | "production"; id: string; ownerId: string | null } | null;
  attachProof: "supplier" | "production" | null;
  planned: boolean;
};

export type MarkTarget =
  | { kind: "auction"; name: string }
  | { kind: "purchase"; id: string }
  | { kind: "batch"; id: string }
  | { kind: "order"; id: string };

export type Panel = {
  id: string;
  title: string;
  subtitle: string | null;
  href: string | null;
  pay: PanelPay;
  payments: PanelPayment[];
  /** Оплаты, упомянутые в документах (Drive «мех»): что называет документ, чего нет в учёте. */
  mentionedPayments: string[];
  items: PanelItem[];
  /** Сколько обязательных документов нет. */
  missingCount: number;
  /** Сколько оплат без платёжки. */
  proofMissing: number;
  /** Пояснение для значка «i» (откуда цифры, правила). */
  hint: string[];
  mark: MarkTarget | null;
  /** Права: загрузка документов / отметка оплаты. */
  canUpload: boolean;
  canMark: boolean;
  /** Нельзя отметить оплату (причина), например отменено. */
  markBlocked: string | null;
  /** Яркая подсветка «нет сопоставимых документов»; null — всё сопоставлено. */
  alert: string | null;
  year: number | null;
};

/** Порог «копейки округления»: остаток меньше рубля — оплачено полностью (как в auction-payments). */
const ONE = new Decimal(1);
const EPS = new Decimal("0.005");

export const MANUAL_PREFIX = "отмечено вручную";
export const isManualRef = (ref: string | null | undefined) => !!ref && ref.toLowerCase().startsWith(MANUAL_PREFIX);

const fix = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);

/**
 * Единый статус оплаты.
 * total — сколько должны/нужно оплатить, paid — сколько оплачено (COMPLETED).
 * noProof — оплачено, но по k оплатам нет платёжки; mentions — оплаты, упомянутые в документах (тексты).
 */
export function buildPanelPay(
  total: Decimal,
  paid: Decimal,
  opts: { noProof?: number; mentions?: string[]; planned?: Decimal; noBaseText?: string } = {},
): PanelPay {
  const remaining = total.sub(paid);
  const percent = total.greaterThan(0) ? Math.max(0, Math.floor(Number(paid.div(total).mul(100).toFixed(4)) * 100) / 100) : 0;
  const base = {
    percent,
    totalText: formatMoney(total.toString()),
    paidText: formatMoney(paid.toString()),
    remainingText: formatMoney(remaining.greaterThan(0) ? remaining.toString() : "0"),
    remaining: remaining.greaterThan(0) ? fix(remaining) : "0.00",
    total: fix(total),
    paid: fix(paid),
  };
  const noProof = opts.noProof ?? 0;
  const mentions = opts.mentions ?? [];
  const proofNote =
    noProof > 0
      ? mentions.length > 0
        ? `оплата упомянута в документе: ${mentions[0]}, но платёжки нет (оплат без платёжки: ${noProof})`
        : `платёжки нет по оплатам: ${noProof}`
      : null;

  if (!total.greaterThan(0)) {
    return {
      ...base,
      state: "NOBASE",
      tone: "muted",
      label: opts.noBaseText ?? "Сумма к оплате не определена",
      note: paid.greaterThan(EPS) ? `оплачено ${base.paidText}` : null,
    };
  }
  if (remaining.lessThan(ONE.neg())) {
    return { ...base, state: "OVERPAID", tone: "warn", label: `Переплата ${formatMoney(remaining.abs().toString())}`, note: proofNote };
  }
  if (paid.lessThanOrEqualTo(EPS)) {
    return {
      ...base,
      state: "UNPAID",
      tone: "bad",
      label: "Не оплачено",
      note: mentions.length > 0 ? `в документах оплата упомянута (${mentions[0]}), но в учёте её нет — отметьте оплату` : null,
    };
  }
  if (remaining.lessThan(new Decimal(50))) {
    // остаток до 50 ₽ — округление расчёта против УПД, не недоплата
    const roundNote = remaining.greaterThanOrEqualTo(ONE) ? `расхождение ${formatMoney(remaining.toString())} — округление расчёта против УПД` : null;
    return { ...base, state: "PAID", tone: noProof > 0 ? "warn" : "ok", label: "Оплачено полностью", note: [proofNote, roundNote].filter(Boolean).join("; ") || null };
  }
  return {
    ...base,
    state: "PARTIAL",
    tone: "warn",
    label: `Оплачено частично ${base.percent.toLocaleString("ru-RU", { maximumFractionDigits: base.percent >= 99 ? 2 : 1 })}% (${base.paidText} из ${base.totalText})`,
    note: proofNote,
  };
}

/** Короткая подпись статуса для списков и сводки: «оплата 60%», «оплачено», «не оплачено». */
export function payShort(p: Pick<PanelPay, "state" | "percent">): string {
  switch (p.state) {
    case "PAID":
      return "оплачено";
    case "OVERPAID":
      return "переплата";
    case "UNPAID":
      return "не оплачено";
    case "PARTIAL":
      return `оплата ${p.percent.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%`;
    default:
      return "оплата не определена";
  }
}

export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  muted: "bg-neutral-400",
};

/** Общий тон строки: красный — нет документов или не оплачено; жёлтый — частично или нет платёжки; зелёный — всё есть. */
export function overallTone(missingCount: number, pay: Pick<PanelPay, "state" | "tone">, proofMissing: number): Tone {
  if (missingCount > 0 || pay.state === "UNPAID") return "bad";
  if (pay.state === "PARTIAL" || pay.state === "OVERPAID" || proofMissing > 0) return "warn";
  if (pay.state === "NOBASE") return "muted";
  return "ok";
}
