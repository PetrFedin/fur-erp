// Лоты меха для сводной «Сырьё»: куплено / использовано / остаток (шт., ₽, $ молотка). Только чтение.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/export-raw-lots-json.ts <out.json>
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { loadFurLots } from "../src/lib/fur-table-server";

(async () => {
  const prisma = new PrismaClient();
  const org = (await prisma.organization.findFirst())!.id;
  const lots = await loadFurLots(prisma, org, { kind: "fur", year: "all" });
  // Как на Главной: к лотам склада добавляются строки «Заказано, не получено» (считаются купленными) и «Шкуры подрядчика».
  const { loadDashboard } = await import("../src/lib/dashboard-data");
  const { parseDashFilters } = await import("../src/lib/dashboard-calc");
  const dash = await loadDashboard(org, "all", parseDashFilters({}), "on" as never);
  const synth = dash.syntheticLots;
  const rows = lots.filter((l) => l.purchaseStatus !== "DRAFT" && l.purchaseStatus !== "CANCELLED").map((l) => ({
    item: l.item, src: l.source === "auction" ? "Куплено на аукционе" : "Куплено у поставщика", year: String(l.year), auction: l.auctionLabel,
    lot: l.lotNumber || "Без номера", grade: l.grade || l.materialName, recv: l.recv, recvIn: Math.round(l.recvIncl), used: l.used, usedIn: Math.round(l.usedIncl),
    rem: l.rem, remIn: Math.round(l.remIncl), recvEx: Math.round(l.recvExcl), usedEx: Math.round(l.usedExcl), remEx: Math.round(l.remExcl),
    attrs: l.attrs.length ? l.attrs.join(", ") : "—", color: (l.color || "").trim() && (l.color || "").trim() !== "Не указан" ? (l.color || "").trim() : "—", usd: l.usdPrice, usdQty: l.usdQty, usdSub: Math.round(l.usdSubtotal * 100) / 100, usdUQty: l.usdUsedQty, usdUSub: Math.round(l.usdUsedSubtotal * 100) / 100, usdRQty: l.usdRemQty, usdRSub: Math.round(l.usdRemSubtotal * 100) / 100,
  }));
  // Как в приложении (planUsdAvg): цена в $ по расчёту заказа берётся только у вида меха, у которого нет лотов с ценой в $ (рысь).
  const hasLotUsd = new Set(rows.filter((r) => r.usdQty > 0).map((r) => r.item));
  for (const l of synth) {
    const planOk = !hasLotUsd.has(l.item) && (l.usdPlanQty ?? 0) > 0;
    const hides = l.id.startsWith("hides:");
    rows.push({ item: l.item, src: hides ? "Куплено у поставщика" : "Куплено на аукционе", year: String(l.year), auction: hides ? "Шкуры подрядчика" : l.auctionLabel, lot: hides ? "Шкуры подрядчика" : "Заказано, не получено", grade: hides ? "Шкуры подрядчика" : `${l.materialName} · заказано, не получено`,
      recv: l.recv, recvIn: Math.round(l.recvIncl), used: l.used, usedIn: Math.round(l.usedIncl), rem: l.rem, remIn: Math.round(l.remIncl), recvEx: Math.round(l.recvExcl), usedEx: Math.round(l.usedExcl), remEx: Math.round(l.remExcl),
      attrs: "—", color: "—",
      // «Заказано, не получено»: цена в $ — из расчёта позиций закупки (в приложении она же у рыси); шкуры не использованы, поэтому остаток = куплено.
      usd: planOk ? Math.round(((l.usdPlanSubtotal ?? 0) / (l.usdPlanQty ?? 1)) * 100) / 100 : null, usdQty: planOk ? l.usdPlanQty ?? 0 : 0, usdSub: planOk ? Math.round((l.usdPlanSubtotal ?? 0) * 100) / 100 : 0, usdUQty: 0, usdUSub: 0, usdRQty: planOk ? l.usdPlanQty ?? 0 : 0, usdRSub: planOk ? Math.round((l.usdPlanSubtotal ?? 0) * 100) / 100 : 0 } as (typeof rows)[number]);
  }
  writeFileSync(process.argv[2], JSON.stringify(rows));
  const t = (k: string) => rows.reduce((s, r) => s + ((r as unknown as Record<string, number>)[k] ?? 0), 0);
  console.log("лотов", rows.length, "куплено", t("recv"), "использовано", t("used"), "остаток", t("rem"), "с $", t("usdQty"));
  await prisma.$disconnect();
})();
