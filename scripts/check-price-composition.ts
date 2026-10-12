import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadDashboard } from "../src/lib/dashboard-data";
import { priceComposition } from "../src/lib/price-composition-server";
import { COMP_CATS } from "../src/lib/price-composition";
const prisma = new PrismaClient();
const E0 = { auction: [] as string[], fur: [] as string[], color: [] as string[], batch: [] as string[], status: [] as string[], vat: [] as string[], attr: [] as string[], catgroup: [] as string[] };
const f = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  for (const [y, flt, name] of [["all", E0, "все"], ["2026", E0, "2026"], ["all", { ...E0, fur: ["Соболь"] }, "Соболь"], ["all", { ...E0, fur: ["Рысь"] }, "Рысь"]] as const) {
    const d = await loadDashboard(org, y as any, flt as any, "off");
    const pc = await priceComposition(org, d);
    const sumExcl = pc.lots.reduce((a, l) => a + l.excl.reduce((s, x) => s + x, 0), 0);
    const sumVat = pc.lots.reduce((a, l) => a + l.vat, 0);
    console.log(`[${name}] лотов в виджете ${pc.lots.length}; Σ секторов без НДС ${f(sumExcl)} vs Куплено без НДС ${f(d.raw.fur.excl.recvValue)} (Δ ${f(sumExcl - d.raw.fur.excl.recvValue)}); +НДС ${f(sumExcl + sumVat)} vs Куплено с НДС ${f(d.raw.fur.incl.recvValue)} (Δ ${f(sumExcl + sumVat - d.raw.fur.incl.recvValue)})`);
    if (name === "все") {
      const tot = new Array(COMP_CATS.length + 1).fill(0);
      for (const l of pc.lots) l.excl.forEach((x, i) => (tot[i] += x));
      COMP_CATS.forEach((c, i) => console.log("  ", c.label.padEnd(30), f(tot[i]), (100 * tot[i] / sumExcl).toFixed(1) + "%"));
      console.log("   без разбивки".padEnd(33), f(tot[COMP_CATS.length]), (100 * tot[COMP_CATS.length] / sumExcl).toFixed(1) + "%");
      const byKind = new Map<string, number>(); for (const l of pc.lots) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + 1);
      console.log("  kinds", [...byKind]);
      const lots = pc.lots.filter(l => l.kind === "lot"); console.log("  lots w/o breakdown", lots.filter(l => l.excl[COMP_CATS.length] > 0).length, "of", lots.length);
      const pl = pc.lots.filter(l => l.kind === "planned"); for (const l of pl) console.log("  planned", l.fur, f(l.excl.reduce((s,x)=>s+x,0)), l.excl.map(x=>Math.round(x)).join(","));
    }
  }
  await prisma.$disconnect();
})();
