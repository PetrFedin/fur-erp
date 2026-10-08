/**
 * Проверка мастера «Новая партия закупки» (src/app/(app)/purchases/batch) на КОПИИ БД: настоящие серверные действия
 * (parseIntakeFile, recognizeDocuments, previewBatch, createBatch) вызываются напрямую; next/cache и @/lib/session заменены
 * заглушками (scripts/stubs). Боевую базу скрипт не трогает и отказывается работать без «batch_test» в адресе.
 *
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'CREATE DATABASE fur_erp_batch_test'
 *   docker exec fur-erp-db-1 pg_dump -U fur_erp --no-owner fur_erp | docker exec -i fur-erp-db-1 psql -q -U fur_erp -d fur_erp_batch_test
 *   BATCH_TEST_URL=postgresql://fur_erp:<пароль>@localhost:5436/fur_erp_batch_test \
 *     node --env-file=.env node_modules/.bin/tsx scripts/test-batch-intake.ts
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'DROP DATABASE fur_erp_batch_test'
 *
 * Часть A (чистая логика) идёт без БД. Часть B: создание партии из тестового файла, итоги = Σ, сверка с документом,
 * защита от двойной отправки, дубль лота, откат при сбое внутри транзакции, права и изоляция организаций.
 */
import Module from "module";
import { join } from "path";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";

const url = process.env.BATCH_TEST_URL ?? "";
const uploadDir = mkdtempSync(join(tmpdir(), "batch-test-uploads-"));
process.env.UPLOAD_DIR = uploadDir;
if (url) process.env.DATABASE_URL = url;

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
const stub = (n: string) => join(__dirname, "stubs", n);
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return stub("empty.js");
  if (req === "next/cache") return stub("next-cache.js");
  if (req === "next/navigation") return stub("next-navigation.js");
  if (req === "@/lib/session") return stub("session-stub.js");
  return orig.call(this, req, ...rest);
};

type G = { __TEST_SESSION?: unknown };
let testUserId = ""; // настоящий пользователь базы: createdById — внешний ключ
const as = (role: string, organizationId: string) => {
  (globalThis as G).__TEST_SESSION = { user: { id: testUserId || "u-test", role, organizationId, name: "Тест" } };
};
let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) fails++;
};
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const filesCount = () => {
  const walk = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? walk(join(d, e.name)) : 1), 0);
  return walk(uploadDir);
};

async function partA() {
  const B = await import("../src/lib/batch-intake");
  console.log("A1. Столбцы расчётного листа (раскладка файла «расчет закупки СП 09-26»)");
  const table = [
    ["", "СОЮЗПУШНИНА 09-26 (предварительный расчет)"],
    ["invoice", "fur", "size / description", "lot", "quantity", "operation ", "Куда", "Закупка $", "bayer", "аукционный сбор", "НДС на услуги СП", "", "курс", "выделка руб", "Транспорт на выделку и обратно", "Брокерский %", "комиссия за транзит денег", "НДС 22%", "Себестоимость \r\nза единицу руб ", "Себестоимость общая руб"],
    ["3017", "Sable wild raw Barguzinsky", "XXI 2 - 2 1 -", "4", "30", "тонировка", "", "360", "ММ", "2233.42", "491.35", "", "84.4075", "1159", "20", "1367.40", "", "6685.07", "42342.95", "1270288.53"],
    ["3017", "Sable wild raw Barguzinsky", "XXI 2 - 2 2 -", "5", "40", "тонировка", "", "370", "ММ", "2295.46", "505.00", "", "84.4075", "1159", "20", "1405.38", "", "6870.77", "43486.39", "1739455.76"],
    ["Итого", "", "", "", "70", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "3009744.29"],
  ];
  const det = B.detectColumns(table);
  const m = det.mapping;
  ok(det.headerIdx === 1, "строка шапки найдена (2-я)");
  ok(m.invoice === 0 && m.material === 1 && m.grade === 2 && m.lot === 3 && m.qty === 4 && m.color === 5 && m.price === 7, "счёт, мех, размер, лот, кол-во, цвет(operation), цена распознаны");
  ok(m.vat === undefined, "«НДС 22%» с суммами не принят за ставку");
  ok(m.rate === 12 && m.dressing === 13 && m.transport === 14 && m.broker === 15 && m.fee === 9 && m.fileTotal === 19 && m.fileUnit === 18, "курс, выделка, транспорт, брокерский, сбор, себестоимость распознаны");
  ok(det.currencyHint === "USD", "валюта «$» из шапки");
  const rows = B.applyMapping(table, det.headerIdx, det.mapping);
  ok(rows.length === 2, "строка «Итого» пропущена, строк данных 2");
  ok(rows[0].lot === "4" && rows[0].qty === "30", "значения строк верные");

  console.log("A2. Вставка из Excel");
  const pasted = B.parsePasteTable("Лот\tМех\tЦвет\tРазмер\tКол-во\tЦена\n101\tСоболь\tЧёрный\tXL\t30\t360,5\n");
  const d2 = B.detectColumns(pasted);
  const r2 = B.applyMapping(pasted, d2.headerIdx, d2.mapping);
  ok(r2.length === 1 && r2[0].price === "360,5" && r2[0].material === "Соболь", "вставка с шапкой разобрана");
  const pasted3 = B.parsePasteTable("101\tСоболь\tЧёрный\tXL\t30\t360\tUSD\t22");
  const d3 = B.detectColumns(pasted3);
  const r3 = B.applyMapping(pasted3, d3.headerIdx, d3.mapping);
  ok(d3.headerIdx === -1 && r3[0].qty === "30" && r3[0].currency === "USD" && r3[0].vat === "22", "вставка без шапки — столбцы по порядку");

  console.log("A3. Проверка строк: ошибки и подсказки");
  const ctx = {
    currency: "USD", vatDefault: 22, rate: 80, existingLots: new Map([["77", "З-2026-0001"]]),
    materials: [{ id: "m1", name: "Соболь" }, { id: "m2", name: "Норка" }],
    colors: [{ id: "c1", name: "Серый", aliases: ["grey"], note: null }, { id: "c2", name: "Чёрный", aliases: [], note: null }],
  };
  const mk = (n: number, o: Partial<import("../src/lib/batch-intake").IntakeRow>) => ({ n, ...B.EMPTY_ROW, ...o });
  const v = B.validateRows(
    [
      mk(1, { lot: "1", material: "Соболь", color: "Черный", qty: "10", price: "100" }),
      mk(2, { lot: "1", material: "Sable", color: "Серый светлый", qty: "", price: "5" }),
      mk(3, { lot: "77", material: "Горностай", color: "", qty: "3", price: "abc" }),
      mk(4, { lot: "4", material: "Норка", qty: "2", price: "1", currency: "EUR" }),
    ],
    ctx,
    { fur: {}, color: {} },
  );
  const c = v.checks;
  ok(c[0].errors.length === 0 && c[0].colorRefId === "c2", "«Черный» (ё=е) найден в справочнике цветов");
  ok(c[1].errors.some((e) => e.includes("повторяется")), "дубль лота в файле — ошибка");
  ok(c[1].errors.some((e) => e.includes("количество")), "пустое количество — ошибка");
  ok(c[1].materialId === "m1", "«Sable» распознан как Соболь по справочнику меха");
  ok(c[2].errors.some((e) => e.includes("уже заведён")), "лот уже есть в аукционе — ошибка");
  ok(c[2].errors.some((e) => e.includes("Горностай")) && v.unknownFurs.length === 1, "неизвестный мех — ошибка и в списке решений");
  ok(c[2].errors.some((e) => e.includes("цена")), "цена не число — ошибка");
  ok(c[3].errors.some((e) => e.includes("валюта строки")), "чужая валюта строки — ошибка");
  ok(v.unknownColors.length === 1 && v.unknownColors[0].text === "Серый светлый", "неизвестный цвет — в списке решений");
  const sugg = v.unknownColors[0].suggestion;
  ok(sugg?.name === "Серый", "подсказка из справочника: Серый");
  const v2 = B.validateRows([mk(1, { lot: "9", material: "Горностай", color: "Сизый", qty: "1", price: "1" })], ctx, { fur: { горностай: { mode: "add" } }, color: { сизый: { mode: "add" } } });
  ok(v2.errorCount === 0 && v2.checks[0].newMaterial === "Горностай" && v2.checks[0].newColor === "Сизый", "решения «добавить» снимают ошибки");

  console.log("A4. Документы: тип, номер, сумма, сверка");
  const n1 = B.recognizeFromName("Счет на оплату №271 от 30.09.2026.pdf");
  ok(n1.kind === "ADVANCE_INVOICE" && n1.number === "271" && n1.date === "2026-09-30", "имя: счёт на оплату №271 от 30.09.2026");
  const n2 = B.recognizeFromName("УПД 143 от 22.09.2026.pdf");
  ok(n2.kind === "UPD" && n2.number === "143", "имя: УПД 143");
  const t1 = B.recognizeFromText("Счет на оплату № 271 от 30 сентября 2026 г.\nИтого: 60 831 100,00\nВ том числе НДС 22%: 10 969 542,62\nВсего к оплате: 60 831 100,00");
  ok(t1.kind === "ADVANCE_INVOICE" && t1.number === "271" && t1.date === "2026-09-30" && t1.amount === 60831100, "текст: счёт №271, дата, «Всего к оплате» 60 831 100");
  const rec = (docAmount: number, kind?: import("../src/lib/batch-intake").DocKindKey) =>
    B.reconcileAmount(docAmount, { inclVat: 234240, exclVat: 192000, currency: "USD", rate: 80, foreignExcl: 2400, vatRates: [22] }, 50, kind);
  ok(rec(234240).ok && rec(234280).ok && !rec(234300).ok, "допуск 50 ₽: 234 280 — ок, 234 300 — расхождение");
  ok(rec(234240 * 1.04).reasons[0].startsWith("4%"), "расхождение +4% объяснено");
  ok(rec(192000).reasons[0].startsWith("НДС"), "сумма без НДС объяснена");
  ok(rec(192000 * 1.2).reasons[0].startsWith("НДС: в документе, похоже, ставка 20%"), "иная ставка НДС объяснена");
  ok(rec(234240 * 1.02).reasons[0].startsWith("Курс"), "расхождение по курсу объяснено");
  ok(rec(2400).reasons[0].startsWith("Валюта"), "сумма в валюте объяснена");
  ok(rec(999999).reasons[0].startsWith("Причина неясна"), "неясное расхождение — честное сообщение");
}

async function partB() {
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient({ datasources: { db: { url } } });
  const B = await import("../src/lib/batch-intake");
  const A = await import("../src/app/(app)/purchases/batch/actions");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const JSZip = (await import("jszip")).default;

  const org = await raw.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const org2 = await raw.organization.create({ data: { name: "BATCH-TEST-ORG2", slug: "batch-test-org2-" + Date.now() } });
  const sup = await raw.supplier.findFirstOrThrow({ where: { organizationId: org.id, isActive: true } });
  const wh = await raw.warehouse.findFirstOrThrow({ where: { organizationId: org.id } });
  const sup2 = await raw.supplier.create({ data: { organizationId: org2.id, name: "Чужой" } });
  testUserId = (await raw.user.findFirstOrThrow({ where: { organizationId: org.id, role: "OWNER" } })).id;
  as("OWNER", org.id);

  // --- файл: CSV → parseIntakeFile
  const csv = [
    "Лот;Мех;Цвет;Размер;Кол-во;Цена, $",
    "T1;Соболь;Чёрный;XL;10;100",
    "T2;Норка;Серый;L;20;50",
    "T3;Соболь;Сизый тестовый;M;5;80",
    "T4;Горностай тестовый;;S;2;10",
  ].join("\n");
  const fd0 = new FormData();
  fd0.set("file", new File([csv], "лоты.csv", { type: "text/csv" }));
  const parsed = await A.parseIntakeFile(fd0);
  ok("ok" in parsed && parsed.table.length === 5, "parseIntakeFile: CSV прочитан (5 строк с шапкой)");
  if (!("ok" in parsed)) return;
  const det = B.detectColumns(parsed.table);
  const rows = B.applyMapping(parsed.table, det.headerIdx, det.mapping);
  ok(rows.length === 4 && det.currencyHint === "USD", "столбцы распознаны, валюта USD из шапки");
  const bad = new FormData();
  bad.set("file", new File(["x"], "a.pdf"));
  ok("error" in (await A.parseIntakeFile(bad)), "неподходящий формат файла — понятная ошибка");

  const header: import("../src/lib/batch-intake").BatchHeader = {
    auctionId: "", newAuction: { name: "ТЕСТ 99.26", date: "2026-10-01", house: "Тест" }, supplierId: sup.id, warehouseId: wh.id,
    orderDate: "2026-10-08", currency: "USD", exchangeRate: "80", vatDefault: "22", invoiceNumber: "9001", receiveNow: true, notes: "",
  };
  const decisions: import("../src/lib/batch-intake").Decisions = { fur: { "горностай тестовый": { mode: "add" } }, color: { "сизый тестовый": { mode: "add" } } };
  const expected = (10 * 100 + 20 * 50 + 5 * 80 + 2 * 10) * 80 * 1.22; // 236 192
  const expectedQty = 37;

  // --- документ: docx «Счёт на оплату» на сумму лотов
  const mkDocx = async (amount: string) => {
    const z = new JSZip();
    z.file("[Content_Types].xml", "<Types/>");
    z.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>Счет на оплату № 9001 от 08.10.2026</w:t></w:r></w:p><w:p><w:r><w:t>Всего к оплате: ${amount}</w:t></w:r></w:p></w:body></w:document>`);
    return new File([(await z.generateAsync({ type: "uint8array" })) as BlobPart], "Счет на оплату 9001.docx");
  };
  const fmtRu = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fdDoc = new FormData();
  fdDoc.append("files", await mkDocx(fmtRu(expected)));
  const rd = await A.recognizeDocuments(fdDoc);
  ok("ok" in rd && rd.docs[0].kind === "ADVANCE_INVOICE" && rd.docs[0].number === "9001" && rd.docs[0].textRead, "recognizeDocuments: счёт №9001, текст прочитан");
  const amountStr = "ok" in rd ? rd.docs[0].amount : "";
  ok(near(Number(amountStr.replace(/\s/g, "").replace(",", ".")), expected), `сумма из текста документа = ${fmtRu(expected)}`);

  const payload = (key: string, over: Partial<import("../src/lib/batch-intake").BatchPayload> = {}) => ({
    key, header, rows, decisions, pct: {}, ackMismatch: false,
    docs: [{ idx: 0, name: "Счет на оплату 9001.docx", kind: "ADVANCE_INVOICE" as const, number: "9001", date: "2026-10-08", amount: amountStr }], ...over,
  });

  console.log("B1. Предпросмотр: итоги = Σ, сверка с документом");
  const pv = await A.previewBatch(JSON.stringify(payload("preview-only")));
  ok("ok" in pv, "previewBatch отвечает");
  if (!("ok" in pv)) return;
  const p = pv.preview;
  ok(p.blocking.length === 0, "блокирующих причин нет: " + p.blocking.join("; "));
  ok(near(p.totals.inclVat, expected) && p.totals.qty === expectedQty && p.totals.lots === 4, `итоги: лотов 4, шт. ${expectedQty}, с НДС ${fmtRu(expected)}`);
  ok(near(p.totals.exclVat, expected / 1.22), "сумма без НДС = с НДС / 1,22");
  ok(near(p.totals.avgInclPerUnit, expected / expectedQty, 0.01) && p.totals.avgForeign !== null && near(p.totals.avgForeign, 2420 / expectedQty, 0.01), "средние цены ₽ и $ за шкуру");
  ok(p.docs[0].recon?.ok === true, "сумма документа сходится с лотами");
  const pvBad = await A.previewBatch(JSON.stringify(payload("preview-only", { docs: [{ idx: 0, name: "x.docx", kind: "ADVANCE_INVOICE", number: "9001", date: "", amount: fmtRu(expected * 1.04) }] })));
  ok("ok" in pvBad && pvBad.preview.docs[0].recon?.ok === false && pvBad.preview.docs[0].recon!.reasons[0].startsWith("4%") && pvBad.preview.mismatchDocs === 1, "документ +4% — расхождение с причиной «4%»");

  // --- состояние ДО
  const cnt = async () => ({
    purchases: await raw.purchase.count(), items: await raw.purchaseItem.count(), lots: await raw.rawMaterialLot.count(), moves: await raw.stockMovement.count(),
    docs: await raw.purchaseDocument.count(), auctions: await raw.auction.count(), materials: await raw.rawMaterial.count(), colors: await raw.colorRef.count(),
    audit: await raw.auditLog.count({ where: { model: "BatchIntake" } }),
  });
  const before = await cnt();
  const debtBefore = Number((await loadSupplierDebt(raw, org.id)).debt);
  const sobol = await raw.rawMaterial.findFirstOrThrow({ where: { organizationId: org.id, name: "Соболь" } });
  const stockOf = async (id: string) => Number((await raw.rawMaterialLot.aggregate({ where: { rawMaterialId: id }, _sum: { quantityRemaining: true } }))._sum.quantityRemaining ?? 0);
  const sobolBefore = await stockOf(sobol.id);

  console.log("B2. Откат: сбой внутри транзакции (триггер в scratch-базе)");
  await raw.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION batch_test_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'batch-test: сбой'; END; $$ LANGUAGE plpgsql`);
  await raw.$executeRawUnsafe(`CREATE TRIGGER batch_test_fail_trg BEFORE INSERT ON "PurchaseDocument" FOR EACH ROW EXECUTE FUNCTION batch_test_fail()`);
  const filesBefore = filesCount();
  const fdFail = new FormData();
  fdFail.set("payload", JSON.stringify(payload("batch-fail-0001")));
  fdFail.append("files", await mkDocx(fmtRu(expected)));
  const rf = await A.createBatch(fdFail);
  ok("error" in rf, "createBatch при сбое возвращает ошибку");
  const afterFail = await cnt();
  ok(JSON.stringify(afterFail) === JSON.stringify(before), "ничего не создано: закупки, позиции, лоты, движения, аукцион, материал, цвет, журнал — как были");
  ok(filesCount() === filesBefore, "файл документа с диска убран");
  await raw.$executeRawUnsafe(`DROP TRIGGER batch_test_fail_trg ON "PurchaseDocument"`);
  await raw.$executeRawUnsafe(`DROP FUNCTION batch_test_fail()`);

  console.log("B3. Создание партии из тестового файла");
  const fd1 = new FormData();
  fd1.set("payload", JSON.stringify(payload("batch-test-0001")));
  fd1.append("files", await mkDocx(fmtRu(expected)));
  const r1 = await A.createBatch(fd1);
  ok(!("error" in r1), "createBatch прошёл" + ("error" in r1 ? ": " + r1.error : ""));
  if ("error" in r1) return;
  const after = await cnt();
  ok(after.purchases === before.purchases + 1 && after.items === before.items + 4 && after.lots === before.lots + 4 && after.moves === before.moves + 4, "+1 закупка, +4 позиции, +4 лота, +4 движения склада");
  ok(after.auctions === before.auctions + 1 && after.materials === before.materials + 1 && after.colors === before.colors + 1 && after.docs === before.docs + 1, "+1 аукцион, +1 материал, +1 цвет, +1 документ");
  ok(after.audit === before.audit + 1, "запись «Новая партия» в журнале");
  const pur = await raw.purchase.findFirstOrThrow({ where: { id: r1.purchases[0].id }, include: { items: true, rawMaterialLots: true, documents: true, auction: true } });
  ok(pur.status === "RECEIVED" && pur.invoiceNumber === "9001" && pur.auction?.name === "ТЕСТ 99.26" && pur.auctionSession === "ТЕСТ 99.26", "закупка принята, счёт 9001, аукцион привязан");
  const lotSum = pur.rawMaterialLots.reduce((s, l) => s + Number(l.totalCost), 0);
  ok(near(lotSum, expected, 0.05), `Σ себестоимости лотов (${fmtRu(lotSum)}) = сумма закупки ${fmtRu(expected)}`);
  ok(near(r1.totals.inclVat, expected) && near(r1.purchases[0].inclVat, expected), "итог в ответе = Σ");
  ok(pur.documents.length === 1 && pur.documents[0].kind === "ADVANCE_INVOICE" && pur.documents[0].title.includes("9001"), "документ привязан к закупке (тип и номер)");
  ok(near(r1.debt.after - (r1.debt.before ?? 0), expected, 0.05), "долг поставщику вырос ровно на сумму закупки");
  const debtAfter = Number((await loadSupplierDebt(raw, org.id)).debt);
  ok(near(debtAfter - debtBefore, expected, 0.05), "долг по независимому расчёту: +" + fmtRu(debtAfter - debtBefore));
  const sobolAfter = await stockOf(sobol.id);
  ok(near(sobolAfter - sobolBefore, 15), "остаток Соболя вырос на 15 шт.");
  ok(r1.stock.some((s) => s.material === "Соболь" && near(s.after - s.before, 15)), "в итоге «что пересчиталось» остаток Соболя до → после верный");
  ok(r1.createdMaterials.length === 1 && r1.createdColors.length === 1, "новые материал и цвет перечислены");
  const newColor = await raw.colorRef.findFirstOrThrow({ where: { organizationId: org.id, name: "Сизый тестовый" } });
  ok((newColor.note ?? "").startsWith("Предложено"), "новый цвет ждёт подтверждения владельцем");
  ok(r1.tasks.some((t) => t.kind === "doc") && r1.tasks.some((t) => t.kind === "pay"), "задачи: загрузить недостающие документы и внести оплату");

  console.log("B4. Двойная отправка");
  const fd1b = new FormData();
  fd1b.set("payload", JSON.stringify(payload("batch-test-0001")));
  fd1b.append("files", await mkDocx(fmtRu(expected)));
  const r1b = await A.createBatch(fd1b);
  ok(!("error" in r1b) && r1b.duplicate === true, "повтор с тем же ключом → «уже создано»");
  const concurrent = await Promise.all([1, 2].map(async () => { const f = new FormData(); f.set("payload", JSON.stringify(payload("batch-test-0002", { header: { ...header, newAuction: null, auctionId: pur.auctionId! }, rows: rows.map((r) => ({ ...r, lot: r.lot + "x" })), docs: [], decisions }))); return A.createBatch(f); }));
  // «Сизый тестовый» после B3 ждёт подтверждения владельцем и в справочнике «не числится» — мастер просит решение снова, повторное «добавить» берёт ту же запись.
  const created2 = concurrent.filter((r) => !("error" in r) && !r.duplicate).length;
  ok(created2 === 1, "две одновременные отправки с одним ключом создали ровно одну партию (создано: " + created2 + ")");
  const after2 = await cnt();
  ok(after2.purchases === after.purchases + 1, "закупок стало на одну больше, не на две");

  console.log("B5. Дубль лота в аукционе и права");
  const dup = await A.previewBatch(JSON.stringify(payload("preview-only", { header: { ...header, newAuction: null, auctionId: pur.auctionId! }, docs: [], decisions: { fur: {}, color: {} } })));
  ok("ok" in dup && dup.preview.validation.checks.some((c) => c.errors.some((e) => e.includes("уже заведён"))) && dup.preview.blocking.length > 0, "лоты T1…T4 уже есть в аукционе — ошибка дубля, создание заблокировано");
  const fdForeign = new FormData();
  fdForeign.set("payload", JSON.stringify(payload("batch-test-0003", { header: { ...header, supplierId: sup2.id }, docs: [] })));
  const rForeign = await A.createBatch(fdForeign);
  ok("error" in rForeign || ("ok" in rForeign && false), "поставщик чужой организации отклонён");
  as("WAREHOUSE", org.id);
  let denied = false;
  try { await A.previewBatch(JSON.stringify(payload("preview-only"))); } catch { denied = true; }
  ok(denied, "роль без прав на закупки (склад) отклонена");
  as("PURCHASER", org.id);
  const fdP = new FormData();
  fdP.set("payload", JSON.stringify(payload("batch-test-0004", { docs: [], header: { ...header, newAuction: { name: "ТЕСТ 98.26", date: "", house: "" } }, rows: rows.map((r) => ({ ...r, lot: r.lot + "p" })) })));
  const rP = await A.createBatch(fdP);
  ok(!("error" in rP), "закупщик может завести партию" + ("error" in rP ? ": " + rP.error : ""));
  as("OWNER", org.id);

  await raw.organization.delete({ where: { id: org2.id } }).catch(() => {});
  await raw.$disconnect();
}

async function main() {
  console.log("=== Часть A: чистая логика ===");
  await partA();
  if (!url.includes("batch_test")) {
    console.log("\nЧасть B пропущена: задайте BATCH_TEST_URL на scratch-базу (имя содержит batch_test).");
  } else {
    console.log("\n=== Часть B: серверные действия на копии БД ===");
    await partB();
  }
  rmSync(uploadDir, { recursive: true, force: true });
  console.log(fails === 0 ? "\nВСЁ ЗЕЛЁНОЕ" : `\nПРОВАЛОВ: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
