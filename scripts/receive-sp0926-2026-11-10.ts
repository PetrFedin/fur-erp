/**
 * Приёмка закупок «СП 09.26» (З-2026-0050…0057) на склад по УПД №317 от 10.11.2026: та же единственная реализация, что у кнопки «Принять на склад» (receivePurchaseInTx).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/receive-sp0926-2026-11-10.ts [--apply]
 * Без --apply приёмка выполняется внутри транзакции и откатывается (только расчёт итогов).
 */
import "./stubs/server-only-shim";

class Rollback extends Error {}

(async () => {
  const apply = process.argv.includes("--apply");
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { receivePurchaseInTx } = await import("../src/lib/purchase-receive");
  const db = createAuditedClient("script:receive-sp0926");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const ps = await db.purchase.findMany({ where: { organizationId: org, auctionSession: "СП 09.26", status: "DRAFT" }, select: { id: true, number: true }, orderBy: { number: "asc" } });
  console.log("к приёмке:", ps.map((p) => p.number).join(", "));
  const run = async (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => {
    for (const p of ps) await receivePurchaseInTx(tx as never, p.id, org);
    const lots = await tx.rawMaterialLot.findMany({ where: { purchase: { organizationId: org, auctionSession: "СП 09.26" } }, select: { quantityReceived: true, totalCost: true, lotNumber: true } });
    const q = lots.reduce((a, l) => a + Number(l.quantityReceived), 0), t = lots.reduce((a, l) => a + Number(l.totalCost), 0);
    console.log(`лотов создано: ${lots.length}; шкур: ${q}; стоимость лотов (с НДС): ${t.toFixed(2)} (УПД 64464504.98)`);
    const st = await tx.purchase.findMany({ where: { id: { in: ps.map((p) => p.id) } }, select: { number: true, status: true } });
    console.log("статусы:", st.map((s) => `${s.number} ${s.status}`).join(", "));
    if (!apply) throw new Rollback();
  };
  try { await db.$transaction(run, { timeout: 120_000, maxWait: 10_000 }); console.log(apply ? "ПРИМЕНЕНО" : ""); }
  catch (e) { if (e instanceof Rollback) console.log("откат (без --apply ничего не записано)"); else throw e; }
  process.exit(0);
})().catch((e) => { console.error(String(e).slice(0, 800)); process.exit(1); });
