import "server-only";
import { prisma } from "@/lib/prisma";
import { calcYear, type CalcPayload } from "@/lib/supplier-calc";
import { inboxScope, type SupplierSess } from "@/lib/supplier-inbox";

/** Годы для выбора в «Новый расчёт»: годы уже внесённых расчётов и аукционов справочника, текущий и прошлый; новые, по убыванию. */
export async function calcYearOptions(s: SupplierSess): Promise<number[]> {
  const now = new Date().getUTCFullYear();
  const set = new Set<number>([now, now - 1]);
  const [calcs, auctions] = await Promise.all([
    prisma.supplierInbox.findMany({ where: { kind: "AUCTION_CALC", ...inboxScope(s) }, select: { payload: true, updatedAt: true } }),
    prisma.auction.findMany({ where: { organizationId: s.user.organizationId, year: { not: null } }, select: { year: true }, distinct: ["year"] }),
  ]);
  for (const c of calcs) { const h = (c.payload as unknown as CalcPayload)?.header; const y = h ? calcYear(h) : null; set.add(y ?? c.updatedAt.getUTCFullYear()); }
  for (const a of auctions) if (a.year) set.add(a.year);
  return [...set].filter((y) => y >= 2000 && y <= 2100).sort((a, b) => b - a);
}
