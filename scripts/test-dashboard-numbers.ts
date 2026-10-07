// Сверка чисел Сводки (/dashboard) с SQL: куплено / использовано / остаток (мех), производство, Σ столбцов гистограммы по уровням.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-dashboard-numbers.ts
// Только чтение. Код возврата 1 — при расхождениях.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadFurLots } from "../src/lib/fur-table-server";
import { figures, flowOf } from "../src/lib/fur-table";
import { loadOrderRows } from "../src/lib/analytics-orders";
import { toDrillOrder } from "../src/lib/dashboard-calc";
import { CHAIN, levelFor, drillTotals, type PathStep, type RootMode, type VatSel } from "../src/lib/dashboard-drill";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number, want: number, tol = 0.02) => {
  checks++;
  if (Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: получено ${got}, ожидалось ${want}`); }
};

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  // 1. Эталоны владельца (мех, все годы, с НДС)
  const fur = await loadFurLots(prisma, org, { kind: "fur", year: "all" });
  const f = flowOf(fur);
  const on = figures(f, { vat: "incl", c4: "on" });
  const off = figures(f, { vat: "incl", c4: "off" });
  eq("куплено шт", on.recvQty, 18215); eq("куплено ₽", on.recvValue, 399225945.58);
  eq("остаток шт", on.remQty, 9909); eq("остаток ₽", on.remValue, 226704828.65);
  eq("использовано шт", on.usedQty, 8306); eq("использовано без 4%", off.usedValue, 172521116.93); eq("использовано с 4%", on.usedValue, 178822087.35);
  eq("USD: куплено = использовано + остаток (шт на USD-лотах)", on.usdQty, on.usdUsedQty + on.usdRemQty);

  // 2. SQL независимо: куплено/остаток по лотам меха
  const [r] = await prisma.$queryRawUnsafe<{ q: number; rem: number }[]>(
    `select sum(l."quantityReceived")::float q, sum(l."quantityRemaining")::float rem from "RawMaterialLot" l join "RawMaterial" m on m.id=l."rawMaterialId" where l."organizationId"='${org}' and m.unit<>'M'`);
  eq("SQL куплено шт", on.recvQty, r.q); eq("SQL остаток шт", on.remQty, r.rem);

  // 3. Производство и Σ столбцов гистограммы на трёх срезах: все годы / 2025 / 2026, оба режима 4% и НДС
  for (const c4 of ["on", "off"] as const) {
    const rows = await loadOrderRows(org, "all", c4);
    for (const y of ["all", "2025", "2026"]) {
      const sel = rows.filter((o) => o.status === "COMPLETED" && (y === "all" || o.year === Number(y)));
      const drill = sel.map((o) => toDrillOrder(o, c4, (n) => n ?? "Без аукциона"));
      for (const vat of ["incl", "excl"] as VatSel[]) {
        const tile = sel.reduce((s, o) => s + (vat === "incl" ? o.costIncl : o.costExcl), 0);
        const tot = drillTotals(drill, vat);
        eq(`[${y}/${c4}/${vat}] себестоимость плитки = Σ ТЗ`, tot.cost, tile, 0.05);
        for (const mode of Object.keys(CHAIN) as RootMode[]) {
          const l1 = levelFor(drill, mode, [], vat);
          eq(`[${y}/${c4}/${vat}/${mode}] Σ столбцов = плитка`, l1.total, tile, 0.05);
          // уровень 2 и 3 по первому столбцу, дальше — до состава
          let path: PathStep[] = [];
          let level = l1;
          for (let d = 0; d < 6 && level.kind === "dim" && level.items.length > 0; d++) {
            const it = level.items[0];
            path = [...path, { dim: level.dim!, key: it.key, label: it.label }];
            const next = levelFor(drill, mode, path, vat);
            eq(`[${y}/${c4}/${vat}/${mode}] Σ уровня ${d + 2} = столбец «${it.label}»`, next.total, it.value, 0.05);
            level = next;
          }
          if (level.kind === "composition") {
            for (const part of level.items.filter((i) => i.drillable)) {
              const ln = levelFor(drill, mode, [...path, { dim: "part", key: part.key, label: part.label }], vat);
              eq(`[${y}/${c4}/${vat}/${mode}] Σ лотов «${part.label}»`, ln.total, part.value, 0.05);
            }
          }
        }
      }
    }
  }
  console.log(`${checks} проверок, расхождений: ${fails}`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();
