/**
 * Импорт закупки меха СП 09-26 (Союзпушнина, партия FW26/27, договор №2502
 * с ООО «Меркури Мода»): 8 счетов аукциона → 8 закупок (черновик — мех ещё
 * не пришёл, срок поставки 30.12.2026), 29 лотов с предварительным расчётом
 * себестоимости единицы (Purchase­Item.costPlan) и всеми документами:
 *   — счёт аукциона к каждой закупке (к её лотам);
 *   — на всю партию: спецификация №20, расчётный лист, счёт на аванс №271.
 * Данные расчёта — scripts/sp0926_plan.json (получен из расчётного листа и
 * сверен построчно со счетами аукциона: лот, кол-во, цена, курс и итог счёта
 * до рубля). Сами файлы в репозиторий не кладём: передайте каталог с ними.
 *
 * Запуск: node --env-file=.env node_modules/.bin/tsx scripts/import-sp0926.ts <каталог с файлами>
 * Идемпотентен: закупка с тем же счётом и документ с тем же названием второй раз не создаются.
 */
import { readFileSync, copyFileSync, mkdirSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
const BATCH = "СП 09-26";
const TAG = "import-sp0926";
const UPLOAD_ROOT = resolve(process.env.UPLOAD_DIR?.trim() || "./uploads");

type Lot = {
  lot: string; quantity: number; size: string; operation: string; priceUsd: number;
  auctionFee: number; auctionFeeVat: number; goodsVat: number; dressing: number;
  transport: number; broker: number; transit: number; unitCost: number; totalCost: number;
};
type Plan = {
  batch: string;
  purchases: { invoice: string; date: string; rate: number; invoiceTotal: number; product: string; lots: Lot[] }[];
};

const d = (n: number) => new Decimal(n).toDecimalPlaces(6).toString();
const parseDate = (s: string) => {
  const [dd, mm, yy] = s.split(".");
  return new Date(`${yy}-${mm}-${dd}T00:00:00.000Z`);
};

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("Укажите каталог с файлами: ... import-sp0926.ts <каталог>");
  const plan: Plan = JSON.parse(readFileSync(join(__dirname, "sp0926_plan.json"), "utf-8"));

  const org = await prisma.organization.findFirstOrThrow();
  const organizationId = org.id;
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { organizationId, isDefault: true } });
  const supplier =
    (await prisma.supplier.findFirst({ where: { organizationId, name: { contains: "Веллмех", mode: "insensitive" } } })) ??
    (await prisma.supplier.create({ data: { organizationId, name: "ООО «Веллмех»" } }));

  const materialId = async (name: string) =>
    (await prisma.rawMaterial.findFirst({ where: { organizationId, name } }))?.id ??
    (await prisma.rawMaterial.create({ data: { organizationId, name, unit: "PIECE" } })).id;

  function storeFile(scope: string, file: string) {
    const ext = file.split(".").pop()!.toLowerCase();
    const mimeType = MIME[ext];
    if (!mimeType) throw new Error(`Неизвестный тип файла: ${file}`);
    const src = join(dir, file);
    const sizeBytes = statSync(src).size;
    const rel = join("purchase-docs", organizationId, scope, `${randomUUID()}.${ext}`);
    const abs = resolve(UPLOAD_ROOT, rel);
    if (!abs.startsWith(UPLOAD_ROOT + sep)) throw new Error("Путь вне UPLOAD_DIR");
    mkdirSync(resolve(abs, ".."), { recursive: true });
    copyFileSync(src, abs);
    return { storagePath: rel, originalName: file, mimeType, sizeBytes };
  }

  async function addDoc(opts: { purchaseId: string | null; kind: string; title: string; file: string; scope: string }) {
    const exists = await prisma.purchaseDocument.findFirst({
      where: { organizationId, purchaseId: opts.purchaseId, batch: opts.purchaseId ? null : BATCH, title: opts.title },
    });
    if (exists) return;
    await prisma.purchaseDocument.create({
      data: {
        organizationId,
        purchaseId: opts.purchaseId,
        batch: opts.purchaseId ? null : BATCH,
        kind: opts.kind as never,
        title: opts.title,
        ...storeFile(opts.scope, opts.file),
      },
    });
    console.log(`  документ: ${opts.title}`);
  }

  let firstPurchaseId: string | null = null;
  let lots = 0;
  let totalCost = new Decimal(0);

  for (const p of plan.purchases) {
    const tag = `${TAG}:${p.invoice}`;
    let purchase = await prisma.purchase.findFirst({ where: { organizationId, notes: tag } });
    if (!purchase) {
      const count = await prisma.purchase.count({ where: { organizationId } });
      const number = `З-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
      const matId = await materialId(p.product.startsWith("Соболь") ? "Соболь" : "Лиса красная");
      purchase = await prisma.$transaction(async (tx) => {
        const pur = await tx.purchase.create({
          data: {
            organizationId, number, supplierId: supplier.id, warehouseId: warehouse.id,
            status: "DRAFT", currency: "USD", exchangeRate: p.rate,
            auctionSession: BATCH, invoiceNumber: p.invoice,
            orderDate: parseDate(p.date), expectedDate: new Date("2026-12-30T00:00:00.000Z"),
            notes: tag,
          },
        });
        for (const l of p.lots) {
          const collision = await tx.rawMaterialLot.findFirst({ where: { organizationId, lotNumber: l.lot } });
          const lotNumber = collision ? `СП0926-${l.lot}` : l.lot;
          const rate = new Decimal(p.rate);
          const goods = new Decimal(l.priceUsd).mul(rate);
          const dressExcl = new Decimal(l.dressing).div(1.22);
          const expenseExcl = new Decimal(l.auctionFee).add(dressExcl).add(l.transport).add(l.broker).add(l.transit);
          const expenseVat = new Decimal(l.auctionFeeVat).add(new Decimal(l.dressing).sub(dressExcl));
          const items = [
            { label: "Цена за ед., $", value: l.priceUsd },
            { label: "Курс ЦБ на дату счёта", value: p.rate },
            { label: "Цена за ед. по курсу, ₽", value: goods.toNumber() },
            { label: `Аукционный сбор, маркетинговый сбор, сбор за доставку (${(Math.round((l.auctionFee / goods.toNumber()) * 10000) / 100).toString().replace(".", ",")}% от цены), ₽`, value: l.auctionFee },
            { label: "НДС на аукционный сбор, ₽", value: l.auctionFeeVat },
            { label: "НДС 22% на товар, ₽", value: l.goodsVat },
            { label: "Выделка (с НДС 22%), ₽", value: l.dressing },
            { label: "Транспорт на выделку и обратно, ₽", value: l.transport },
            { label: "Брокерский %, 4,5% от цены, ₽", value: l.broker },
            ...(l.transit ? [{ label: "Комиссия за транзит денег, ₽", value: l.transit }] : []),
            { label: "Итого себестоимость за единицу, ₽", value: l.unitCost },
          ];
          const item = await tx.purchaseItem.create({
            data: {
              purchaseId: pur.id,
              rawMaterialId: matId,
              quantity: l.quantity,
              unitPrice: l.priceUsd,
              subtotal: new Decimal(l.priceUsd).mul(l.quantity),
              vatRate: 22,
              lotNumber,
              grade: l.size || null,
              notes: l.operation ? `Операция: ${l.operation}` : null,
              costPlan: {
                unitCostInclVat: d(l.unitCost),
                materialExclVat: d(goods.toNumber()),
                materialVat: d(l.goodsVat),
                expenseExclVat: d(expenseExcl.toNumber()),
                expenseVat: d(expenseVat.toNumber()),
                costBreakdown: {
                  furDescription: [p.product, l.size, l.operation && `операция: ${l.operation}`].filter(Boolean).join("; "),
                  exchangeRateInvoice: String(p.rate),
                  exchangeRateFixed: null,
                  items,
                },
              },
            },
          });
          void item;
        }
        return pur;
      }, { timeout: 30000 });
      console.log(`Закупка ${purchase.number}: счёт ${p.invoice}, лотов ${p.lots.length}`);
    }
    firstPurchaseId ??= purchase.id;
    await addDoc({
      purchaseId: purchase.id, kind: "AUCTION_INVOICE", scope: purchase.id,
      title: `Счёт аукциона №${p.invoice} от ${p.date}`, file: `${p.invoice} ООО ВеллМех.pdf`,
    });
    lots += p.lots.length;
    totalCost = totalCost.add(p.lots.reduce((s, l) => s.add(l.totalCost), new Decimal(0)));
  }

  const scope = `batch-${firstPurchaseId}`;
  await addDoc({ purchaseId: null, kind: "SPECIFICATION", scope, title: "Спецификация №20 от 30.09.2026 к договору №2502 (СП 09-26)", file: "ПРИЛОЖЕНИЕ 20 (СП09-26).docx" });
  await addDoc({ purchaseId: null, kind: "CALC_SHEET", scope, title: "Расчёт закупки СП 09-26 (предварительный, ММ)", file: "расчет закупки СП 09-26.xlsx" });
  await addDoc({ purchaseId: null, kind: "ADVANCE_INVOICE", scope, title: "Счёт №271 от 30.09.2026 на аванс 60 831 100 ₽", file: "Счет_на_оплату_№_271_от_30_сентября_2026_г.pdf" });

  console.log(`Лотов: ${lots}, себестоимость всего: ${totalCost.toFixed(2)} ₽`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
