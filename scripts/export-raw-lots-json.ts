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
  const rows = lots.filter((l) => l.purchaseStatus !== "DRAFT" && l.purchaseStatus !== "CANCELLED").map((l) => ({
    item: l.item, src: l.source === "auction" ? "Куплено на аукционе" : "Куплено у поставщика", year: String(l.year), auction: l.auctionLabel,
    lot: l.lotNumber || "Без номера", grade: l.grade || l.materialName, recv: l.recv, recvIn: Math.round(l.recvIncl), used: l.used, usedIn: Math.round(l.usedIncl),
    rem: l.rem, remIn: Math.round(l.remIncl), recvEx: Math.round(l.recvExcl), usedEx: Math.round(l.usedExcl), remEx: Math.round(l.remExcl),
    attrs: l.attrs.length ? l.attrs.join(", ") : "—", color: (l.color || "").trim() && (l.color || "").trim() !== "Не указан" ? (l.color || "").trim() : "—", usd: l.usdPrice, usdQty: l.usdQty, usdSub: Math.round(l.usdSubtotal * 100) / 100, usdUQty: l.usdUsedQty, usdUSub: Math.round(l.usdUsedSubtotal * 100) / 100, usdRQty: l.usdRemQty, usdRSub: Math.round(l.usdRemSubtotal * 100) / 100,
  }));
  writeFileSync(process.argv[2], JSON.stringify(rows));
  const t = (k: string) => rows.reduce((s, r) => s + ((r as Record<string, number>)[k] ?? 0), 0);
  console.log("лотов", rows.length, "куплено", t("recv"), "использовано", t("used"), "остаток", t("rem"), "с $", t("usdQty"));
  await prisma.$disconnect();
})();
