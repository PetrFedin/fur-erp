/**
 * Сверка: переведённые на витрину блоки экранов дают те же числа, что прежний расчёт.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/mart-vs-legacy.ts
 * Код возврата 2 — есть расхождение (переведённый блок надо вернуть на старый расчёт).
 */
import "./stubs/server-only-shim";
process.env.MART_SNAPSHOT_MAX_AGE_MS ??= String(24 * 3600 * 1000);

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

  // Аналитика сырья: лоты и мост Главной из витрины = прежний расчёт (loadRawData + loadDashboard), по всем годам и по каждому году.
  {
    const { loadRawWithDashboard } = await import("../src/lib/raw-analytics-dash");
    const { loadRawFromMart } = await import("../src/lib/mart/raw-lots");
    const cmp = async (year: "all" | string, label: string) => {
      const L = await loadRawWithDashboard(org, year as never, "off");
      const M = await loadRawFromMart(org, year as never);
      if (!M) { check(`Сырьё ${label}: витрина`, false, "витрина лотов пуста"); return; }
      const key = (l: { id: string }) => l.id;
      const lm = new Map(L.all.map((l) => [key(l), l])), mm = new Map(M.all.map((l) => [key(l), l]));
      const miss = [...lm.keys()].filter((k) => !mm.has(k)), extra = [...mm.keys()].filter((k) => !lm.has(k));
      const f = (l: (typeof L.all)[number]) => [l.recv, l.used, l.rem, l.usedIncl, l.usedExcl, l.usedExtraIncl, l.usedExtraExcl, l.unitIncl, l.unitExcl].map((x) => Number(x.toFixed(2))).concat([l.usages.length]).join("|") + `|${l.kind}|${l.auction}|${l.year}|${l.cat}|${l.size}|${l.synthetic ?? ""}`;
      const diff = [...lm.keys()].filter((k) => mm.has(k) && f(lm.get(k)!) !== f(mm.get(k)!));
      check(`Сырьё ${label}: те же строки и цифры (${lm.size})`, miss.length === 0 && extra.length === 0 && diff.length === 0, `нет в витрине ${miss.length}, лишних ${extra.length}, разных ${diff.length}`);
      if (diff.length) { const k = diff[0]; console.log("  пример:", k, "\n   прежний:", f(lm.get(k)!), "\n   витрина:", f(mm.get(k)!)); }
    };
    await cmp("all", "все годы");
    await cmp("2025", "2025");
    await cmp("2026", "2026");
  }

  // Снимки экранов: то, что читают «Главная» и «Сырьё», равно живому расчёту (по годам и режиму 4 %).
  {
    const { readSnapshot } = await import("../src/lib/mart/snapshots");
    const { loadDashboard } = await import("../src/lib/dashboard-data");
    const { parseDashFilters } = await import("../src/lib/dashboard-calc");
    const { loadFurLots } = await import("../src/lib/fur-table-server");
    const { getFurIndex } = await import("../src/lib/fur-ref-server");
    // JSONB хранит числа с 15 значащими цифрами и ключи в своём порядке: сравниваем без учёта порядка и с допуском 1e-9 на хвост дробей.
    const same = (a: unknown, b: unknown): boolean => {
      if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
      if (a && b && typeof a === "object" && typeof b === "object") {
        const ka = Object.keys(a), kb = Object.keys(b);
        return ka.length === kb.length && ka.every((k) => k in (b as object) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
      }
      return a === b;
    };
    const norm = (x: unknown) => JSON.parse(JSON.stringify(x));
    const idx = await getFurIndex(org);
    for (const y of ["all", "2025", "2026"] as const) {
      for (const c4 of ["on", "off"] as const) {
        const snap = await readSnapshot(org, `dash:${y}:${c4}`);
        const live = await loadDashboard(org, y, parseDashFilters({}), c4);
        check(`Снимок Главной ${y} · 4 % ${c4}`, snap !== null && same(norm(snap), norm(live)), snap === null ? "снимка нет или он устарел" : "");
      }
      for (const kind of ["fur", "lining"] as const) {
        const snap = await readSnapshot(org, `furlots:${kind}:${y}`);
        const live = await loadFurLots(prisma, org, { kind, year: y, furIdx: idx } as never);
        check(`Снимок лотов ${kind} ${y}`, snap !== null && same(norm(snap), norm(live)), snap === null ? "снимка нет или он устарел" : "");
      }
    }
  }

  console.log(bad ? `\nРасхождений: ${bad}` : "\nПереведённые блоки совпадают с прежним расчётом");
  await prisma.$disconnect();
  process.exit(bad ? 2 : 0);
})();
