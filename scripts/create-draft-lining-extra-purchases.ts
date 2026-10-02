/**
 * Черновики закупок «Подкладка 2026 (Спец. №13, счёт №157)» и «Доп. материалы (Спец. №16, счёт №181)».
 *
 * Данные — ТОЛЬКО из документов Google Drive «мех»:
 *   ПРИЛОЖЕНИЕ 13.docx (спецификация №13 от 26.05.2026), Счет на оплату № 157 от 26.05.2026,
 *   ПРИЛОЖЕНИЕ 16.docx (спецификация №16 от 16.06.2026), Счет на оплату № 181 от 16.06.2026.
 * УПД (прихода) в Drive нет → закупки создаются как DRAFT, без лотов, на склад не принимаются.
 * Оплат (платёжек) в Drive нет → Payment не создаётся.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-draft-lining-extra-purchases.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-draft-lining-extra-purchases.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-draft-lining-extra-purchases.ts --rollback docs-inventory/corrections-journal-draft-purchases.json
 *
 * Порядок: СНАЧАЛА этот скрипт, ПОТОМ scripts/link-drive-docs-remaining.ts (он привязывает документы к этим закупкам).
 * Откат: сначала --rollback у link-drive-docs-remaining.ts, затем здесь.
 * ПЕРЕД --apply — бэкап базы (scripts/backup.sh).
 *
 * Идемпотентность: закупка ищется по паре (auctionSession, invoiceNumber); есть — пропуск. Материалы — по точному имени.
 *
 * Цены: в спецификациях цена «в т.ч. НДС 22%». PurchaseItem.unitPrice/subtotal хранятся БЕЗ НДС (2 знака), поэтому
 * итог закупки для долга считается из costPlan.unitCostInclVat (цена по спецификации с НДС) — так сумма равна счёту
 * до копейки (5 400 000,00 и 19 870,00), без накопления округлений.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const JOURNAL_PATH = join(ROOT, "docs-inventory", "corrections-journal-draft-purchases.json");
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
    tag: "lining-spec13",
    auctionSession: "Подкладка Спец. 13",
    invoiceNumber: "157",
    orderDate: "2026-05-26",
    expectedDate: "2026-08-31",
    invoiceTotal: "5400000.00",
    notes:
      "[drive-draft:lining-spec13] Подкладочная ткань по Спецификации №13 от 26.05.2026 к Договору №2502 (ООО «Веллмех»); " +
      "счёт на оплату №157 от 26.05.2026 на 5 400 000,00 (в т.ч. НДС 22% 973 770,49), 100% предоплата, оплатить до 29.05.2026. " +
      "Срок поставки по спецификации: июль–август 2026 (expectedDate = конец срока); допуск по количеству ±3%. " +
      "УПД (приход) в Drive отсутствует — закупка в статусе «Черновик», на склад не принята, лотов нет. " +
      "Окончательная стоимость по спецификации = сумма всех УПД. Создано скриптом create-draft-lining-extra-purchases.",
    lines: [
      ["37", "300"], ["24", "300"], ["2", "100"], ["4", "100"], ["23", "100"], ["38", "100"], ["41", "100"], ["27", "100"],
    ].map(([n, q]) => ({
      name: `Подкладочная ткань №${n}`, unit: "M" as const, qty: q, priceIncl: "4500",
      note: `Спец. №13: «Подкладочная ткань №${n} /130», ${q} м.п. × 4 500 руб. (в т.ч. НДС 22%) = ${Number(q) * 4500} руб.`,
    })),
  },
  {
    tag: "extra-spec16",
    auctionSession: "Доп. материалы Спец. 16",
    invoiceNumber: "181",
    orderDate: "2026-06-16",
    expectedDate: "2026-07-31",
    invoiceTotal: "19870.00",
    notes:
      "[drive-draft:extra-spec16] Вспомогательные материалы по Спецификации №16 от 16.06.2026 к Договору №2502 (ООО «Веллмех»); " +
      "счёт на оплату №181 от 16.06.2026 на 19 870,00 (в т.ч. НДС 22% 3 583,11), 100% предоплата, оплатить до 19.06.2026. " +
      "Срок поставки по спецификации: июнь–июль 2026 (expectedDate = конец срока); допуск по количеству ±3%. " +
      "УПД (приход) в Drive отсутствует — закупка в статусе «Черновик», на склад не принята, лотов нет. " +
      "Создано скриптом create-draft-lining-extra-purchases.",
    lines: [
      {
        name: "Премиальная шерсть с альпакой и шёлком", unit: "M", qty: "2", priceIncl: "6985",
        note: "Спец. №16: «Премиальная шерсть с альпакой и шёлком» (шерсть 70%, шерсть 20%, шёлк 10% — формулировка документа), 2 м.п. × 6 985 руб. (в т.ч. НДС 22%) = 13 970 руб.",
      },
      {
        name: "Кожа натуральная", unit: "M", qty: "0.5", priceIncl: "11800",
        note: "Спец. №16: «Кожа натуральная», 0,5 м.п. × 11 800 руб. (в т.ч. НДС 22%) = 5 900 руб.",
      },
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
  console.log(`\nСтоимость закупок (с НДС) после: ${after.total.toFixed(2)}; прирост ${after.total.sub(before.total).toFixed(2)} (ожидается ${APPLY ? "5 419 870,00" : "0 (dry-run)"}); закупок ${after.count}`);
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
          { label: "Цена за м.п. по спецификации, ₽ (в т.ч. НДС 22%)", value: Number(l.priceIncl) },
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
