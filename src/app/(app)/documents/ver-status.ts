import { prisma } from "@/lib/prisma";
import { loadVerifyFlags } from "@/lib/verification";
import type { CovRow } from "@/lib/doc-coverage";

/** Подтверждена ли запись матрицы документов (закупка, партия, ТЗ). Для оплат и договоров подтверждения в матрице нет — не показываем. */
export type VerMap = Map<string, boolean>;

export async function loadCovVer(orgId: string, rows: CovRow[]): Promise<VerMap> {
  const flags = await loadVerifyFlags(prisma, orgId);
  const out: VerMap = new Map();
  for (const r of rows) {
    const f = r.section === "purchases" ? flags.purchaseByNumber.get(r.number) : r.section === "batches" ? flags.batchByNumber.get(Number(r.number)) : r.section === "tz" ? flags.orderById.get(r.id) : undefined;
    if (f) out.set(r.id, f.verified);
  }
  return out;
}
