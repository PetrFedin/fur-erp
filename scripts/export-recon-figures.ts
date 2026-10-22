// Цифры приложения для листа «Сверка» книги «Расходы, сырьё и Cash Flow»: себестоимость ТЗ, сырьё, оплаты + ТЗ-ремонт (в Excel его строк нет).
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/export-recon-figures.ts <out.json>
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

(async () => {
  const prisma = new PrismaClient();
  const org = (await prisma.organization.findFirst())!.id;
  const { loadDashboard, loadDrillOrders } = await import("../src/lib/dashboard-data");
  const { parseDashFilters } = await import("../src/lib/dashboard-calc");
  const d = await loadDashboard(org, "all", parseDashFilters({}), "on" as never);
  const a = d.prod.done, w = d.prod.work;
  const s = (k: keyof typeof a) => (a[k] as number) + (w[k] as number);
  const prod = { qty: s("qty"), fur: s("furIncl") + s("expenses"), lining: s("liningIncl"), c4: s("c4Incl"), work: s("workSum"), furEx: s("furExcl") + s("expenses"), liningEx: s("liningExcl"), c4Ex: s("c4Excl"), repairQty: s("repairQty") };
  const f = d.raw.fur;
  const raw = { recvQty: f.incl.recvQty, recvValue: f.incl.recvValue, usedQty: f.incl.usedQty, usedValue: f.incl.usedValueOther, remQty: f.incl.remQty, remValue: f.incl.remValue, recvValueEx: f.excl.recvValue, usedValueEx: f.excl.usedValueOther, remValueEx: f.excl.remValue };
  const paid = d.paidByItem;
  const orders = await loadDrillOrders(org, "all", parseDashFilters({}), "on" as never, "all");
  const repair = orders.filter((o) => o.cat === "Ремонт").map((o) => ({ number: o.number, st: o.st, cat: o.cat, grp: o.grp, fur: o.fur, qty: o.qty, work: o.work, exp: o.exp, ml: o.ml, y: o.y, bl: o.bl, sw: o.sw ?? null,
    furIn: o.lines.filter((l) => l.k === "f").reduce((x, l) => x + l.i - l.ci, 0), furEx: o.lines.filter((l) => l.k === "f").reduce((x, l) => x + l.e - l.ce, 0),
    linIn: o.lines.filter((l) => l.k === "l").reduce((x, l) => x + l.i - l.ci, 0), linEx: o.lines.filter((l) => l.k === "l").reduce((x, l) => x + l.e - l.ce, 0),
    c4In: o.lines.reduce((x, l) => x + l.ci, 0), c4Ex: o.lines.reduce((x, l) => x + l.ce, 0) }));
  writeFileSync(process.argv[2], JSON.stringify({ prod, raw, paid, repair }, null, 1));
  console.log(JSON.stringify({ prod, raw, paid }), "ремонт ТЗ:", repair.length);
  await prisma.$disconnect();
})();
