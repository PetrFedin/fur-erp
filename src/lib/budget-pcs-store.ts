import "server-only";
import { prisma } from "@/lib/prisma";
import seed from "@/lib/budget-pcs-seed.json";
import type { PcsDoc, PcsRow } from "@/lib/budget-pcs";

/** Документы Budget PCS: SystemState, ключ budget-pcs:<id>. Первый документ создаётся из файлов MVST (RTW от 19.10 и Acc от 22.10). */
const PREFIX = "budget-pcs:";
const SEEDED = "budget-pcs-seeded";

type Stored = Partial<Omit<PcsDoc, "id" | "updatedAt">>;
const parse = (key: string, v: unknown, updatedAt: Date): PcsDoc => {
  const o = (v ?? {}) as Stored;
  return { id: key.slice(PREFIX.length), name: o.name ?? "Budget PCS", season: o.season ?? "", supplier: o.supplier ?? "", asOf: o.asOf ?? { RTW: "", Acc: "" }, rows: o.rows ?? [], params: o.params, createdAt: o.createdAt ?? updatedAt.toISOString(), updatedAt: updatedAt.toISOString(), updatedBy: o.updatedBy ?? null };
};

export async function listPcs(orgId: string): Promise<PcsDoc[]> {
  const seeded = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: SEEDED } }, select: { id: true } });
  if (!seeded) {
    await prisma.systemState.create({ data: { organizationId: orgId, key: SEEDED, value: true } });
    const value = { name: seed.name, season: seed.season, supplier: seed.supplier, asOf: seed.asOf, rows: seed.rows as PcsRow[], createdAt: new Date().toISOString(), updatedBy: null };
    await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: PREFIX + "fw27-mvst" } }, update: {}, create: { organizationId: orgId, key: PREFIX + "fw27-mvst", value } });
  }
  const rows = await prisma.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: PREFIX } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => parse(r.key, r.value, r.updatedAt));
}
export async function getPcs(orgId: string, id: string): Promise<PcsDoc | null> {
  const r = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PREFIX + id } } });
  return r ? parse(r.key, r.value, r.updatedAt) : null;
}
export async function putPcs(orgId: string, id: string, d: Omit<PcsDoc, "id" | "updatedAt">): Promise<void> {
  const value = { name: d.name, season: d.season, supplier: d.supplier, asOf: d.asOf, rows: d.rows, params: d.params, createdAt: d.createdAt, updatedBy: d.updatedBy };
  await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: PREFIX + id } }, update: { value }, create: { organizationId: orgId, key: PREFIX + id, value } });
}
export async function deletePcs(orgId: string, id: string): Promise<void> {
  await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: PREFIX + id } });
}
