import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadLive } from "../src/app/(app)/reconciliation/live";
import { loadReconBridge } from "../src/app/(app)/reconciliation/bridge";
const prisma = new PrismaClient();
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const live = await loadLive(org);
  const b = await loadReconBridge(org, live);
  console.log(JSON.stringify(b, null, 1));
  const sp = b.purchase.reduce((a, r) => a + r.value, 0), sw = b.production.reduce((a, r) => a + r.value, 0);
  console.log("purchase check", b.registry.purchase + sp, b.main.raw, "prod check", b.registry.production + sw, b.main.work);
})().finally(() => prisma.$disconnect());
