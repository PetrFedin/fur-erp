// «Куплено» одно на всех экранах (определение — src/domain/purchased.ts). Копия базы (имя содержит «scratch»).
//   Сравниваются: домен (витрина), Главная, полоса «Сырья» (мех + подкладка), строки «Закупок», оплаты (оплачено + долг = Куплено + доплата подрядчику).
import "./stubs/server-only-shim";
delete process.env.SNAPSHOTS; // нужна витрина, а не живой расчёт
import { prisma } from "../src/lib/prisma";

if (!/scratch/.test(process.env.DATABASE_URL ?? "")) { console.error("Отказ: DATABASE_URL не похож на копию (нет «scratch»)"); process.exit(2); }
let fails = 0, checks = 0;
const near = (what: string, a: number, b: number, tol = 3) => { checks++; const okk = Math.abs(a - b) <= tol; console.log(`${okk ? "OK  " : "FAIL"} ${what}${okk ? "" : ` (${a} ≠ ${b})`}`); if (!okk) fails++; };

(async () => {
  const { loadPurchasedTotals } = await import("../src/lib/mart/purchased");
  const { loadLevelTotals } = await import("../src/lib/mart/level-totals");
  const { dashboardCached, purchaseViewCached, isMartFresh } = await import("../src/lib/mart/snapshots");
  const { buildMart } = await import("../src/lib/mart/build");
  const { purchaseCategory, countsAsBought } = await import("../src/domain/purchased");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  if (!(await isMartFresh(org))) await buildMart(prisma, org);

  const dom = await loadPurchasedTotals(prisma, org);
  const dash = await dashboardCached(org, "all", "off");
  const fur = await loadLevelTotals(org, { top: true, unit: "PCS" });
  const lin = await loadLevelTotals(org, { top: true, unit: "M" });
  const pv = await purchaseViewCached(org);

  const homeBought = dash.raw.fur.incl.recvValue + dash.raw.lining.incl.recvValue;
  near("домен = Главная", dom.bought.incl, homeBought, 2);
  if (fur && lin) near("домен = полоса «Сырья» (мех + подкладка)", dom.bought.incl, fur.incl.recv + lin.incl.recv, 2);
  else { checks++; fails++; console.log("FAIL полоса «Сырья»: витрина не свежая"); }
  const purchases = pv.rows.filter((r) => countsAsBought(purchaseCategory({ status: r.p.status, items: r.p.items, expenses: r.p.expenses }))).reduce((a, r) => a + r.p.total, 0);
  near("домен = Σ закупок (кроме услуг и отменённых)", dom.bought.incl, purchases, 3);
  const services = pv.rows.filter((r) => purchaseCategory({ status: r.p.status, items: r.p.items, expenses: r.p.expenses }) === "service").reduce((a, r) => a + r.p.total, 0);
  near("услуги по УПД: домен = закупки-услуги", dom.services.incl, services, 1);
  near("оплаты: оплачено + долг (мех + подкладка) = Куплено + доплата подрядчику", dash.paidByItem.fur + dash.paidByItem.lining + dash.left.fur + dash.left.lining, dom.rawTotalCost.incl, 5);

  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
