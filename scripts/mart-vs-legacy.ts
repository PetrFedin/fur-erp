/**
 * Сверка: переведённые на витрину блоки экранов дают те же числа, что прежний расчёт.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/mart-vs-legacy.ts
 * Код возврата 2 — есть расхождение (переведённый блок надо вернуть на старый расчёт).
 */
import "./stubs/server-only-shim";

(async () => {
  const { prisma } = await import("../src/lib/prisma");
  const { loadReportSeasonTotalsLegacy } = await import("../src/lib/margin-server");
  const { martFreshForReport, martSeasonTotals } = await import("../src/lib/mart/read");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  let bad = 0;
  const check = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ": " + detail : ""}`); };

  const state = await martFreshForReport(org);
  check("Витрина свежа относительно отчёта, прайса и прихода", state === "fresh", state);

  const legacy = await loadReportSeasonTotalsLegacy(org);
  const mart = await martSeasonTotals(org);
  check("Итоги сезонов: витрина = прежний расчёт", JSON.stringify(legacy) === JSON.stringify(mart), JSON.stringify(mart?.map((t) => [t.label, t.conf, t.deliv])));
  if (JSON.stringify(legacy) !== JSON.stringify(mart)) console.log("  прежний:", JSON.stringify(legacy), "\n  витрина:", JSON.stringify(mart));

  console.log(bad ? `\nРасхождений: ${bad}` : "\nПереведённые блоки совпадают с прежним расчётом");
  await prisma.$disconnect();
  process.exit(bad ? 2 : 0);
})();
