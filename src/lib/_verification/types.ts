// Типы единой логики «Подтверждено» (вынесены из verification.ts без изменений).
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Commission4Mode } from "@/lib/commission4-mode";
import type { UploadTarget } from "@/lib/doc-panel";
import type { Registry } from "@/app/(app)/reconciliation/model";
import type { VerifyKind } from "@/lib/verification-kinds";

export type Db = PrismaClient | Prisma.TransactionClient;
export type Blocker = { text: string; href?: string; upload?: UploadTarget };
export type Readiness = { ready: boolean; blockers: Blocker[] };

export type VerifyRow = {
  key: string;
  kind: VerifyKind;
  id: string;
  title: string;
  sub: string | null;
  href: string;
  /** Группа для фильтра/сортировки: аукцион, партия. */
  group: string | null;
  year: number | null;
  amountText: string | null;
  verified: boolean;
  auto: boolean;
  /** «04.10.2026 · вы» / «04.10.2026 · авто по документам». */
  stampText: string | null;
  note: string | null;
  ready: boolean;
  blockers: Blocker[];
  /** Поля быстрого ввода прямо в строке (/verify): значения сейчас. */
  edit: { date?: string; amount?: string; ref?: string; number?: string } | null;
  /** Оплата: основание — только письмо «оплачено» (без файла платёжки и п/п) → подпись «согласовано письмом». */
  letter?: boolean;
  /** Оплата на 0 ₽ (напр. «вынесено в оплату закупки»): проверять нечего — в счётчики «ждут проверки» не входит (isCountedPayment). */
  zero?: boolean;
  /** Чем подтверждено реестром сверки (п/п, сумма и дата совпали) — только для оплат. */
  registryFact: string | null;
  /** Пояснение «из чего состоит» для строки (аукцион: закупки). */
  members: string[];
};

export type VerifyModel = {
  rows: VerifyRow[];
  /** Для скрипта: данные, которых нет в строке. */
  extra: {
    paymentPp: Map<string, { ppNo: string | null; amount: number; paidIso: string }>;
    purchaseNumber: Map<string, string>;
    purchaseGroupId: Map<string, string | null>;
    orderBatchNumber: Map<string, number | null>;
    batchNumber: Map<string, number>;
  };
};
export type VerifyOpts = {
  userId?: string | null;
  canUpload?: boolean;
  canMark?: boolean;
  c4Mode?: Commission4Mode;
  /** Какие виды считать (по умолчанию все). */
  kinds?: VerifyKind[];
  /** Только одна сущность: ускоряет карточки. */
  only?: { kind: VerifyKind; id: string };
};
export type VerifyFlag = { verified: boolean; auto: boolean };
export type VerifyFlags = {
  /** По видам: сколько строк и сколько подтверждено (дёшево, без расчёта блокеров). */
  counts: Record<VerifyKind, { total: number; verified: number; auto: number }>;
  purchaseByNumber: Map<string, VerifyFlag>;
  batchByNumber: Map<number, VerifyFlag>;
  orderById: Map<string, VerifyFlag>;
  /** Суммы оплат поставщику (COMPLETED), ₽: подтверждено / ждёт проверки / из ждущих — без платёжки (флаг «подтверждена» снят). */
  paid: { verified: number; waiting: number; noProof: number };
};
export type VerifyCounts = { total: number; verified: number; waiting: number; ready: number; auto: number };

/** Общие входы шагов загрузки модели (loadVerifyModel): строки и extra дополняются по ходу. */
export type ModelCtx = {
  db: Db;
  orgId: string;
  opts: VerifyOpts;
  only: VerifyOpts["only"];
  reg0: Registry;
  userId: string | null;
  names: Map<string, string>;
  rows: VerifyRow[];
  extra: VerifyModel["extra"];
  pick: (kind: VerifyKind) => boolean;
};
