import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { lotComposition, itemsOfBreakdown, splitVat, COMP_CATS } from "../src/lib/price-composition";
const prisma = new PrismaClient();
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const items = await prisma.purchaseItem.findMany({ where: { lotId: null, purchase: { organizationId: org, status: { in: ["DRAFT", "ORDERED", "IN_TRANSIT"] } } }, select: { quantity: true, subtotal: true, vatRate: true, costPlan: true, rawMaterial: { select: { name: true } }, purchase: { select: { number: true, auctionSession: true } } } });
  console.log("items", items.length);
  const by = new Map<string, number>(); for (const i of items) by.set(i.rawMaterial.name + "|" + i.purchase.number, (by.get(i.rawMaterial.name + "|" + i.purchase.number) ?? 0) + 1);
  console.log([...by]);
  const tot: Record<string, number> = {}; let totQty = 0; let shown = 0;
  for (const it of items.filter((i) => /рысь/i.test(i.rawMaterial.name))) {
    const q = it.quantity.toNumber(), vr = it.vatRate.toNumber();
    const planTotal = Number((it.costPlan as any)?.unitCostInclVat) * q;
    const bd = itemsOfBreakdown((it.costPlan as any)?.costBreakdown);
    if (shown++ < 2) { console.log("ITEM", q, vr, planTotal, JSON.stringify(bd)); }
    const comp = Number.isFinite(planTotal) && planTotal > 0 ? lotComposition({ breakdown: null, plans: [it.costPlan], vatRate: vr, qty: q, totalIncl: planTotal }) : null;
    if (!comp) { tot.nobd = (tot.nobd ?? 0) + it.subtotal.toNumber(); continue; }
    const sp = splitVat(comp, vr);
    if (shown <= 2) console.log("comp", comp.format, comp.incl, comp.pack);
    for (const c of COMP_CATS) tot[c.key] = (tot[c.key] ?? 0) + sp.excl[c.key];
    totQty += q;
  }
  console.log(tot, totQty);
})().finally(() => prisma.$disconnect());
