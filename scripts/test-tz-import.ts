/**
 * Проверка мастера «Загрузить ТЗ» на КОПИИ БД (настоящие серверные действия; next/cache и @/lib/session — заглушки scripts/stubs).
 * Боевую базу не трогает и отказывается работать, если в адресе нет «wiz_test».
 *
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'CREATE DATABASE fur_erp_wiz_test'
 *   docker exec fur-erp-db-1 pg_dump -U fur_erp --no-owner fur_erp | docker exec -i fur-erp-db-1 psql -q -U fur_erp -d fur_erp_wiz_test
 *   WIZ_TEST_URL=postgresql://fur_erp:<пароль>@localhost:5436/fur_erp_wiz_test \
 *     node --env-file=.env node_modules/.bin/tsx scripts/test-tz-import.ts
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'DROP DATABASE fur_erp_wiz_test'
 */
import Module from "module";
import { join } from "path";
import JSZip from "jszip";

const url = process.env.WIZ_TEST_URL ?? "";
if (!url.includes("wiz_test")) {
  console.error("Задайте WIZ_TEST_URL на scratch-базу (имя содержит wiz_test).");
  process.exit(2);
}
process.env.DATABASE_URL = url;
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
const as = (role: string, organizationId: string, id = "u-test") => {
  (globalThis as G).__TEST_SESSION = { user: { id, role, organizationId, name: "Тест" } };
};
let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) fails++;
};

const sheet = (rows: string[][]) =>
  `<?xml version="1.0"?><worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${c}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
async function xlsx(rows: string[][]): Promise<Buffer> {
  const z = new JSZip();
  z.file("[Content_Types].xml", "<Types/>");
  z.file("xl/workbook.xml", "<workbook/>");
  z.file("xl/worksheets/sheet1.xml", sheet(rows));
  return z.generateAsync({ type: "nodebuffer" });
}
async function docx(paragraphs: string[]): Promise<Buffer> {
  const z = new JSZip();
  z.file("[Content_Types].xml", "<Types/>");
  z.file("word/document.xml", `<w:document><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return z.generateAsync({ type: "nodebuffer" });
}
const pdf = (lines: string[]) => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length 0 >>\nstream\nBT\n${lines.map((l) => `(${l}) Tj`).join("\nT*\n")}\nET\nendstream\nendobj\n%%EOF`, "latin1");
const file = (name: string, buf: Buffer) => new File([new Uint8Array(buf)], name);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient({ datasources: { db: { url } } });
  const A = await import("../src/app/(app)/production/import-actions");
  const core = await import("../src/lib/tz-import-core");

  // ---- чистый разбор
  const t1 = core.draftsFromTable([["№ ТЗ", "Артикул", "Цвет", "Размеры", "Лот", "Расход"], ["900", "A1", "Чёрный", "44×2, 46×3", "111", "1,5"], ["", "", "", "", "222", "2 4%"], ["901", "B2", "Синий", "", "333", "1"]], "t");
  ok(t1.length === 2 && t1[0].materials.split("\n").length === 2 && t1[1].number === "901", "таблица: 2 ТЗ, лоты продолжают предыдущее ТЗ");
  ok(core.draftQty(t1[0]) === 5, "количество по размерам 44×2, 46×3 = 5");
  const t2 = core.draftsFromText("ТЗ № 77\nАртикул: M012\nЦвет: Чёрный ×2 (42, 46); Серый ×1 (44)\nПартия: 7\nЗаказчик: ООО Ромашка\nЦена работы: 1 500\nЛот 300687 — 12,5\nЛот 300688 — 3 без 4%\nТЗ № 78\nАртикул: M013\nКол-во: 4", "doc");
  ok(t2.length === 2 && t2[0].number === "77" && t2[0].batch === "7" && t2[0].price === "1 500", "текст: 2 ТЗ, поля распознаны");
  ok(core.parseMaterialLines(t2[0].materials).lines.length === 2 && core.parseMaterialLines(t2[0].materials).lines[1].c4 === false, "флаг «без 4%» читается");
  ok(core.parseColors(t2[0].colors).length === 2, "составной цвет разобран");
  ok(core.duplicateNumbers([{ key: "a", number: "5" }, { key: "b", number: "5" }]).size === 1, "повтор № внутри загрузки найден");

  const org = (await raw.organization.findFirstOrThrow()).id;
  const user = await raw.user.findFirstOrThrow({ where: { organizationId: org, role: "OWNER" } });
  as("OWNER", org, user.id);

  // ---- файлы
  const fx = new FormData();
  fx.append("files", file("tz.xlsx", await xlsx([["№ ТЗ", "Артикул", "Лот", "Расход"], ["X1", "ZZZ", "1", "1"]])));
  fx.append("files", file("tz.docx", await docx(["ТЗ № D1", "Артикул: DDD", "Кол-во: 3"])));
  fx.append("files", file("tz.pdf", pdf(["TZ N D2", "Artikul: PPP"])));
  const pr = await A.parseTzInput(fx);
  ok(!pr.error && (pr.drafts?.length ?? 0) >= 2, `xlsx+docx разобраны (${pr.drafts?.length}); заметки: ${pr.notes?.join(" | ")}`);
  ok(pr.drafts?.some((d) => d.number === "X1") && pr.drafts?.some((d) => d.number === "D1"), "xlsx и docx дали ТЗ X1 и D1");
  const sc = new FormData();
  sc.append("files", file("scan.pdf", Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF", "latin1")));
  ok(!!(await A.parseTzInput(sc)).error, "PDF без текста — понятная ошибка");
  const bad = new FormData();
  bad.append("files", file("x.exe", Buffer.from("MZ")));
  ok(!!(await A.parseTzInput(bad)).error, "неподдерживаемый формат — ошибка");

  // ---- данные для проверки
  const lots = await raw.rawMaterialLot.findMany({ where: { organizationId: org, lotNumber: { not: null }, quantityRemaining: { gt: 5 } }, take: 40 });
  const uniq = lots.filter((l) => lots.filter((x) => x.lotNumber === l.lotNumber).length === 1);
  const lotA = uniq[0];
  const lotB = uniq[1];
  const article = await raw.productModel.findFirstOrThrow({ where: { organizationId: org } });
  const batch = await raw.productionBatch.findFirstOrThrow({ where: { organizationId: org }, orderBy: { number: "desc" } });
  const color = await raw.colorRef.findFirstOrThrow({ where: { organizationId: org, NOT: { note: { contains: "Предложено" } } } });
  const color2 = await raw.colorRef.findFirstOrThrow({ where: { organizationId: org, id: { not: color.id }, NOT: { note: { contains: "Предложено" } } } });
  const ordersBefore = await raw.productionOrder.count();
  const remA = Number(lotA.quantityRemaining);
  const remB = Number(lotB.quantityRemaining);
  const mk = (o: Partial<import("../src/lib/tz-import-core").TzDraft>) => ({ ...core.emptyDraft("t"), ...o });
  const drafts = [
    mk({ key: "1", number: "WIZ-T1", article: article.name, colors: color.name, sizes: "44×2, 46×1", batch: String(batch.number), price: "1500", materials: `${lotA.lotNumber}\t1,5\n${lotB.lotNumber}\t2 без4` }),
    mk({ key: "2", number: "WIZ-T2", article: article.name, colors: `${color.name} ×1 (42); ${color2.name} ×1`, qty: "2", materials: `${lotA.lotNumber}\t1` }),
  ];

  // ---- проверка: проблемы подсвечиваются
  const probe = [
    mk({ key: "p1", number: "", article: "НЕТ-ТАКОГО-АРТ", colors: "Нет-такого-цвета", qty: "1", materials: "99999999\t1" }),
    mk({ key: "p2", number: "WIZ-DUP", article: article.name, qty: "1" }),
    mk({ key: "p3", number: "WIZ-DUP", article: article.name, qty: "1", materials: `${lotA.lotNumber}\t${remA + 1}` }),
    mk({ key: "p4", number: "WIZ-S", article: article.name, qty: "1", calcTotal: "5", materials: `${lotA.lotNumber}\t1` }),
    mk({ key: "p5", number: "WIZ-C1", article: article.name, qty: "1", materials: `${lotA.lotNumber}\t${remA - 1}` }),
    mk({ key: "p6", number: "WIZ-C2", article: article.name, qty: "1", materials: `${lotA.lotNumber}\t1` }),
  ];
  const chk = await A.checkTzDrafts(probe, { createRefs: false });
  const by = Object.fromEntries((chk.analysis ?? []).map((a) => [a.key, a]));
  const has = (k: string, f: string, lv = "error") => by[k]?.issues.some((i) => i.field === f && i.level === lv);
  ok(has("p1", "number") && has("p1", "article") && has("p1", "colors") && has("p1", "materials"), "ошибки: нет №, неизвестные артикул/цвет, лот не найден");
  ok(has("p3", "number"), "дубль № ТЗ внутри загрузки");
  ok(has("p3", "materials"), "остаток лота меньше нужного");
  ok(has("p4", "sum", "warn") && !by.p4.blocking, "сумма расчёта ≠ сумме списаний — предупреждение");
  ok(has("p6", "materials"), "общий остаток лота считается по всем ТЗ загрузки");
  const exist = await raw.productionOrder.findFirstOrThrow({ where: { organizationId: org, workOrderNumber: { not: null } } });
  const chk2 = await A.checkTzDrafts([mk({ key: "e", number: exist.workOrderNumber!, article: article.name, qty: "1" })], { createRefs: false });
  ok(chk2.analysis?.[0].issues.some((i) => i.field === "number"), "дубль № ТЗ с базой");
  const chk3 = await A.checkTzDrafts([mk({ key: "n", number: "WIZ-NEW", article: "ПРОБНЫЙ-АРТ-WIZ", colors: "Пробный-цвет-wiz", qty: "1" })], { createRefs: true });
  ok(chk3.analysis?.[0].issues.every((i) => i.level === "warn"), "createRefs: неизвестное только предупреждает");

  // ---- создание: ошибка -> ничего не создано
  const fdBad = new FormData();
  fdBad.set("drafts", JSON.stringify([drafts[0], probe[0]]));
  const rBad = await A.createTzBatch(fdBad);
  ok(!!rBad.error && (await raw.productionOrder.count()) === ordersBefore, "есть ошибка -> ничего не создано (всё или ничего)");

  // ---- создание
  const fd = new FormData();
  fd.set("drafts", JSON.stringify(drafts));
  fd.append("files", file("tz.xlsx", await xlsx([["a"]])));
  const r = await A.createTzBatch(fd);
  if (!r.ok && r.analysis) console.log("   разбор:", JSON.stringify(r.analysis.map((a) => [a.key, a.issues.map((i) => `${i.level}:${i.field}:${i.text}`)])));
  ok(!!r.ok && r.orders?.length === 2, `создано 2 ТЗ: ${r.error ?? ""}`);
  const created = await raw.productionOrder.findMany({ where: { workOrderNumber: { in: ["WIZ-T1", "WIZ-T2"] } }, include: { materialUsages: true, colors: true }, orderBy: { workOrderNumber: "asc" } });
  ok(created.length === 2 && created[0].materialUsages.length === 2 && created[0].status === "IN_PROGRESS", "ТЗ 1: два списания, «В работе»");
  ok(Number(created[0].plannedQuantity) === 3 && created[0].batchId === batch.id && String(created[0].clientWorkPricePerUnit) === "1500", "ТЗ 1: количество по размерам, партия, цена работы");
  ok(created[1].colors.length === 2, "ТЗ 2: составной цвет -> 2 строки цветов");
  const lotA2 = await raw.rawMaterialLot.findUniqueOrThrow({ where: { id: lotA.id } });
  const lotB2 = await raw.rawMaterialLot.findUniqueOrThrow({ where: { id: lotB.id } });
  ok(Number(lotA2.quantityRemaining) === remA - 2.5 && Number(lotB2.quantityRemaining) === remB - 2, "остатки лотов уменьшились на списанное");
  ok(r.lots?.find((l) => l.lotNumber === lotA.lotNumber)?.after === remA - 2.5, "экран «что пересчиталось»: лот до/после");
  const sum = created[0].materialUsages.reduce((s, u) => s + Number(u.totalCost), 0);
  ok(Math.abs((r.orders?.find((o) => o.workOrderNumber === "WIZ-T1")?.cost ?? 0) - sum) < 0.01, "себестоимость на экране = сумме списаний (orderStat)");
  ok(created[0].materialUsages.some((u) => u.commission4 === false) && created[0].materialUsages.some((u) => u.commission4 === (batch.number !== 6)), "флаг 4%: «без4» -> false, остальные по умолчанию партии");
  ok(r.batches?.[0].ordersAfter === (r.batches?.[0].ordersBefore ?? 0) + 1, "партия: ТЗ +1");
  const mv = await raw.stockMovement.count({ where: { productionOrderId: { in: created.map((c) => c.id) } } });
  ok(mv === 3, "движения склада записаны (3)");

  // повтор тех же ТЗ -> дубль
  const fd2 = new FormData();
  fd2.set("drafts", JSON.stringify(drafts));
  const r2 = await A.createTzBatch(fd2);
  ok(!!r2.error && (await raw.productionOrder.count()) === ordersBefore + 2, "повторная отправка тех же ТЗ отклонена как дубль");

  // права и организация
  as("ACCOUNTANT", org, user.id);
  let denied = false;
  try { await A.createTzBatch(fd2); } catch { denied = true; }
  ok(denied, "бухгалтер не может загружать ТЗ");
  as("OWNER", "org_other", user.id);
  const iso = await A.checkTzDrafts([drafts[0]], { createRefs: false });
  ok(iso.analysis?.[0].blocking === true && iso.analysis[0].lots.length === 0, "чужая организация не видит артикулы и лоты");

  console.log(fails ? `\nПРОВАЛЕНО проверок: ${fails}` : "\nВсе проверки пройдены");
  await raw.$disconnect();
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
