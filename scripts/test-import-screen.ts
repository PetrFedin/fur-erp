// Экран «Загрузка данных» (/settings/import): проверка ядра на КОПИИ базы (боевую не трогает: имя базы fur_erp — отказ).
//   createdb fur_imp; восстановить копию; затем
//   DATABASE_URL=postgresql://…/fur_imp node --conditions=react-server node_modules/.bin/tsx scripts/test-import-screen.ts
//   --dir="/путь/к/папке/с/xlsx" — где лежат «поступления и продажи 2.xlsx» и «отчет по товарам фото и цены 2.xlsx» (по умолчанию ~/Downloads)
// Проверяет: исходные файлы дают 0 новых / 0 изменённых; исправленная ячейка ОБНОВЛЯЕТ строку; без галочки лишние строки не удаляются, с галочкой удаляются и откат их возвращает;
// откат возвращает хеш состояния; прайс/размеры хранятся версиями с указателем; неверные файлы — ошибка без записи; фото — только просмотр.
import "./stubs/server-only-shim";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { createAuditedClient } from "../src/lib/prisma";
import { applyImport, buildPreview, listHistory, rollbackImport, ImportFormatError } from "../src/lib/import-server";
import { loadReportSizesState, loadRetailPricesState } from "../src/lib/import-keys";
import { asPriceRows, asSizeRows } from "../src/lib/import-core";

const url = process.env.DATABASE_URL ?? "";
const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "";
if (!dbName || dbName === "fur_erp") { console.error(`Отказ: база «${dbName || "?"}» боевая или не задана. Нужна копия (fur_imp).`); process.exit(2); }
const DIR = process.argv.find((a) => a.startsWith("--dir="))?.slice(6) ?? join(homedir(), "Downloads");
const F_SALES = join(DIR, "поступления и продажи 2.xlsx");
const F_REPORT = join(DIR, "отчет по товарам фото и цены 2.xlsx");

const db = createAuditedClient("script:test-import-screen");
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what} ${extra}`); } else console.log(`  ✓ ${what}`); };
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Хеш состояния: все строки продаж + версии/указатели прайса и размеров (журнал не входит). */
async function fingerprint(org: string) {
  const rows = await db.salesReceiptLine.findMany({ where: { organizationId: org }, orderBy: { sourceKey: "asc" } });
  const st = await db.systemState.findMany({ where: { organizationId: org, OR: [{ key: { startsWith: "retail-prices:" } }, { key: { startsWith: "sales-report-sizes:" } }] }, orderBy: { key: "asc" }, select: { key: true, value: true } });
  return sha(JSON.stringify({ rows, st }));
}

async function edit(file: string, fn: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  fn(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const val = (c: ExcelJS.Cell) => (c.value && typeof c.value === "object" && "result" in (c.value as object) ? (c.value as { result: number }).result : (c.value as number));
const bump = (c: ExcelJS.Cell, d: number) => { const v = c.value; c.value = v && typeof v === "object" && "formula" in (v as object) ? { formula: (v as { formula: string }).formula, result: val(c) + d } : (v as number) + d; };

(async () => {
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const actor = { id: "test", name: "Тест" };
  const salesBuf = readFileSync(F_SALES), reportBuf = readFileSync(F_REPORT);
  const base = await fingerprint(org);
  const rowsBefore = await db.salesReceiptLine.count({ where: { organizationId: org } });
  console.log(`База ${dbName}: строк продаж/поступлений ${rowsBefore}`);

  console.log("\n[1] Исходные файлы — идемпотентность");
  let p = await buildPreview(db, org, "sales", "поступления и продажи 2.xlsx", salesBuf);
  console.log("   ", JSON.stringify(p.parts[0].counts), p.parts[0].totals.map((t) => `${t.label}: ${t.file}/${t.db}`).join("; "));
  ok("продажи: 0 новых, 0 изменённых, 0 ошибок", p.parts[0].counts.added === 0 && p.parts[0].counts.changed === 0 && p.parts[0].counts.errors === 0);
  ok(`продажи: ${rowsBefore} строк совпадают`, p.parts[0].counts.same === rowsBefore && rowsBefore === 523);
  ok("продажи: нечего загружать", p.nothing && !p.canApply);
  p = await buildPreview(db, org, "prices", "отчет по товарам фото и цены 2.xlsx", reportBuf);
  console.log("   ", p.parts.map((x) => `${x.type} ${JSON.stringify(x.counts)}`).join(" | "));
  ok("прайс и размеры: 0 новых, 0 изменённых, 0 ошибок", p.parts.every((x) => x.counts.added === 0 && x.counts.changed === 0 && x.counts.errors === 0));
  ok("прайс и размеры: нечего загружать", p.nothing);
  const r0 = await applyImport(db, org, actor, "sales", "поступления и продажи 2.xlsx", salesBuf, { asOf: "2026-10-21" });
  ok("повторная загрузка тех же данных не пишет ничего (журнала нет)", r0.journalId === null && (await fingerprint(org)) === base);

  console.log("\n[2] Исправленная ячейка обновляет строку");
  const fixed = await edit(F_SALES, (wb) => {
    const ws = wb.worksheets.find((w) => w.name === "продажи")!;
    let target = 0, total = 0;
    ws.eachRow((row, rn) => { if (row.getCell(1).value === "Общий итог") total = rn; else if (!target && rn > 12 && Number(val(row.getCell(19))) > 0) target = rn; });
    bump(ws.getRow(target).getCell(19), 1000);
    bump(ws.getRow(total).getCell(19), 1000);
  });
  p = await buildPreview(db, org, "sales", "исправленный.xlsx", fixed);
  const pc = p.parts[0];
  console.log("   ", JSON.stringify(pc.counts), pc.diffs.slice(0, 2).map((d) => `${d.key} | ${d.field}: ${d.before} → ${d.after}`).join(" ; "));
  ok("предпросмотр: 0 новых, 1 изменённая", pc.counts.added === 0 && pc.counts.changed === 1 && pc.counts.same === rowsBefore - 1);
  ok("итоги файла и базы расходятся на 1 000", pc.totals.find((t) => t.label === "Выручка с НДС")!.file !== pc.totals.find((t) => t.label === "Выручка с НДС")!.db);
  const idsBefore = (await db.salesReceiptLine.findMany({ where: { organizationId: org }, select: { id: true } })).map((x) => x.id).sort().join();
  const a1 = await applyImport(db, org, actor, "sales", "исправленный.xlsx", fixed, { expectSha: p.sha256, asOf: "2026-10-21" });
  ok("применение: записан журнал", !!a1.journalId);
  ok("число строк прежнее (обновлена, а не добавлена/пропущена)", (await db.salesReceiptLine.count({ where: { organizationId: org } })) === rowsBefore);
  ok("id строк не изменились", (await db.salesReceiptLine.findMany({ where: { organizationId: org }, select: { id: true } })).map((x) => x.id).sort().join() === idsBefore);
  p = await buildPreview(db, org, "sales", "исправленный.xlsx", fixed);
  ok("после загрузки файл совпадает с базой (0/0)", p.parts[0].counts.added === 0 && p.parts[0].counts.changed === 0);
  ok("чужой sha → отказ", await applyImport(db, org, actor, "sales", "x.xlsx", fixed, { expectSha: "00" }).then(() => false, (e) => e instanceof ImportFormatError));
  const h1 = await listHistory(db, org);
  ok("история: последняя загрузка можно откатить", h1[0]?.id === a1.journalId && h1[0].canRollback);
  await rollbackImport(db, org, actor, a1.journalId!);
  ok("откат возвращает прежнее состояние (хеш)", (await fingerprint(org)) === base);
  ok("откат отмечен в истории", (await listHistory(db, org))[0].status === "rolled-back");
  ok("повторный откат запрещён", await rollbackImport(db, org, actor, a1.journalId!).then(() => false, (e) => e instanceof ImportFormatError));

  console.log("\n[3] Лишние строки: без галочки остаются, с галочкой удаляются, откат возвращает");
  const sample = await db.salesReceiptLine.findFirstOrThrow({ where: { organizationId: org, kind: "SALE" } });
  const { id: _id, ...rest } = sample; void _id;
  await db.salesReceiptLine.create({ data: { ...rest, sourceKey: "SALE|TEST|лишняя|—|2026-01-01", orderNo: "TEST", importTag: "test-extra" } });
  const withExtra = await fingerprint(org);
  p = await buildPreview(db, org, "sales", "поступления и продажи 2.xlsx", salesBuf, false);
  ok("предпросмотр: 1 удалённая из файла, строка остаётся", p.parts[0].counts.removed === 1 && p.nothing);
  const a2 = await applyImport(db, org, actor, "sales", "поступления и продажи 2.xlsx", salesBuf, { asOf: "2026-10-21" });
  ok("без галочки ничего не удалено", a2.journalId === null && (await fingerprint(org)) === withExtra);
  const a3 = await applyImport(db, org, actor, "sales", "поступления и продажи 2.xlsx", salesBuf, { removeMissing: true, asOf: "2026-10-21" });
  ok("с галочкой лишняя строка удалена", !!a3.journalId && (await db.salesReceiptLine.count({ where: { organizationId: org } })) === rowsBefore);
  await rollbackImport(db, org, actor, a3.journalId!);
  ok("откат вернул удалённую строку (хеш)", (await fingerprint(org)) === withExtra);
  await db.salesReceiptLine.deleteMany({ where: { organizationId: org, importTag: "test-extra" } });
  ok("база очищена до исходного состояния", (await fingerprint(org)) === base);

  console.log("\n[4] Прайс и размеры: версии и указатель");
  const curP = await loadRetailPricesState(org, db), curS = await loadReportSizesState(org, db);
  ok(`без указателя читается последняя по дате (${curP?.key}, ${curS?.key})`, curP?.key === "retail-prices:2026-10-19" && curS?.key === "sales-report-sizes:2026-10-19");
  const nP0 = asPriceRows(curP!.value).length, nS0 = asSizeRows(curS!.value).length;
  const newReport = await edit(F_REPORT, (wb) => {
    const cp = wb.worksheets.find((w) => w.name === "Current Price")!;
    bump(cp.getRow(2).getCell(12), 50000);
    const rep = wb.worksheets.find((w) => w.name === "Report")!;
    let total = 0, leaf = 0;
    rep.eachRow((row, rn) => { if (row.getCell(7).value === "Total") total = rn; else if (!leaf && row.getCell(3).value === 1 && row.getCell(8).value && Number(val(row.getCell(29))) > 0) leaf = rn; });
    bump(rep.getRow(leaf).getCell(29), 1);
    bump(rep.getRow(total).getCell(29), 1);
  });
  p = await buildPreview(db, org, "prices", "новый отчёт.xlsx", newReport, false, "2026-10-22");
  console.log("   ", p.parts.map((x) => `${x.type} ${JSON.stringify(x.counts)}`).join(" | "));
  ok("прайс: 1 изменённая цена", p.parts[0].counts.changed === 1 && p.parts[0].counts.added === 0);
  ok("размеры: 1 изменённая строка", p.parts[1].counts.changed === 1 && p.parts[1].counts.errors === 0);
  const a4 = await applyImport(db, org, actor, "prices", "новый отчёт.xlsx", newReport, { expectSha: p.sha256, asOf: "2026-10-22" });
  const nowP = await loadRetailPricesState(org, db), nowS = await loadReportSizesState(org, db);
  ok("указатель ведёт на новую версию", nowP?.key === "retail-prices:2026-10-22" && nowS?.key === "sales-report-sizes:2026-10-22");
  ok("строк прежнее число, прежняя версия цела", asPriceRows(nowP!.value).length === nP0 && asSizeRows(nowS!.value).length === nS0 && !!(await db.systemState.findFirst({ where: { organizationId: org, key: "retail-prices:2026-10-19" } })));
  ok("цена в новой версии изменилась на 50 000", Math.abs(asPriceRows(nowP!.value).reduce((s, r) => s + r.price, 0) - asPriceRows(curP!.value).reduce((s, r) => s + r.price, 0) - 50000) < 0.01);
  // Вторая загрузка того же раздела: откатить первую нельзя, пока не откачена последняя.
  const newReport2 = await edit(F_REPORT, (wb) => { bump(wb.worksheets.find((w) => w.name === "Current Price")!.getRow(3).getCell(12), 1000); });
  const a5 = await applyImport(db, org, actor, "prices", "ещё отчёт.xlsx", newReport2, { asOf: "2026-10-23" });
  ok("откатить не последнюю загрузку нельзя", await rollbackImport(db, org, actor, a4.journalId!).then(() => false, (e) => e instanceof ImportFormatError));
  await rollbackImport(db, org, actor, a5.journalId!);
  await rollbackImport(db, org, actor, a4.journalId!);
  ok("откат обеих загрузок возвращает прежнее состояние (хеш)", (await fingerprint(org)) === base);

  console.log("\n[5] Неверные файлы — ошибка без записи");
  const bad = async (what: string, kind: "sales" | "prices" | "photos", name: string, buf: Buffer) => {
    const r = await buildPreview(db, org, kind, name, buf).then(() => null, (e) => e);
    const r2 = await applyImport(db, org, actor, kind, name, buf, { asOf: "2026-10-24" }).then(() => null, (e) => e);
    ok(`${what}: «${(r as Error | null)?.message}»`, r instanceof ImportFormatError && r2 instanceof ImportFormatError);
  };
  await bad("продажи ← файл отчёта (нет листа «поступления»)", "sales", "отчет.xlsx", reportBuf);
  await bad("прайс ← файл продаж (нет «Current Price»)", "prices", "продажи.xlsx", salesBuf);
  await bad("не Excel под именем .xlsx", "sales", "мусор.xlsx", Buffer.from("это просто текст, не zip"));
  await bad("другое расширение", "sales", "продажи.xls", salesBuf);
  await bad("пустой файл", "sales", "пусто.xlsx", Buffer.alloc(0));
  const noHead = await edit(F_SALES, (wb) => { const ws = wb.worksheets.find((w) => w.name === "продажи")!; ws.getRow(12).getCell(1).value = "что-то другое"; });
  await bad("нет шапки «Номер заказа»", "sales", "без шапки.xlsx", noHead);
  const badTotal = await edit(F_SALES, (wb) => { const ws = wb.worksheets.find((w) => w.name === "продажи")!; let t = 0; ws.eachRow((r, rn) => { if (r.getCell(1).value === "Общий итог") t = rn; }); bump(ws.getRow(t).getCell(16), 5); });
  const pt = await buildPreview(db, org, "sales", "итог.xlsx", badTotal);
  ok("итог файла не сходится со строками: блокировка", pt.blocked && !pt.canApply && pt.parts[0].counts.errors > 0);
  ok("и применение отказывает", await applyImport(db, org, actor, "sales", "итог.xlsx", badTotal, { asOf: "2026-10-24" }).then(() => false, (e) => e instanceof ImportFormatError));
  ok("после всех ошибок база не изменилась (хеш)", (await fingerprint(org)) === base);
  ok("журнал не пополнился лишним", (await listHistory(db, org)).every((h) => h.status === "rolled-back"));

  console.log("\n[6] Фото: только просмотр");
  const ph = await buildPreview(db, org, "photos", "отчет.xlsx", reportBuf);
  console.log("   ", JSON.stringify(ph.parts[0].counts), ph.parts[0].warnings.map((w) => w.slice(0, 90)).join(" | "));
  ok("предпросмотр кандидатов есть", ph.parts[0].counts.added + ph.parts[0].counts.same > 0 && !ph.canApply);
  ok("запись фото закрыта", await applyImport(db, org, actor, "photos", "отчет.xlsx", reportBuf).then(() => false, (e) => e instanceof ImportFormatError));
  ok("фото не меняют базу (хеш)", (await fingerprint(org)) === base);

  console.log(`\n${fails ? "ПРОВАЛ" : "OK"}: проверок ${checks}, провалов ${fails}`);
  await db.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
