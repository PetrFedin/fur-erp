// Производство на витрине (этап 4): список ТЗ для «ТЗ», «Партий», «Изделий», «Ремонта» (loadOrdersDrill) из снимка drill:all:<4 %>
// равен живому расчёту (отдельный год — вживую), по обоим режимам 4 %, отбор страницы (ids, hides) работает так же. Копия базы (имя содержит «scratch»).
import "./stubs/server-only-shim";
delete process.env.SNAPSHOTS;
import { prisma } from "../src/lib/prisma";
import { same } from "./lib/deep-same";

if (!/scratch/.test(process.env.DATABASE_URL ?? "")) { console.error("Отказ: DATABASE_URL не похож на копию (нет «scratch»)"); process.exit(2); }
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; console.log(`${cond ? "OK  " : "FAIL"} ${what}${extra ? " " + extra : ""}`); if (!cond) fails++; };

(async () => {
  const { buildMart } = await import("../src/lib/mart/build");
  const { readSnapshot } = await import("../src/lib/mart/snapshots");
  const { loadOrdersDrill, loadOrdersDrillAll } = await import("../src/lib/orders-drill");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  await buildMart(prisma, org); // всегда: в копии может лежать витрина прежнего кода
  const years = ["all", "2025", "2026"] as const;
  let bad: string[] = [];
  for (const y of years) for (const c4 of ["on", "off"] as const) {
    if (y === "all" && (await readSnapshot(org, `drill:${y}:${c4}`)) === null) { bad.push(`${y}/${c4}: нет снимка`); continue; }
    const d = same(await loadOrdersDrillAll(org, y, c4), await loadOrdersDrill(org, y, c4));
    if (d) bad.push(`${y}/${c4}: ${d}`);
  }
  ok("список ТЗ: снимок = живой расчёт (годы × режим 4 %)", bad.length === 0, bad.slice(0, 2).join(" | "));
  const all = await loadOrdersDrillAll(org, "all", "on");
  const ids = new Set(all.filter((_, i) => i % 3 === 0).map((o) => o.id));
  const live = all.filter((o) => ids.has(o.id));
  const view = await loadOrdersDrill(org, "all", "on", { ids });
  ok(`отбор страницы по ТЗ (${ids.size} из ${all.length})`, same(live, view) === null);
  const noHides = await loadOrdersDrill(org, "all", "on", { hides: false });
  ok("hides: false обнуляет шкуры подрядчика и не портит снимок", noHides.every((o) => !o.hI && !o.hE) && same(all, await loadOrdersDrill(org, "all", "on")) === null);
  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
