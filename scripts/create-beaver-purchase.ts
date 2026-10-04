/**
 * «Бобр как мех тоже должен быть в системе» (решение владельца): вид меха «Бобр» в каталоге сырья +
 * закупка «бобр», Invoice Nr 1-2026 от 06.08.2026 — черновик (DRAFT), без лотов.
 *
 * ИСТОЧНИК (единственный): отчёт ~/Downloads/08_06_2026_Отчет_по_закупке_мехового_сырья_MVST.xlsx, лист «закупка FW26»,
 * стр. 165–167 (+ сводка «Лист1», стр. 18–19). В Drive «мех» инвойса, спецификации, УПД, счёта Веллмех и платёжки по бобру нет
 * (подробно — docs-inventory/beaver-findings.md). Из отчёта берутся ТОЛЬКО: название, количество, «Себестоимость за единицу
 * руб» (столбец AO), «Себестоимость общая руб» (AP), шапка «Invoice Nr: 1-2026 / Date: 06.08.2026 / Client/Bill to:
 * YUSUFOĞULLARI TEKSTİL DERİ». Номеров лотов, сортов, валюты инвойса, курса, аукциона/сборов, НДС, статуса прихода в отчёте нет —
 * эти поля остаются пустыми и перечислены в notes закупки («Чего не хватает»).
 *
 * Почему DRAFT: УПД/приходных документов нет → на склад не принимается (RECEIVED только по УПД и корректной сумме).
 * Проверка и подтверждение (verifiedAt) НЕ ставятся. Оплат нет — Payment не создаётся.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-beaver-purchase.ts            # DRY-RUN (транзакция откатывается)
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-beaver-purchase.ts --apply    # перед этим scripts/backup.sh
 *   node --env-file=.env node_modules/.bin/tsx scripts/create-beaver-purchase.ts --rollback docs-inventory/corrections-journal-beaver.json [--apply]
 *
 * Идемпотентно: метка [fix:beaver] в Purchase.notes / RawMaterial.description / Supplier.notes; закупка, уже созданная флагом
 * apply-registry-corrections.ts --with-beaver-draft (сессия «Invoice 1-2026 (бобр)»), тоже считается существующей.
 * Журнал: docs-inventory/corrections-journal-beaver.json ({time, entity, id, field:"__create__", before, after, source}).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const argv = process.argv;
const APPLY = argv.includes("--apply");
const rbIdx = argv.indexOf("--rollback");
const ROLLBACK_FILE = rbIdx >= 0 ? argv[rbIdx + 1] : null;
const ROOT = resolve(__dirname, "..");
const JOURNAL = resolve(ROOT, "docs-inventory", "corrections-journal-beaver.json");
const TAG = "[fix:beaver]";

const SESSION = "Invoice 1-2026 (бобр)";
const INVOICE = "1-2026";
const ORDER_DATE = "2026-08-06";
const COUNTERPARTY = "YUSUFOĞULLARI TEKSTİL DERİ";
const SRC = "отчёт 08_06_2026_Отчет_по_закупке_мехового_сырья_MVST.xlsx, лист «закупка FW26», стр. 165–167 (Invoice Nr: 1-2026, Date: 06.08.2026, Client/Bill to: YUSUFOĞULLARI TEKSTİL DERİ)";

type Line = { row: number; name: string; color: string; qty: number; unitCost: number; total: number };
const LINES: Line[] = [
  { row: 165, name: "Dressed beaver skin color black", color: "black", qty: 49, unitCost: 7870, total: 385630 },
  { row: 166, name: "Dressed beaver skin color brown", color: "brown", qty: 376, unitCost: 7870, total: 2959120 },
  { row: 167, name: "Dressed beaver skin color deep blue", color: "deep blue", qty: 162, unitCost: 7070, total: 1145340 },
];
const EXPECT_QTY = 587;
const EXPECT_TOTAL = new Decimal("4490090.00");

const NOTES =
  `${TAG} Бобр выделанный (Dressed beaver skin) по строкам Invoice Nr 1-2026 от 06.08.2026, 587 шт (49 black, 376 brown, 162 deep blue), 4 490 090,00 ₽. ` +
  `Источник: ${SRC}. Суммы — «Себестоимость общая руб» из отчёта (столбец AO/AP), трактованы как ₽ без отдельного НДС (vatRate 0): ` +
  `валюта инвойса, курс, НДС и состав себестоимости в отчёте не указаны. ` +
  `Контрагент «${COUNTERPARTY}» — это «Client/Bill to» в шапке инвойса; кто продавец, документами не подтверждено. ` +
  `ЧЕГО НЕ ХВАТАЕТ: сам инвойс 1-2026 (файл), спецификация/упаковочный лист, номера лотов и сорта, валюта и курс, продавец/аукцион, ` +
  `счёт на оплату, УПД/приход (поэтому DRAFT, на склад не принято, лотов нет), платёжка. Не подтверждено (verifiedAt не ставится).`;

type Entry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };
const snap = (v: unknown) => JSON.parse(JSON.stringify(v));
class DryRunDone extends Error {}

function appendJournal(entries: Entry[]) {
  if (!entries.length) return;
  const cur: Entry[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  writeFileSync(JOURNAL, JSON.stringify(cur.concat(entries), null, 1));
}

async function debt(tx: Prisma.TransactionClient, orgId: string) {
  const ps = await tx.purchase.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, include: { items: true, expenses: true } });
  let total = new Decimal(0);
  for (const p of ps) total = total.add(purchaseTotalInclVat(p as never));
  return { n: ps.length, total };
}

async function run(tx: Prisma.TransactionClient, J: Entry[], orgId: string) {
  const sumQty = LINES.reduce((s, l) => s + l.qty, 0);
  const sum = LINES.reduce((s, l) => s.add(l.total), new Decimal(0));
  if (sumQty !== EXPECT_QTY || !sum.equals(EXPECT_TOTAL)) throw new Error(`Итог ${sumQty} шт / ${sum} не сходится с отчётом`);
  for (const l of LINES) if (!new Decimal(l.qty).mul(l.unitCost).equals(l.total)) throw new Error(`Строка ${l.row}: ${l.qty}×${l.unitCost} ≠ ${l.total}`);
  const time = new Date().toISOString();
  const mk = async (entity: string, model: string, data: Record<string, unknown>, source: string) => {
    const row = await (tx as never as Record<string, any>)[model].create({ data }); // eslint-disable-line @typescript-eslint/no-explicit-any
    J.push({ time, entity, id: row.id, field: "__create__", before: null, after: snap(row), source });
    return row;
  };

  // 1. вид меха в каталоге
  let fur = await tx.rawMaterial.findFirst({ where: { organizationId: orgId, name: "Бобр" } });
  if (fur) console.log(`  ✓ каталог: «Бобр» уже есть (${fur.id})`);
  else {
    fur = await mk("RawMaterial", "rawMaterial", { organizationId: orgId, name: "Бобр", unit: "PIECE", description: `${TAG} Вид меха «Бобр» (выделанная шкура), шт. Как «Соболь», «Норка», «Лиса», «Рысь».` }, SRC);
    console.log(`  + каталог: создан вид меха «Бобр» (шт.)`);
  }

  // 2. закупка
  const existing = await tx.purchase.findFirst({
    where: { organizationId: orgId, OR: [{ notes: { contains: TAG } }, { auctionSession: SESSION, invoiceNumber: INVOICE }] },
  });
  if (existing) return console.log(`  ✓ закупка уже есть: ${existing.number} (${existing.status}) — пропуск`);

  const warehouse = await tx.warehouse.findFirstOrThrow({ where: { organizationId: orgId, isDefault: true } });
  let supplier = await tx.supplier.findFirst({ where: { organizationId: orgId, name: COUNTERPARTY } });
  if (!supplier) {
    supplier = await mk("Supplier", "supplier", {
      organizationId: orgId, name: COUNTERPARTY,
      notes: `${TAG} Заведён по шапке инвойса 1-2026 («Client/Bill to»). Роль (продавец/посредник), реквизиты и контакты документами не подтверждены.`,
    }, SRC);
  }
  const all = await tx.purchase.findMany({ where: { organizationId: orgId }, select: { number: true } });
  const mx = Math.max(0, ...all.map((p) => Number(p.number.match(/^З-2026-(\d+)$/)?.[1] ?? 0)));
  const number = `З-2026-${String(mx + 1).padStart(4, "0")}`;
  const purchase = await mk("Purchase", "purchase", {
    organizationId: orgId, number, supplierId: supplier!.id, warehouseId: warehouse.id, status: "DRAFT", currency: "RUB", exchangeRate: 1,
    auctionSession: SESSION, invoiceNumber: INVOICE, orderDate: new Date(`${ORDER_DATE}T00:00:00.000Z`), notes: NOTES,
  }, SRC);
  for (const l of LINES) {
    await mk("PurchaseItem", "purchaseItem", {
      purchaseId: purchase.id, rawMaterialId: fur!.id, quantity: new Decimal(l.qty), unitPrice: new Decimal(l.unitCost), subtotal: new Decimal(l.total),
      vatRate: 0, color: l.color,
      notes: `${TAG} «${l.name}» (отчёт, стр. ${l.row}): ${l.qty} шт × ${l.unitCost} ₽ = ${l.total} ₽. Лот, сорт, размер, валюта инвойса — не указаны.`,
    }, `${SRC}, стр. ${l.row}`);
  }
  console.log(`  + закупка ${number}: DRAFT, ${COUNTERPARTY}, ${LINES.length} позиции, ${sumQty} шт, ${sum.toFixed(2)} ₽, orderDate ${ORDER_DATE}`);
}

async function rollback(file: string) {
  const entries = JSON.parse(readFileSync(resolve(file), "utf-8")) as Entry[];
  const ids = (e: string) => entries.filter((x) => x.entity === e && x.field === "__create__").map((x) => x.id);
  const purchases = await prisma.purchase.findMany({ where: { id: { in: ids("Purchase") } }, include: { payments: true, rawMaterialLots: true, stockMovements: true, driveDocuments: true } });
  for (const p of purchases) {
    if (p.payments.length || p.rawMaterialLots.length || p.stockMovements.length || p.driveDocuments.length || p.status !== "DRAFT")
      throw new Error(`Откат остановлен: ${p.number} уже имеет оплаты/лоты/движения/документы или не DRAFT — вручную`);
  }
  console.log(`${APPLY ? "ОТКАТ" : "ОТКАТ (dry-run)"}: закупок ${purchases.length} (${purchases.map((p) => p.number).join(", ")}), позиций ${ids("PurchaseItem").length}, поставщиков ${ids("Supplier").length}, материалов ${ids("RawMaterial").length}`);
  if (!APPLY) return console.log("DRY-RUN: ничего не удалено. Добавьте --apply.");
  await prisma.$transaction(async (tx) => {
    await tx.purchaseItem.deleteMany({ where: { id: { in: ids("PurchaseItem") } } });
    await tx.purchase.deleteMany({ where: { id: { in: purchases.map((p) => p.id) } } });
    for (const id of ids("Supplier")) {
      const used = (await tx.purchase.count({ where: { supplierId: id } })) + (await tx.payment.count({ where: { supplierId: id } })) + (await tx.driveDocument.count({ where: { supplierId: id } }));
      if (!used) await tx.supplier.delete({ where: { id } }); else console.log(`Supplier ${id} используется — оставлен`);
    }
    for (const id of ids("RawMaterial")) {
      const used = (await tx.purchaseItem.count({ where: { rawMaterialId: id } })) + (await tx.stockMovement.count({ where: { rawMaterialId: id } })) + (await tx.rawMaterialLot.count({ where: { rawMaterialId: id } })) + (await tx.productionMaterialUsage.count({ where: { rawMaterialId: id } }));
      if (!used) await tx.rawMaterial.delete({ where: { id } }); else console.log(`RawMaterial ${id} используется — оставлен`);
    }
  });
  const rest = entries.filter((x) => !["Purchase", "PurchaseItem", "Supplier", "RawMaterial"].includes(x.entity));
  writeFileSync(resolve(file), JSON.stringify(rest, null, 1));
  console.log("Откат выполнен (журнал очищен).");
}

async function main() {
  console.log(`${ROLLBACK_FILE ? "ОТКАТ" : APPLY ? "APPLY" : "DRY-RUN (транзакция откатывается)"}; БД: ${(process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@")}`);
  if (ROLLBACK_FILE) return rollback(ROLLBACK_FILE);
  const org = await prisma.organization.findFirstOrThrow();
  const J: Entry[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const b = await debt(tx, org.id);
      await run(tx, J, org.id);
      const a = await debt(tx, org.id);
      console.log(`Закупок (без отменённых): ${b.n} → ${a.n}; стоимость с НДС: ${b.total.toFixed(2)} → ${a.total.toFixed(2)} (Δ ${a.total.sub(b.total).toFixed(2)})`);
      if (!APPLY) throw new DryRunDone();
    }, { timeout: 120000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRunDone)) throw e; }
  if (APPLY) { appendJournal(J); console.log(`Журнал: ${JOURNAL} (${J.length} записей). Откат: --rollback ${JOURNAL} --apply`); }
  else console.log("DRY-RUN: ничего не записано. Перед --apply: scripts/backup.sh.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
