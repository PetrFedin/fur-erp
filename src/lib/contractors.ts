import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Подрядчики = поставщики с флагом isContractor (один контрагент может быть и поставщиком сырья, и подрядчиком, как Веллмех).
 * У ТЗ подрядчик хранится в ProductionOrder.contractorId; пусто — определяется по номеру договора (payment-parties.contractorOfContract).
 */
export type ContractorLite = { id: string; name: string };

/** Действующие подрядчики организации (для выбора в ТЗ, фильтров, оплат). */
export async function loadContractors(orgId: string): Promise<ContractorLite[]> {
  return prisma.supplier.findMany({ where: { organizationId: orgId, isContractor: true, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Подрядчик по умолчанию: если действующий один — он, иначе пусто (выбирают вручную). */
export const soleContractorId = (list: ContractorLite[]): string => (list.length === 1 ? list[0].id : "");

/** Проверка выбранного подрядчика: свой, действующий, помечен как подрядчик. Пусто — «не указан». */
export async function resolveContractorId(orgId: string, raw: string | null | undefined): Promise<{ id: string | null; error?: string }> {
  const id = (raw ?? "").trim();
  if (!id) return { id: null };
  const s = await prisma.supplier.findFirst({ where: { id, organizationId: orgId, isContractor: true }, select: { id: true, isActive: true } });
  if (!s) return { id: null, error: "Подрядчик не найден" };
  return { id: s.id };
}

/** Подрядчик группы ТЗ: у всех назначенных ТЗ один и тот же — он; иначе null. */
export function singleContractorId(orders: { contractorId?: string | null }[]): string | null {
  const ids = Array.from(new Set(orders.map((o) => o.contractorId).filter((x): x is string => !!x)));
  return ids.length === 1 ? ids[0] : null;
}
