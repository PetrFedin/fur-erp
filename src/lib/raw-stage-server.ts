import "server-only";
import { prisma } from "@/lib/prisma";
import { summarizeStages, summaryChip, summaryLine, type RawSummary } from "@/lib/raw-stage";

export type RawInfo = { chip: string; line: string; overdue: boolean; sum: RawSummary };

/** Этап сырья по закупкам (данные Веллмеха): purchaseId → короткий чип «Выделка · ждём к 20.10» и полная строка. Закупок без этапов в карте нет. */
export async function loadRawInfo(orgId: string, purchaseIds?: string[]): Promise<Map<string, RawInfo>> {
  if (purchaseIds && purchaseIds.length === 0) return new Map();
  const rows = await prisma.supplierRawStage.findMany({
    where: { organizationId: orgId, ...(purchaseIds ? { purchaseId: { in: purchaseIds } } : {}) },
    select: { purchaseId: true, stage: true, status: true, place: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true },
  });
  const by = new Map<string, typeof rows>();
  for (const r of rows) (by.get(r.purchaseId) ?? by.set(r.purchaseId, []).get(r.purchaseId)!).push(r);
  const out = new Map<string, RawInfo>();
  for (const [id, list] of by) {
    const sum = summarizeStages(list);
    if (sum) out.set(id, { chip: summaryChip(sum), line: summaryLine(sum), overdue: sum.overdue, sum });
  }
  return out;
}
