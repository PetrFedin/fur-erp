// Основные загрузчики данных не делают запросов к таблицам с organizationId без условия по организации и без ключа записи.
// Включает защиту в режиме error (src/lib/tenant-guard.ts) и вызывает загрузчики Главной, «Сырья», «Закупок», «Оплат», сверки и подтверждений.
process.env.TENANT_GUARD = "error";
import "./stubs/server-only-shim";

let fails = 0, checks = 0;
const run = async (name: string, fn: () => Promise<unknown>) => {
  checks++;
  try { await fn(); console.log(`OK   ${name}`); }
  catch (e) { fails++; console.log(`FAIL ${name}: ${(e as Error).message.slice(0, 220)}`); }
};

(async () => {
  const { prisma } = await import("../src/lib/prisma");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const { loadDashboard } = await import("../src/lib/dashboard-data");
  const { parseDashFilters } = await import("../src/lib/dashboard-calc");
  const { loadFurLots } = await import("../src/lib/fur-table-server");
  const { computePurchaseView } = await import("../src/lib/mart/purchase-view");
  const { loadPaymentsOverviewLive, loadPaymentsLeftLive } = await import("../src/lib/payments-overview");
  const { loadPurchasedParts } = await import("../src/lib/mart/purchased");
  const { loadLevelTotals } = await import("../src/lib/mart/level-totals");
  const { loadVerifyModel } = await import("../src/lib/verification");
  const { loadRegistryWith } = await import("../src/lib/reconciliation-registry");
  const { loadAuctionSummaries } = await import("../src/lib/auction-payments");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const { loadClientDebt } = await import("../src/lib/payment-alloc");

  await run("Главная: loadDashboard", () => loadDashboard(org, "all", parseDashFilters({}), "on"));
  await run("Лоты меха и подкладки", async () => { await loadFurLots(prisma, org, { kind: "fur", year: "all", live: true } as never); await loadFurLots(prisma, org, { kind: "lining", year: "all", live: true } as never); });
  await run("Закупки: строки", () => computePurchaseView(org));
  await run("Оплаты: по годам и «осталось оплатить»", async () => { await loadPaymentsOverviewLive(org); await loadPaymentsLeftLive(org); });
  await run("Витрина: состав «Куплено» и полоса «Сырья»", async () => { await loadPurchasedParts(prisma, org); await loadLevelTotals(org, { top: true, unit: "PCS" }); });
  await run("Подтверждения закупок", () => loadVerifyModel(prisma, org, { userId: "t", kinds: ["purchase"], canUpload: false, canMark: false }));
  await run("Реестр сверки", () => loadRegistryWith(prisma as never, org));
  await run("Аукционы: оплаты", () => loadAuctionSummaries(prisma, org));
  await run("Долг поставщику и заказчикам", async () => { await loadSupplierDebt(prisma, org, "all"); await loadClientDebt(prisma, org, { year: "all" }); });

  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
