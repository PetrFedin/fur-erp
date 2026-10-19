// Сверка «Оплачено» в Сводке закупок (/lots?tab=summary): закупки ВНЕ аукциона (З-0008, З-0009…) должны получать
// свои оплаты (Payment.purchaseId, COMPLETED), а не 0. Независимый путь — SQL по таблице Payment.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-purchase-summary-paid.ts
// Только чтение. Код возврата 1 — при расхождениях.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadSummary, NO_AUCTION } from "../src/lib/purchase-summary";
import { auctionName } from "../src/lib/auction-names";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number, want: number, tol = 0.02) => {
  checks++;
  if (Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: получено ${got}, ожидалось ${want}`); }
};

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const { leaves } = await loadSummary(org);
  // Закупки вне аукциона: Σ оплат листьев = Σ завершённых оплат этих закупок (SQL)
  const ps = await prisma.purchase.findMany({
    where: { organizationId: org, status: { not: "CANCELLED" } },
    select: { auctionSession: true, _count: { select: { items: true, expenses: true } }, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
  });
  // Закупки-услуги (УПД без позиций сырья) в сводке по сырью — листьев нет: их оплаты идут отдельной статьёй «Услуги по УПД» (см. test-reconciliation).
  const noAuc = ps.filter((p) => auctionName(p.auctionSession) == null && p.payments.length > 0 && !(p._count.items === 0 && p._count.expenses > 0));
  const r = { s: noAuc.reduce((t, p) => t + p.payments.reduce((x, y) => x + Number(y.amount), 0), 0), n: noAuc.length };
  const got = leaves.filter((l) => l.auction === NO_AUCTION).reduce((s, l) => s + l.paidIncl.toNumber(), 0);
  eq("закупки вне аукциона: Σ «Оплачено» листьев = Σ оплат закупок (SQL)", got, r.s, 0.05);
  console.log(`  вне аукциона: закупок с оплатами ${r.n}, оплачено ${got.toFixed(2)}`);
  console.log(fails ? `ПРОВАЛ: ${fails} из ${checks}` : `OK: ${checks} проверок`);
  process.exit(fails ? 1 : 0);
})().finally(() => prisma.$disconnect());
