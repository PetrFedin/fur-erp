/**
 * Импорт «поступления и продажи (2).xlsx» (листы «постапления» и «продажи») в таблицу SalesReceiptLine — для раздела Cashflow и будущих «Продаж».
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-receipts-sales-2026-10-27.ts                    # пробный прогон: разбор файла, сверка с «Общим итогом», сколько строк будет добавлено (БД не меняется)
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-receipts-sales-2026-10-27.ts --apply            # записать в НЕ боевую базу (копия, scratch)
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-receipts-sales-2026-10-27.ts --apply --live     # записать в боевую fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-receipts-sales-2026-10-27.ts --rollback [--apply [--live]]   # удалить ровно записанные этим импортом строки
 *   --file="/путь/к/файлу.xlsx" — другой источник (по умолчанию ~/Downloads/поступления и продажи (2).xlsx)
 *
 * Перед записью нужна миграция 20261028090000_sales_receipt_lines (npx prisma migrate deploy).
 * Идемпотентно: ключ строки = вид|заказ|артикул|цвет|дата (sourceKey, уникален в организации); уже загруженные строки пропускаются.
 * Безопасность: файл сверяется со своим «Общим итогом» (штуки и 8 денежных столбцов); расхождение — остановка без записи. Запись одной транзакцией.
 * Журнал: docs-inventory/corrections-journal-sales-import-2026-10-27.json (для копии — с суффиксом имени базы): id созданных строк, откат удаляет только их.
 */
import Module from "module";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const LIVE = process.argv.includes("--live");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? join(homedir(), "Downloads", "поступления и продажи (2).xlsx");
const TAG = "sales-import:2026-10-27";
const cid = () => "c" + randomBytes(12).toString("hex");
const fmt = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; file: string; created: string[] };

async function readSheets() {
  const ExcelJS = (await import("exceljs")).default;
  const { parseSheetRow } = await import("../src/lib/sales-receipts-core");
  type Parsed = NonNullable<ReturnType<typeof parseSheetRow>>;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const out: { lines: Parsed[]; totals: Record<string, (number | null)[]> } = { lines: [], totals: {} };
  for (const [kind, prefix] of [["RECEIPT", "постапления"], ["SALE", "продажи"]] as const) {
    const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase().startsWith(prefix));
    if (!ws) throw new Error(`В файле нет листа «${prefix}»`);
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (rn < 13) return;
      const cells = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v)) as (string | number | null)[];
      if (cells[0] === "Общий итог") { out.totals[kind] = cells.slice(15).map((x) => (x == null ? null : Number(x))); return; }
      const p = parseSheetRow(kind, cells.map((c) => (c === undefined ? null : c)));
      if (p) out.lines.push(p);
    });
  }
  return out;
}

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient("script:import-receipts-sales-2026-10-27");
  const JOURNAL = join(INV, `corrections-journal-sales-import-2026-10-27${isLive ? "" : `-${dbName}`}.json`);

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): удалить ${j.created.length} строк${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      const r = await prisma.salesReceiptLine.deleteMany({ where: { id: { in: j.created }, importTag: TAG } });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log(`Удалено ${r.count}.`);
    }
    await prisma.$disconnect();
    return;
  }

  const org = (await prisma.organization.findFirst({ select: { id: true } }))!.id;
  const src = await readSheets();
  const rec = src.lines.filter((l) => l.kind === "RECEIPT");
  const sale = src.lines.filter((l) => l.kind === "SALE");
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  // Сверка с «Общим итогом» файла: штуки, затем 8 денежных столбцов продаж.
  const recT = src.totals.RECEIPT?.[0], saleT = src.totals.SALE ?? [];
  const checks: [string, number, number | null | undefined][] = [
    ["поступления, шт.", sum(rec.map((l) => l.pcs ?? 0)), recT],
    ["продажи, шт.", sum(sale.map((l) => l.pcs ?? 0)), saleT[0]],
    ["продажи EUR с НДС", sum(sale.map((l) => l.retailEur ?? 0)), saleT[1]],
    ["продажи EUR без НДС", sum(sale.map((l) => l.retailEurExVat ?? 0)), saleT[2]],
    ["продажи RUR с НДС", sum(sale.map((l) => l.retailRub ?? 0)), saleT[3]],
    ["продажи RUR без НДС", sum(sale.map((l) => l.retailRubExVat ?? 0)), saleT[4]],
    ["скидка EUR с НДС", sum(sale.map((l) => l.discountEur ?? 0)), saleT[5]],
    ["скидка EUR без НДС", sum(sale.map((l) => l.discountEurExVat ?? 0)), saleT[6]],
    ["скидка RUR с НДС", sum(sale.map((l) => l.discountRub ?? 0)), saleT[7]],
    ["скидка RUR без НДС", sum(sale.map((l) => l.discountRubExVat ?? 0)), saleT[8]],
  ];
  console.log(`Файл: ${FILE}\nСтрок: поступления ${rec.length}, продажи ${sale.length}`);
  let bad = 0;
  for (const [name, mine, file] of checks) {
    const ok = file != null && Math.abs(mine - file) < 0.01;
    if (!ok) bad++;
    console.log(`  ${ok ? "ОК " : "НЕТ"} ${name}: Σ строк ${fmt(mine)} · «Общий итог» ${file == null ? "—" : fmt(file)}`);
  }
  const keys = new Set<string>();
  for (const l of src.lines) { if (keys.has(l.sourceKey)) { console.log(`  НЕТ дубль ключа ${l.sourceKey}`); bad++; } keys.add(l.sourceKey); }
  if (bad) throw new Error(`Файл не сходится сам с собой (${bad}) — остановлено, БД не менялась.`);

  const existing = new Set((await prisma.salesReceiptLine.findMany({ where: { organizationId: org }, select: { sourceKey: true } })).map((x) => x.sourceKey));
  const fresh = src.lines.filter((l) => !existing.has(l.sourceKey));
  console.log(`В базе «${dbName}» уже есть ${existing.size}; будет добавлено ${fresh.length}, пропущено (идемпотентность) ${src.lines.length - fresh.length}.`);
  if (!APPLY) { console.log("Пробный прогон: БД не изменена. Для записи добавьте --apply (боевая: --apply --live)."); await prisma.$disconnect(); return; }
  if (!fresh.length) { console.log("Нечего применять."); await prisma.$disconnect(); return; }
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённый импорт — для добавления новых строк сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const ids = fresh.map(() => cid());
  await prisma.$transaction(async (tx) => {
    await tx.salesReceiptLine.createMany({
      data: fresh.map((l, i) => ({
        id: ids[i], organizationId: org, sourceKey: l.sourceKey, kind: l.kind, orderNo: l.orderNo, season: l.season, article: l.article, fabric: l.fabric, colorId: l.colorId,
        modelCode: l.modelCode, level2: l.level2, level3: l.level3, level4: l.level4, level5: l.level5, date: new Date(l.iso + "T00:00:00.000Z"), pcs: l.pcs,
        retailEur: l.retailEur, retailEurExVat: l.retailEurExVat, retailRub: l.retailRub, retailRubExVat: l.retailRubExVat,
        discountEur: l.discountEur, discountEurExVat: l.discountEurExVat, discountRub: l.discountRub, discountRubExVat: l.discountRubExVat, importTag: TAG,
      })),
    });
    // Контроль после записи: итог в базе = итог файла (иначе откат транзакции).
    const rows = await tx.salesReceiptLine.findMany({ where: { organizationId: org }, select: { kind: true, pcs: true, retailRub: true } });
    const dbRec = sum(rows.filter((r) => r.kind === "RECEIPT").map((r) => r.pcs ?? 0));
    const dbSale = sum(rows.filter((r) => r.kind === "SALE").map((r) => r.pcs ?? 0));
    const dbRub = sum(rows.filter((r) => r.kind === "SALE").map((r) => Number(r.retailRub ?? 0)));
    if (dbRec !== recT || dbSale !== saleT[0] || Math.abs(dbRub - (saleT[3] ?? 0)) > 0.01) throw new Error("Итоги в базе не равны итогам файла — откат.");
    writeJson(JOURNAL, { script: "import-receipts-sales-2026-10-27.ts", status: "applied", at: new Date().toISOString(), db: dbName, file: FILE, created: ids } satisfies Journal);
  }, { timeout: 120000, maxWait: 30000 });
  console.log(`Записано на «${dbName}»: ${ids.length} строк. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
