/**
 * ЧЕРНОВИК закупки «Подстёжки и воротники из бобра (Спец. №17, счёт №182)» — ГОТОВ, НО НЕ ПРИМЕНЁН (ждёт решения владельца, Л5.2).
 *
 * Источник — письмо Василия (Веллмех) 18.06.2026 «Приложение 17 (воротники и подстежки из бобра)», архив почты, письмо №174:
 * вложения «Приложение 17.pdf» (Спецификация №17 от 18.06.2026 к Договору купли-продажи №2502, «Вспомогательные материалы для изготовления изделий») и
 * «Счёт 182 от 18.06.2026.pdf» (ООО «МЕРКУРИ МОДА» → ООО «ВеллМех»), итого 442 372,00 ₽ (НДС 22% 79 772,00), 100% предоплата, срок оплаты до 23.06.2026,
 * срок поставки июнь–июль 2026. Оба PDF — сканы, текст получен распознаванием (OCR), суммы строк сходятся со счётом до копейки.
 * УПД, платёжки, согласования, письма «оплачено» в архиве НЕТ → закупка DRAFT, без лотов и оплат.
 *
 * Почему не применено: решение владельца (Л5.2: закупка / расход / объединить с бобром Yusufoğulları) + заявление владельца 08.10.2026 «всё оплачено до СП 09.26» —
 * без платёжки нельзя сказать, оплачен ли счёт; применение увеличит стоимость закупок/долг на 442 372,00. После решения:
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-beaver-spec17-draft.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-beaver-spec17-draft.ts --apply    # перед этим бэкап базы
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-beaver-spec17-draft.ts --rollback docs-inventory/corrections-journal-beaver-spec17.json [--apply]
 * (после --apply добавьте счёт в INVOICES_FOR_DRAFTS в src/lib/supplier-debt.ts, иначе сумма пойдёт в «Ожидаемое», а не в «Счёт выставлен»;
 *  тест scripts/test-supplier-debt-rename.ts проверяет число счетов — обновить.)
 * Цены в спецификации указаны без НДС; сумма с НДС 22% по строке: 9 272 / 91 500 / 57 340 / 57 340 / 79 910 / 100 650.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const JOURNAL_PATH = join(ROOT, "docs-inventory", "corrections-journal-beaver-spec17.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

type Line = { name: string; unit: "M" | "PIECE"; qty: string; priceIncl: string; note: string };
type Spec = {
  tag: string; auctionSession: string; invoiceNumber: string; orderDate: string; expectedDate: string;
  notes: string; invoiceTotal: string; lines: Line[];
};

const SPECS: Spec[] = [
  {
    tag: "beaver-spec17",
    auctionSession: "Бобр Спец. 17",
    invoiceNumber: "182",
    orderDate: "2026-06-18",
    expectedDate: "2026-07-31",
    invoiceTotal: "442372.00",
    notes:
      "[drive-draft:beaver-spec17] Воротники и подстёжки из бобра (вспомогательные материалы) по Спецификации №17 от 18.06.2026 к Договору №2502 (ООО «Веллмех»); " +
      "счёт на оплату №182 от 18.06.2026 на 442 372,00 (в т.ч. НДС 22% 79 772,00), 100% предоплата, оплатить до 23.06.2026 (письмо Василия 18.06.2026, архив почты №174). " +
      "Срок поставки по спецификации: июнь–июль 2026 (expectedDate = конец срока). УПД, платёжки и согласования в архиве нет — «Черновик», на склад не принято, лотов нет. " +
      "Создано скриптом create-beaver-spec17-draft.",
    lines: [
      { name: "Воротник из бобра SM03", unit: "PIECE", qty: "6", priceIncl: "9272", note: "Спец. №17: «Воротник из бобра SM03», 6 шт. × 7 600 руб. без НДС (9 272 с НДС 22%) = 55 632 руб. с НДС." },
      { name: "Подстёжка из бобра цвет фондю LM022", unit: "PIECE", qty: "1", priceIncl: "91500", note: "Спец. №17: «Подстёжка из бобра цвет фондю LM022», 1 шт. × 75 000 руб. без НДС (91 500 с НДС 22%)." },
      { name: "Подстёжка из бобра цвет черный OM56", unit: "PIECE", qty: "1", priceIncl: "57340", note: "Спец. №17: «Подстёжка из бобра цвет черный OM56», 1 шт. × 47 000 руб. без НДС (57 340 с НДС 22%)." },
      { name: "Подстёжка из бобра цвет фондю OM56", unit: "PIECE", qty: "1", priceIncl: "57340", note: "Спец. №17: «Подстёжка из бобра цвет фондю OM56», 1 шт. × 47 000 руб. без НДС (57 340 с НДС 22%)." },
      { name: "Подстёжка из бобра цвет темно синий OM231", unit: "PIECE", qty: "1", priceIncl: "79910", note: "Спец. №17: «Подстёжка из бобра цвет темно синий OМ231», 1 шт. × 65 500 руб. без НДС (79 910 с НДС 22%)." },
      { name: "Подстёжка из бобра цвет фондю OM231", unit: "PIECE", qty: "1", priceIncl: "100650", note: "Спец. №17: «Подстёжка из бобра цвет фондю OM231», 1 шт. × 82 500 руб. без НДС (100 650 с НДС 22%)." },
    ],
  },
];

const D = (x: Decimal.Value) => new Decimal(x);
const journalAppend = (entries: unknown[]) => {
  const prev: unknown[] = existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) : [];
  writeFileSync(JOURNAL_PATH, JSON.stringify([...prev, ...entries], null, 2));
};

async function rollback(file: string) {
  const entries = JSON.parse(readFileSync(resolve(file), "utf-8")) as { entity: string; id: string; field: string }[];
  const ids = (e: string) => entries.filter((x) => x.entity === e && x.field === "__create__").map((x) => x.id);
  const purchases = await prisma.purchase.findMany({ where: { id: { in: ids("Purchase") } }, include: { payments: true, rawMaterialLots: true, stockMovements: true } });
  for (const p of purchases) {
    if (p.payments.length || p.rawMaterialLots.length || p.stockMovements.length || p.status !== "DRAFT")
      throw new Error(`Откат остановлен: ${p.number} уже имеет оплаты/лоты/движения или не DRAFT — удалять вручную нельзя автоматически`);
  }
  const dd = await prisma.driveDocument.count({ where: { purchaseId: { in: purchases.map((p) => p.id) } } });
  if (dd) throw new Error(`Откат остановлен: к закупкам привязано ${dd} DriveDocument — сначала откатите link-drive-docs-remaining.ts`);
  await prisma.$transaction(async (tx) => {
    await tx.purchaseItem.deleteMany({ where: { id: { in: ids("PurchaseItem") } } });
    await tx.purchase.deleteMany({ where: { id: { in: purchases.map((p) => p.id) } } });
    for (const id of ids("RawMaterial")) {
      const used = await tx.purchaseItem.count({ where: { rawMaterialId: id } }) + (await tx.stockMovement.count({ where: { rawMaterialId: id } })) + (await tx.rawMaterialLot.count({ where: { rawMaterialId: id } }));
      if (used === 0) await tx.rawMaterial.delete({ where: { id } });
      else console.log(`RawMaterial ${id} используется — оставлен`);
    }
  });
  console.log(`Откат выполнен: закупок ${purchases.length}.`);
}

async function main() {
  const url = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : ROLLBACK ? "ОТКАТ" : "DRY-RUN (в БД не пишем)"}; БД: ${url}`);
  if (ROLLBACK) return rollback(ROLLBACK);

  const org = await prisma.organization.findFirstOrThrow();
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organizationId: org.id, name: { contains: "Веллмех", mode: "insensitive" } } });
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: org.id, isDefault: true } });

  const before = await debtSnapshot(org.id);
  console.log(`Поставщик: ${supplier.name}; склад: ${warehouse.name}; закупок в базе: ${before.count}; стоимость закупок (с НДС) до: ${before.total.toFixed(2)}`);

  for (const spec of SPECS) {
    const existing = await prisma.purchase.findFirst({ where: { organizationId: org.id, auctionSession: spec.auctionSession, invoiceNumber: spec.invoiceNumber } });
    // --- проверка итога по документу (в памяти, тем же расчётом, что и долг поставщику)
    const fakeItems = spec.lines.map((l) => planItem(l));
    const total = purchaseTotalInclVat({ exchangeRate: D(1), items: fakeItems as never, expenses: [] });
    const ok = total.equals(D(spec.invoiceTotal));
    console.log(`\n${spec.auctionSession} (счёт №${spec.invoiceNumber}): позиций ${spec.lines.length}, итог с НДС ${total.toFixed(2)} ${ok ? "= счёту" : "!= счёту " + spec.invoiceTotal}`);
    for (const l of spec.lines) console.log(`   ${l.name}: ${l.qty} × ${l.priceIncl} = ${D(l.qty).mul(l.priceIncl).toFixed(2)}`);
    if (!ok) throw new Error("Итог не сходится со счётом — остановка");
    if (existing) { console.log(`   уже есть: ${existing.number} — пропуск`); continue; }
    if (!APPLY) { console.log("   [DRY-RUN] будет создана закупка DRAFT"); continue; }

    const time = new Date().toISOString();
    const journal: unknown[] = [];
    await prisma.$transaction(async (tx) => {
      const all = await tx.purchase.findMany({ where: { organizationId: org.id, number: { startsWith: "З-2026-" } }, select: { number: true } });
      const max = Math.max(0, ...all.map((p) => Number(p.number.slice(-4)) || 0));
      const number = `З-2026-${String(max + 1).padStart(4, "0")}`;
      const pid = newId();
      const purchaseData = {
        id: pid, organizationId: org.id, number, supplierId: supplier.id, warehouseId: warehouse.id, status: "DRAFT" as const,
        currency: "RUB", exchangeRate: D(1), auctionSession: spec.auctionSession, invoiceNumber: spec.invoiceNumber,
        transferDocument: null, orderDate: new Date(spec.orderDate + "T00:00:00Z"), expectedDate: new Date(spec.expectedDate + "T00:00:00Z"),
        receivedDate: null, notes: spec.notes,
      };
      await tx.purchase.create({ data: purchaseData });
      journal.push({ time, entity: "Purchase", id: pid, field: "__create__", before: null, after: { ...purchaseData, exchangeRate: "1" }, source: spec.tag });
      for (const l of spec.lines) {
        let mat = await tx.rawMaterial.findFirst({ where: { organizationId: org.id, name: l.name } });
        if (!mat) {
          mat = await tx.rawMaterial.create({ data: { id: newId(), organizationId: org.id, name: l.name, unit: l.unit } });
          journal.push({ time, entity: "RawMaterial", id: mat.id, field: "__create__", before: null, after: { name: l.name, unit: l.unit }, source: spec.tag });
        }
        const it = planItem(l);
        const iid = newId();
        const data = {
          id: iid, purchaseId: pid, rawMaterialId: mat.id, quantity: D(l.qty), unitPrice: it.unitPrice, subtotal: it.subtotal,
          vatRate: D(22), notes: l.note, costPlan: it.costPlan,
        };
        await tx.purchaseItem.create({ data: data as never });
        journal.push({ time, entity: "PurchaseItem", id: iid, field: "__create__", before: null, after: { ...data, quantity: l.qty, unitPrice: it.unitPrice.toString(), subtotal: it.subtotal.toString(), vatRate: "22" }, source: spec.tag });
      }
      console.log(`   СОЗДАНА ${number}`);
    }, { timeout: 60_000 });
    journalAppend(journal);
  }

  const after = await debtSnapshot(org.id);
  console.log(`\nСтоимость закупок (с НДС) после: ${after.total.toFixed(2)}; прирост ${after.total.sub(before.total).toFixed(2)} (ожидается ${APPLY ? "442 372,00" : "0 (dry-run)"}); закупок ${after.count}`);
  if (APPLY) console.log(`Журнал: ${JOURNAL_PATH}. Откат: --rollback ${JOURNAL_PATH}`);
  else console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала бэкап!).");
}

/** Позиция: unitPrice/subtotal без НДС (2 знака), costPlan — точная цена с НДС по спецификации. */
function planItem(l: Line) {
  const incl = D(l.priceIncl);
  const excl = incl.div("1.22");
  const qty = D(l.qty);
  return {
    quantity: qty,
    unitPrice: excl.toDecimalPlaces(2),
    subtotal: qty.mul(excl).toDecimalPlaces(2),
    vatRate: D(22),
    costPlan: {
      unitCostInclVat: incl.toString(),
      materialExclVat: excl.toDecimalPlaces(6).toString(),
      materialVat: incl.sub(excl).toDecimalPlaces(6).toString(),
      expenseExclVat: "0",
      expenseVat: "0",
      costBreakdown: {
        items: [
          { label: "Цена за шт. по спецификации, ₽ (в т.ч. НДС 22%)", value: Number(l.priceIncl) },
          { label: "в т.ч. НДС 22%, ₽", value: Number(incl.sub(excl).toDecimalPlaces(2)) },
        ],
        source: "Спецификация (Google Drive); комиссия и прочие расходы документами не подтверждены — не включены",
      },
    },
  };
}

/** Стоимость всех не отменённых закупок с НДС — тот же расчёт, что и в src/lib/supplier-debt.ts (purchaseTotalInclVat). */
async function debtSnapshot(orgId: string) {
  const ps = await prisma.purchase.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, include: { items: true, expenses: true } });
  let total = D(0);
  for (const p of ps) total = total.add(purchaseTotalInclVat(p as never));
  return { total, count: ps.length };
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
