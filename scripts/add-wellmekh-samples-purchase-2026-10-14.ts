/**
 * Образцы меха Веллмех (УПД №177 от 08.06.2026, счёт №177 от 08.06.2026, спецификация №15 от 05.06.2026 к договору №2502):
 * заводит закупку (неоплаченную, RUB, НДС 22 %) с 16 лотами — по строкам ведомости бухгалтерии (сч. 10.01), 22 шт., 217 350 ₽ без НДС.
 * Приёмка — через receivePurchaseInTx (как кнопка «Принять на склад»), чтобы лоты принадлежали закупке и сверка «куплено = общая стоимость» держалась.
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал); --rollback [--apply] удаляет созданное.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/add-wellmekh-samples-purchase-2026-10-14.ts --docs=<каталог с вложениями письма 172> [--apply|--rollback] [--no-backup]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join, resolve } from "path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const DOCS = process.argv.find((a) => a.startsWith("--docs="))?.slice(7);
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-wellmekh-samples-2026-10-14.json");
const DATE = new Date("2026-06-08T00:00:00Z");
const VAT = 22;

// Строки ведомости бухгалтерии (16) ← строки УПД №177 (19). price — без НДС за штуку.
type Row = { mat: string; lot: string | null; grade: string; qty: number; price: number; notes: string };
const ROWS: Row[] = [
  { mat: "Бобр", lot: "10572/6", grade: "Шкура бобр коричневый М 10572/6", qty: 5, price: 7000, notes: "УПД №177: п.15 бобр коричневый М 10572/6 ×1; п.16 бобр фондю стриженный 10572/6 ×2; п.17 бобр чёрный стриженный 15 мм 10572/6 ×2; по 7 000 ₽ без НДС" },
  { mat: "Бобр", lot: "374474", grade: "Шкура бобр торторо h7 L 374474", qty: 1, price: 7000, notes: "УПД №177, п.10" },
  { mat: "Выдра", lot: null, grade: "Шкура выдра перфорированная", qty: 1, price: 16700, notes: "УПД №177, п.2" },
  { mat: "Каракульча", lot: "763541", grade: "Шкура каракульча серебро вышивка 763541", qty: 1, price: 10250, notes: "УПД №177, п.6" },
  { mat: "Каракульча", lot: null, grade: "Шкура каракульча серебро красная вышивка", qty: 1, price: 10250, notes: "УПД №177, п.7" },
  { mat: "Каракульча", lot: "763543", grade: "Шкура каракульча, черный, серебро 763543", qty: 2, price: 8175, notes: "УПД №177: п.12 чёрный серебро 763543 ×1 по 8 100; п.13 чёрный золото 763543 ×1 по 8 250 (в ведомости бухгалтерии одной строкой, 2 шт., 16 350 ₽)" },
  { mat: "Норка", lot: null, grade: "Шкура норка \"50\" шанель коричневый", qty: 1, price: 11800, notes: "УПД №177, п.14" },
  { mat: "Норка", lot: "424496", grade: "Шкура норка F2 черное серебро 424496", qty: 1, price: 5450, notes: "УПД №177, п.5" },
  { mat: "Норка", lot: "133930", grade: "Шкура норка коричневая \"30\" h10 133930", qty: 1, price: 9000, notes: "УПД №177, п.8" },
  { mat: "Норка", lot: "173583", grade: "Шкура норка кофе \"0\" h7 173583", qty: 1, price: 7550, notes: "УПД №177, п.9" },
  { mat: "Норка", lot: "122319", grade: "Шкура норка синий стриженный 122319 \"20\"", qty: 2, price: 8500, notes: "УПД №177, п.18" },
  { mat: "Рысевидная кошка", lot: null, grade: "Шкура рысевидная кошка", qty: 1, price: 8000, notes: "УПД №177, п.11" },
  { mat: "Свакара", lot: "239221", grade: "Шкура свакара золото 239221", qty: 1, price: 15600, notes: "УПД №177, п.4" },
  { mat: "Соболь", lot: "15004/09", grade: "Шкура соболь 15004/09", qty: 1, price: 23000, notes: "УПД №177, п.19" },
  { mat: "Фишер", lot: "50085/7", grade: "Шкура фишер де-граде 50085/7", qty: 1, price: 14300, notes: "УПД №177, п.1" },
  { mat: "Шиншилла", lot: "197134", grade: "Шкура шиншилла серебро 197134", qty: 1, price: 10100, notes: "УПД №177, п.3" },
];
// Документы закупки: [файл во вложениях письма 172, название, тип, номер, mime]
const DOCS_LIST: [string, string, "UPD" | "PAYMENT_INVOICE" | "SPECIFICATION", string, string][] = [
  ["7_УПД", "УПД № 177 от 8 июня 2026 г.pdf", "UPD", "177", "application/pdf"],
  ["3_УПД", "УПД № 177 от 8 июня 2026 г.xlsx", "UPD", "177", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["5_Счет на оплату № 177 от 08 июня 2026 г.pdf", "Счет на оплату № 177 от 08 июня 2026 г.pdf", "PAYMENT_INVOICE", "177", "application/pdf"],
  ["2_Спецификация 15.pdf", "Спецификация № 15 от 05.06.2026.pdf", "SPECIFICATION", "15", "application/pdf"],
  ["4_ПРИЛОЖЕНИЕ 15", "Приложение 15 (спецификация).docx", "SPECIFICATION", "15", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
];

const uploadRoot = () => resolve(process.env.UPLOAD_DIR || join(__dirname, "..", "uploads"));

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:wellmekh-samples");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { purchaseId: string; lots: string[]; materials: string[]; invoiceId: string | null; files: string[] };
    console.log(`${APPLY ? "" : "пробный "}откат: закупка ${j.purchaseId}, лотов ${j.lots.length}, материалов ${j.materials.length}, файлов ${j.files.length}`);
    if (!APPLY) return;
    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { OR: [{ purchaseId: j.purchaseId }, { lotId: { in: j.lots } }] } });
      await tx.purchaseItem.deleteMany({ where: { purchaseId: j.purchaseId } });
      await tx.rawMaterialLot.deleteMany({ where: { id: { in: j.lots } } });
      await tx.purchase.delete({ where: { id: j.purchaseId } }); // DriveDocument — каскадом
      if (j.invoiceId) await tx.invoice.deleteMany({ where: { id: j.invoiceId, purchases: { none: {} } } });
      await tx.rawMaterial.deleteMany({ where: { id: { in: j.materials }, lots: { none: {} }, purchaseItems: { none: {} } } });
    });
    for (const f of j.files) { try { unlinkSync(join(uploadRoot(), f)); } catch { /* уже нет */ } }
    return console.log("откат выполнен");
  }

  const org = await prisma.organization.findFirstOrThrow();
  const suppliers = await prisma.supplier.findMany({ where: { organizationId: org.id, inn: "9729114877" } });
  if (suppliers.length !== 1) throw new Error(`поставщик Веллмех: найдено ${suppliers.length}`);
  const supplier = suppliers[0];
  const wh = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: org.id, isDefault: true } });
  const dup = await prisma.purchase.findFirst({ where: { organizationId: org.id, supplierId: supplier.id, invoiceNumber: "177" } });
  if (dup) throw new Error(`закупка со счётом 177 уже есть: ${dup.number}`);

  let qty = 0, sum = 0;
  for (const r of ROWS) { qty += r.qty; sum += r.qty * r.price; console.log(`${r.mat} | ${r.lot ?? "—"} | ${r.grade} | ${r.qty} × ${r.price}`); }
  console.log(`лотов ${ROWS.length}, ${qty} шт., ${sum} ₽ без НДС, ${Math.round(sum * 1.22 * 100) / 100} ₽ с НДС (ожидается 22 шт., 217350 / 265167)`);
  if (qty !== 22 || sum !== 217350) throw new Error("итоги не сходятся с УПД");
  const mats = await prisma.rawMaterial.findMany({ where: { organizationId: org.id } });
  console.log("новые материалы:", [...new Set(ROWS.map((r) => r.mat))].filter((n) => !mats.some((m) => m.name === n)).join(", ") || "нет");
  if (DOCS) for (const d of DOCS_LIST) if (!existsSync(join(DOCS, d[0]))) throw new Error("нет файла " + d[0]);
  if (!APPLY) return console.log("пробный прогон: ничего не записано (добавьте --apply)");
  if (!DOCS) throw new Error("для --apply нужен --docs=<каталог вложений>");

  if (!NO_BACKUP) execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const { nextDocumentNumber } = await import("../src/lib/numbering");
  const { receivePurchaseInTx } = await import("../src/lib/purchase-receive");
  const { syncPurchaseInvoice } = await import("../src/lib/invoice-sync");
  const createdMats: string[] = [], files: string[] = [];
  let purchaseId = "", invoiceId: string | null = null, lots: string[] = [];
  const invBefore = await prisma.invoice.findFirst({ where: { organizationId: org.id, supplierId: supplier.id, number: "177" } });
  try {
    await prisma.$transaction(async (tx) => {
      const matId = new Map<string, string>();
      for (const name of new Set(ROWS.map((r) => r.mat))) {
        let m = await tx.rawMaterial.findFirst({ where: { organizationId: org.id, name } });
        if (!m) { m = await tx.rawMaterial.create({ data: { organizationId: org.id, name, unit: "PIECE" } }); createdMats.push(m.id); }
        matId.set(name, m.id);
      }
      const p = await tx.purchase.create({
        data: {
          organizationId: org.id, number: await nextDocumentNumber(tx, "purchase", org.id, "З"), supplierId: supplier.id, warehouseId: wh.id,
          currency: "RUB", exchangeRate: 1, invoiceNumber: "177", invoiceDate: DATE, transferDocument: "№ 177 от 08.06.2026 г.",
          orderDate: DATE, listLabel: "образцы, УПД №177",
          notes: "Образцы меха от Веллмех: УПД №177 и счёт №177 от 08.06.2026, спецификация №15 от 05.06.2026 к договору №2502 от 26.02.2025 (письмо №172 от 19.06.2026). 22 шт., 217 350 ₽ без НДС 22 % (265 167 ₽ с НДС). Счёт не оплачен. Заведено по ведомости бухгалтерии (сч. 10.01): 16 строк вместо 19 строк УПД.",
        },
      });
      purchaseId = p.id;
      for (const r of ROWS) {
        await tx.purchaseItem.create({ data: { purchaseId: p.id, rawMaterialId: matId.get(r.mat)!, quantity: r.qty, unitPrice: r.price, subtotal: r.qty * r.price, vatRate: VAT, lotNumber: r.lot, grade: r.grade, notes: r.notes } });
      }
      await syncPurchaseInvoice(tx, p.id, { setDate: true });
      await receivePurchaseInTx(tx, p.id, org.id);
      await tx.purchase.update({ where: { id: p.id }, data: { receivedDate: DATE } });
      await tx.rawMaterialLot.updateMany({ where: { purchaseId: p.id }, data: { receivedDate: DATE } });
      lots = (await tx.rawMaterialLot.findMany({ where: { purchaseId: p.id }, select: { id: true } })).map((l) => l.id);
      invoiceId = (await tx.purchase.findUniqueOrThrow({ where: { id: p.id }, select: { invoiceId: true } })).invoiceId;
      // Оригиналы документов в хранилище приложения (UPLOAD_DIR/drive-docs/<орг>/<uuid>.<ext>)
      const dirRel = join("drive-docs", org.id);
      mkdirSync(join(uploadRoot(), dirRel), { recursive: true });
      for (const [src, title, docType, docNumber, mime] of DOCS_LIST) {
        const ext = title.split(".").pop()!;
        const rel = join(dirRel, `${randomUUID()}.${ext}`);
        copyFileSync(join(DOCS, src), join(uploadRoot(), rel)); files.push(rel);
        const size = readFileSync(join(uploadRoot(), rel)).length;
        await tx.driveDocument.create({
          data: {
            organizationId: org.id, purchaseId: p.id, driveFileId: `local-${randomUUID()}`, title, docType, docNumber, docDate: docType === "SPECIFICATION" ? new Date("2026-06-05T00:00:00Z") : DATE,
            year: 2026, mimeType: mime, sizeBytes: size, storagePath: rel, storedName: title, storedMime: mime, storedSize: size, storedAt: new Date(),
            notes: "Вложение письма №172 от 19.06.2026 (Веллмех)",
          },
        });
      }
    }, { timeout: 60_000 });
  } catch (e) {
    for (const f of files) { try { unlinkSync(join(uploadRoot(), f)); } catch { /* */ } }
    throw e;
  }
  writeFileSync(JOURNAL, JSON.stringify({ purchaseId, lots, materials: createdMats, invoiceId: invBefore ? null : invoiceId, files }, null, 1));
  console.log(`создано: закупка ${purchaseId}, лотов ${lots.length}, новых материалов ${createdMats.length}, файлов ${files.length}; журнал ${JOURNAL}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
