// Сквозная проверка «правка данных → витрина → экраны» на КОПИИ базы (имя базы содержит «scratch»).
//   Правим расчёт одного лота (транспорт +10 ₽/шкуру) и смотрим, что обновляются ВСЕ потребители одной и той же цифры:
//   верхняя полоса «Сырья», таблицы лотов, Главная, строки «Закупок».
//   1) сразу после записи (витрина устарела): экраны считают вживую и уже видят правку;
//   2) после пересборки витрины: читают из неё и показывают то же самое.
import "./stubs/server-only-shim";
delete process.env.SNAPSHOTS; // run-all-tests ставит SNAPSHOTS=0 (живой расчёт); здесь нужна именно витрина
import { prisma } from "../src/lib/prisma";
import { buildLotPlan, applyLotWrites } from "../src/lib/lot-reprice";

if (!/scratch/.test(process.env.DATABASE_URL ?? "")) { console.error("Отказ: DATABASE_URL не похож на копию (нет «scratch»)"); process.exit(2); }
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; console.log(`${cond ? "OK  " : "FAIL"} ${what}${extra ? " " + extra : ""}`); if (!cond) fails++; };

(async () => {
  const { loadLevelTotals } = await import("../src/lib/mart/level-totals");
  const { loadFurLots } = await import("../src/lib/fur-table-server");
  const { dashboardCached, purchaseViewCached, markDataChanged, isMartFresh } = await import("../src/lib/mart/snapshots");
  const { buildMart } = await import("../src/lib/mart/build");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;

  if (!(await isMartFresh(org))) {
    console.log("(в копии витрина не свежая или её нет — собираю)");
    await buildMart(prisma, org);
  }

  const read = async () => {
    const top = await loadLevelTotals(org, { top: true, unit: "PCS" });
    const lots = await loadFurLots(prisma, org, { kind: "fur", year: "all" } as never);
    const dash = await dashboardCached(org, "all", "on");
    const pv = await purchaseViewCached(org);
    return {
      top: top ? top.incl.recv : null,
      lots: lots.reduce((a, l) => a + l.recvIncl, 0),
      dash: dash.raw.fur.incl.recvValue,
      purchases: pv.rows.reduce((a, r) => a + r.p.total, 0),
    };
  };

  // лот без списаний в закупке с лотами меха: правим «Транспорт на выделку» (+10 ₽ за шкуру)
  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: org, rawMaterial: { unit: { not: "M" } }, usages: { none: {} }, purchaseId: { not: null } },
    select: { id: true, lotNumber: true, costBreakdown: true },
    take: 80,
  });
  let target: { id: string; idx: number; cur: number } | null = null;
  for (const l of lots) {
    const items = ((l.costBreakdown as { items?: { label?: string; value?: number }[] } | null)?.items ?? []);
    const idx = items.findIndex((x) => typeof x.label === "string" && x.label.startsWith("Транспорт на выделку") && Number.isFinite(Number(x.value)));
    if (idx >= 0) { target = { id: l.id, idx, cur: Number(items[idx].value) }; break; }
  }
  if (!target) { console.log("(нет подходящего лота — проверка пропущена)"); process.exit(0); }

  const before = await read();
  ok("до правки все экраны читают витрину и сходятся", before.top !== null && Math.abs((before.top ?? 0) - before.dash) < 2, `(полоса ${before.top}, Главная ${before.dash}; таблица лотов без «заказано, не получено»: ${before.lots})`);

  const plan = await buildLotPlan(prisma, org, target.id, { sheet: [{ idx: target.idx, value: target.cur + 10 }] });
  if ("error" in plan) { ok("план правки лота", false, plan.error); process.exit(1); }
  await prisma.$transaction(async (tx) => { await applyLotWrites(tx, org, plan.writes); });
  await markDataChanged(org); // то же делает revalidateAll после любой записи

  const mid = await read();
  const d1 = mid.lots - before.lots;
  ok("правка изменила стоимость лота", Math.abs(d1) > 1, `(Δ ${d1.toFixed(2)})`);
  ok("сразу после записи полоса «Сырья» не берёт устаревшую витрину (считает вживую)", mid.top === null);
  ok("сразу после записи таблицы лотов видят правку", Math.abs(mid.lots - before.lots - d1) < 0.01);
  ok("сразу после записи Главная видит ту же правку", Math.abs(mid.dash - before.dash - d1) < 1, `(Главная Δ ${(mid.dash - before.dash).toFixed(2)} против ${d1.toFixed(2)})`);
  ok("сразу после записи «Закупки» видят ту же правку", Math.abs(mid.purchases - before.purchases - d1) < 1.5, `(Закупки Δ ${(mid.purchases - before.purchases).toFixed(2)} против ${d1.toFixed(2)})`);

  await buildMart(prisma, org); // фоновая пересборка делает то же самое
  ok("после пересборки витрина свежая", await isMartFresh(org));
  const after = await read();
  ok("после пересборки полоса «Сырья» снова из витрины", after.top !== null);
  ok("после пересборки полоса «Сырья» = Главная", Math.abs((after.top ?? 0) - after.dash) < 2, `(полоса ${after.top}, Главная ${after.dash})`);
  ok("после пересборки числа те же, что сразу после записи", Math.abs(after.lots - mid.lots) < 0.01 && Math.abs(after.dash - mid.dash) < 1 && Math.abs(after.purchases - mid.purchases) < 1.5);
  ok("после пересборки изменение = Δ правки по всем экранам", Math.abs((after.top ?? 0) - (before.top ?? 0) - d1) < 2 && Math.abs(after.dash - before.dash - d1) < 2 && Math.abs(after.purchases - before.purchases - d1) < 2);

  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
