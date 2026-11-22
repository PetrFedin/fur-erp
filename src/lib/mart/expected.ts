import type { PrismaClient } from "@prisma/client";

/**
 * Эталон контрольных чисел витрины (решение владельца 22.11.2026: хранить как данные с датой утверждения, а не константой в коде).
 * Значения по умолчанию — сезонные блоки отчёта «заказ и продажи» (решение 16.11: 845 / 637 / 291 / 346).
 * После новой загрузки владелец утверждает новые числа на вкладке «Контроль → Данные»; до утверждения действует последнее утверждённое.
 */
export type MartExpected = { ordered: number; received: number; sold: number; stock: number; stockRetailRub: number };

export const MART_EXPECTED: MartExpected = { ordered: 845, received: 637, sold: 291, stock: 346, stockRetailRub: 689_484_200 };

export const EXPECTED_KEY = "mart-expected";

export type MartExpectedState = { values: MartExpected; approvedAt: string | null; approvedBy: string | null; fromData: boolean };

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Эталон организации: утверждённый в данных, иначе значения по умолчанию. */
export async function loadMartExpected(db: Pick<PrismaClient, "systemState">, orgId: string): Promise<MartExpectedState> {
  const st = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: EXPECTED_KEY } }, select: { value: true } });
  const v = st?.value as (Partial<MartExpected> & { approvedAt?: string; approvedBy?: string }) | null | undefined;
  if (!v || typeof v !== "object") return { values: MART_EXPECTED, approvedAt: null, approvedBy: null, fromData: false };
  return {
    values: {
      ordered: num(v.ordered, MART_EXPECTED.ordered),
      received: num(v.received, MART_EXPECTED.received),
      sold: num(v.sold, MART_EXPECTED.sold),
      stock: num(v.stock, MART_EXPECTED.stock),
      stockRetailRub: num(v.stockRetailRub, MART_EXPECTED.stockRetailRub),
    },
    approvedAt: typeof v.approvedAt === "string" ? v.approvedAt : null,
    approvedBy: typeof v.approvedBy === "string" ? v.approvedBy : null,
    fromData: true,
  };
}

/** Утвердить новые эталонные числа (только владелец/администратор — проверяется в действии). */
export async function saveMartExpected(db: Pick<PrismaClient, "systemState">, orgId: string, values: MartExpected, by: string): Promise<void> {
  const value = { ...values, approvedAt: new Date().toISOString(), approvedBy: by };
  await db.systemState.upsert({
    where: { organizationId_key: { organizationId: orgId, key: EXPECTED_KEY } },
    create: { organizationId: orgId, key: EXPECTED_KEY, value },
    update: { value },
  });
}
