// Таблица «платёж / документ / ставка / база / НДС» по всем оплатам (Payment и ProductionPayment) → docs-inventory/audit-2026-10-20/vat-payments.md. Только чтение.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/audit-vat-payments-2026-10-20.ts
import "./stubs/server-only-shim";
import { writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { loadPaymentsOverview } from "../src/lib/payments-overview";
import { loadPurchaseVat } from "../src/lib/cashflow-server";
import { workPaymentVatRate } from "../src/lib/cashflow";

const prisma = new PrismaClient();
const f = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const [ov, pv] = await Promise.all([loadPaymentsOverview(org), loadPurchaseVat(org)]);
  const purchases = await prisma.purchase.findMany({ where: { organizationId: org }, select: { id: true, number: true, orderDate: true, invoiceNumber: true, items: { select: { vatRate: true } }, expenses: { select: { vatRate: true } } } });
  const pById = new Map(purchases.map((p) => [p.id, p]));
  const out: string[] = ["# НДС по оплатам: платёж / документ / ставка / база / НДС (сгенерировано scripts/audit-vat-payments-2026-10-20.ts)", "",
    "Правило. Работа подрядчика (ProductionPayment): НДС включён в сумму (счета Веллмеха «В том числе НДС r%»), ставка по дате счёта из основания: до 2026 — 20 %, с 2026 — 22 %. Сырьё (Payment): доля НДС закупки, на которую разнесён платёж (по позициям закупки).", "",
    "| Вид | Дата | Сумма | Документ (основание) | Ставка | База (без НДС) | НДС |", "|---|---|---:|---|---|---:|---:|"];
  let sumAmt = 0, sumVat = 0, noRate = 0;
  const flags: string[] = [];
  for (const r of [...ov].sort((a, b) => (a.iso < b.iso ? -1 : 1))) {
    let vat = 0, rate = "—";
    if (r.kind === "prod") {
      const x = workPaymentVatRate(r.doc);
      if (x) { vat = (r.amount * x) / (100 + x); rate = `${x} %`; } else noRate++;
    } else {
      const rates = new Set<string>();
      for (const part of r.parts) {
        const id = part.href?.startsWith("/purchases/") ? part.href.slice("/purchases/".length) : null;
        const fr = id ? pv.get(id) : undefined;
        if (fr !== undefined) { vat += part.amount * fr; const p = pById.get(id!); const rs = new Set([...(p?.items ?? []), ...(p?.items.length ? [] : p?.expenses ?? [])].map((i) => Number(i.vatRate))); rs.forEach((v) => rates.add(String(v))); if (p && rs.has(22) && p.orderDate.toISOString() < "2026-01-01") flags.push(`${p.number}: ставка 22 % при дате закупки ${p.orderDate.toISOString().slice(0, 10)}`); }
      }
      rate = rates.size ? [...rates].sort().join("/") + " %" : "—";
      if (!rates.size) noRate++;
    }
    sumAmt += r.amount; sumVat += vat;
    out.push(`| ${r.kind === "prod" ? "работа" : r.services > 0 ? "услуги/УПД" : "сырьё"} | ${r.iso} | ${f(r.amount)} | ${(r.doc ?? r.label).replace(/\|/g, "/").slice(0, 110)} | ${rate} | ${f(r.amount - vat)} | ${f(vat)} |`);
  }
  out.push("", `Итого: ${ov.length} оплат, сумма ${f(sumAmt)}, НДС ${f(sumVat)}, база ${f(sumAmt - sumVat)}; без известной ставки: ${noRate}.`, "");
  const uniq = [...new Set(flags)];
  out.push("## Закупки: ставка 22 % при дате закупки до 2026 года", "", ...(uniq.length ? uniq.map((x) => `- ${x}`) : ["нет"]), "");
  const stub = purchases.filter((p) => p.orderDate.toISOString().slice(0, 10) === "2025-06-01").map((p) => `- ${p.number}: дата закупки ${p.orderDate.toISOString().slice(0, 10)}, счёт ${p.invoiceNumber ?? "—"}`);
  out.push("## Закупки с датой-заглушкой 01.06.2025", "", ...(stub.length ? stub : ["нет"]), "");
  writeFileSync(join(__dirname, "../docs-inventory/audit-2026-10-20/vat-payments.md"), out.join("\n"));
  console.log(`оплат ${ov.length}, НДС ${f(sumVat)}, без ставки ${noRate}; флаги ${uniq.length}; заглушек ${stub.length}`);
  uniq.forEach((x) => console.log(" ", x)); stub.forEach((x) => console.log(" ", x));
  await prisma.$disconnect();
})();
