// Коэффициенты «без НДС / с НДС» по ТЗ (как на Главной): мех (+ расходы ТЗ), подкладка, надбавка 4 % — для листа «Данные» книги расходов.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/export-vat-ratios.ts <out.json>
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const { loadDrillOrders } = await import("../src/lib/dashboard-data");
  const org = await prisma.organization.findFirst({ select: { id: true } });
  const f = { auction: [], fur: [], color: [], attr: [], batch: [], catgroup: [], status: [], vat: [] };
  const orders = await loadDrillOrders(org!.id, "all", f as never, "on", "all");
  const out: Record<string, { fur: [number, number]; lin: [number, number]; c4: [number, number]; exp: number; hides: [number, number]; res: [number, number] }> = {};
  for (const o of orders) {
    const s = { fur: [0, 0] as [number, number], lin: [0, 0] as [number, number], c4: [0, 0] as [number, number], exp: o.exp, hides: [o.hI, o.hE] as [number, number], res: [o.resI, o.resE] as [number, number] };
    for (const l of o.lines) { const t = l.k === "f" ? s.fur : s.lin; t[0] += l.i - l.ci; t[1] += l.e - l.ce; s.c4[0] += l.ci; s.c4[1] += l.ce; }
    out[o.number] = s;
  }
  writeFileSync(process.argv[2], JSON.stringify(out));
  console.log("ТЗ:", Object.keys(out).length, JSON.stringify(out["П-2026-0066"]), JSON.stringify(out["П-2026-0065"]));
  await prisma.$disconnect();
}
main();
