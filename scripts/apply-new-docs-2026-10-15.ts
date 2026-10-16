/**
 * Новые документы от 15.10.2026: реестр списаний ММ → Веллмех (выписка 1С, 37 платежей), УПД МФВМ/000099 от 25.09.2026 и ТЗ № 183 (MSC05).
 * По умолчанию — пробный прогон (БД и UPLOAD_DIR не меняются): печатает, что будет создано/изменено, и что остаётся на решение владельца.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-new-docs-2026-10-15.ts                      # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-new-docs-2026-10-15.ts --apply --live       # боевая база: сам делает bash scripts/backup.sh
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-new-docs-2026-10-15.ts --rollback --apply [--live]
 *   (на копии базы: DATABASE_URL на копию, UPLOAD_DIR на временную папку; --apply без --live; бэкап не делается)
 *
 * Что делает по умолчанию (только то, что документ даёт однозначно):
 *   1. Оплаты поставщику: в пустые поля п/п № / № счёта подставляет данные реестра (выписка 1С) — строки 35, 36, 37 реестра. Даты, суммы, подтверждение НЕ трогаются.
 *   2. ТЗ № 183 (приложение к Договору подряда №1605): заказ в статусе PLANNED, БЕЗ списаний (лот 15317 не списывается), по образцу ТЗ 164 и ТЗ 169–182.
 *   3. Документы к ТЗ 183: приложение (docx, файл сохраняется в UPLOAD_DIR как «Загрузить документ») и УПД МФВМ/99 (запись без файла: .xls приложение не принимает).
 * Только по явным флагам (по умолчанию ВЫКЛЮЧЕНО — решение владельца):
 *   --registry-dates   строки 35 и 37: дата оплаты → дата выписки (01.07.2026; 20.07.2026), строка 37 → «подтверждена» (в базе дата — дата согласования, п/п не было).
 *   --small-payments   4 мелкие оплаты (не сырьё: чески, брелки, командировка) как Payment без привязки. ВНИМАНИЕ: такая оплата уменьшает долг поставщику
 *                      как «аванс без привязки» (−488 630,10 ₽), хотя обязательства в учёте нет — поэтому по умолчанию не заводится.
 * Журнал отката: docs-inventory/corrections-journal-new-docs-2026-10-15.json (было/стало). Запись — через createAuditedClient("script:new-docs").
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const REG_DATES = process.argv.includes("--registry-dates");
const SMALL = process.argv.includes("--small-payments");
const SCRIPT = "apply-new-docs-2026-10-15";
const ACTOR = "script:new-docs";
const DOWNLOADS = process.env.DOWNLOADS?.trim() || join(homedir(), "Downloads");
const F_TZ = "ПРИЛОЖЕНИЕ_183_MSC05_1_вяз_соболь_капюш.docx";
const F_UPD = "МФВМ000099.xls";
const SRC = "выписка 1С «Копия_Копия_Спецификации_счета_ТОРГ_12.xls» (реестр списаний ММ → Веллмех, 15.10.2026)";
const CONTRACT = "№ 1605 от 16.05.2025";

const r2 = (n: number) => Math.round(n * 100) / 100;
const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ruDate = (iso: string) => iso.split("-").reverse().join(".");

/** Строки реестра, по которым что-то пишется. n — номер строки реестра (1…37), amount — «Списание», pp — «Вх.номер». */
const FILL = [
  { n: 35, amount: 19870, pp: "51258", invoiceNo: "181", invoiceDate: "2026-06-16", where: { amount: 19870, invoiceNo: null as string | null, paidAt: "2026-07-02" }, regDate: "2026-07-01", purpose: "УПД/счёт №181, Спец. №16" },
  { n: 36, amount: 2380500, pp: "53718", invoiceNo: "195", invoiceDate: "2026-07-03", where: { amount: 2380500, invoiceNo: "195", paidAt: "2026-07-20" }, regDate: "2026-07-20", purpose: "счёт №195, Спец. №18" },
  { n: 37, amount: 7236812.03, pp: "53717", invoiceNo: "197", invoiceDate: "2026-07-09", where: { amount: 7236812.03, invoiceNo: "197", paidAt: "2026-07-17" }, regDate: "2026-07-20", purpose: "счёт №197, Спец. №10" },
];
/** Оплаты реестра, которых нет в базе (не сырьё; закупки/ТЗ для них нет). */
const SMALL_PAY = [
  { n: 20, date: "2025-11-25", amount: 27960, pp: "81455", inv: "201", invDate: "2025-11-06", what: "Чесок для меха (УПД №201)" },
  { n: 21, date: "2025-12-04", amount: 24500, pp: "83556", inv: "217", invDate: "2025-12-01", what: "брелок из хвоста соболя (УПД №217, ивент ДЛТ)" },
  { n: 23, date: "2026-03-02", amount: 19600, pp: "30413", inv: "237", invDate: "2025-12-12", what: "брелки из хвоста соболя (УПД №237)" },
  { n: 34, date: "2026-06-15", amount: 416570.1, pp: "48847", inv: "171", invDate: "2026-06-02", what: "доп. услуги по Спец. №14 (УПД №171; по акту сверки — командировка на осмотр рыси)" },
];
/** ТЗ № 183 — данные из приложения (разобрано tz-docx-import: payloadFromDocx), УПД МФВМ/000099 — из .xls. */
const TZ = {
  number: "183", date: "2026-08-27", deadline: "2026-10-31", model: "MSC05", color: "Коричневый", size: "210*20", qty: 1, workPrice: 150000,
  material: "Соболь клеточный выделанный тонированный", lot: "15317", lotName: "Соболь клеточный выделанный тонированный XXI 1 - 2 2 - лот 15317 (СП1225)", purchase: "З-2026-0004",
  matQty: 10, matUnit: 29411.29, matTotal: 358817.74, total: 508817.74,
  upd: { number: "МФВМ/99", date: "2026-09-25", net: 294112.9, vat: 64704.84, gross: 358817.74 },
};

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; flags: string[];
  edits: { id: string; before: Record<string, unknown>; after: Record<string, unknown>; row: number }[];
  payments: { id: string; row: number }[];
  order: { id: string; number: string } | null;
  docs: { id: string; title: string; storagePath: string | null }[];
  files: string[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { matchColorRef, capitalizeColor } = await import("../src/lib/color-ref");
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, "corrections-journal-new-docs-2026-10-15.json");
  const url = process.env.DATABASE_URL ?? "";
  const isLive = /\/fur_erp(\?|$)/.test(url);
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const orgId = org.id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}; флаги: ${[REG_DATES && "--registry-dates", SMALL && "--small-payments"].filter(Boolean).join(" ") || "нет"}`);
  if (APPLY && isLive && !LIVE) { console.log("Это боевая база: для записи нужен флаг --live (он сам сделает бэкап). Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }

  // ----- Откат -----
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат: правок оплат ${j.edits.length}, созданных оплат ${j.payments.length}, ТЗ ${j.order ? j.order.number : "—"}, документов ${j.docs.length}, файлов ${j.files.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (j.order) {
      const id = j.order.id;
      const blockers = {
        "списания": await prisma.productionMaterialUsage.count({ where: { productionOrderId: id } }),
        "движения склада": await prisma.stockMovement.count({ where: { productionOrderId: id } }),
        "разнесения оплат": await prisma.paymentAllocation.count({ where: { productionOrderId: id } }),
        "ссылки оплат": await prisma.productionPaymentOrder.count({ where: { productionOrderId: id } }),
        "расходы": await prisma.productionExpense.count({ where: { productionOrderId: id } }),
        "отгрузки": await prisma.shipmentLine.count({ where: { productionOrderId: id } }),
        "примерки": await prisma.fitting.count({ where: { productionOrderId: id } }),
        "готовая продукция": await prisma.finishedGoodsMovement.count({ where: { productionOrderId: id } }),
        "чужие документы": await prisma.driveDocument.count({ where: { productionOrderId: id, id: { notIn: j.docs.map((x) => x.id) } } }),
      };
      const blocked = Object.entries(blockers).filter(([, n]) => n > 0);
      if (blocked.length) {
        console.log("ОТКАТ НЕВОЗМОЖЕН: к ТЗ уже привязаны другие записи:"); for (const [k, n] of blocked) console.log(`  - ${k}: ${n}`);
        process.exitCode = 1; await prisma.$disconnect(); return;
      }
    }
    if (APPLY) {
      if (isLive) { console.log("Копия базы перед откатом: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") }); }
      const { removeStoredFiles } = await import("../src/lib/fitting-files");
      await prisma.$transaction(async (tx) => {
        for (const e of j.edits) {
          const cur = await tx.payment.findUnique({ where: { id: e.id } });
          if (!cur) continue;
          const data: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(e.before)) data[k] = k === "paidAt" || k === "confirmedAt" ? (v ? new Date(v as string) : null) : v;
          await tx.payment.update({ where: { id: e.id }, data });
        }
        if (j.payments.length) await tx.payment.deleteMany({ where: { id: { in: j.payments.map((p) => p.id) } } });
        if (j.docs.length) await tx.driveDocument.deleteMany({ where: { id: { in: j.docs.map((x) => x.id) } } });
        if (j.order) await tx.productionOrder.deleteMany({ where: { id: j.order.id } });
      }, { timeout: 60000 });
      const gone: string[] = [];
      for (const p of j.files) {
        const left = (await prisma.driveDocument.count({ where: { storagePath: p } })) + (await prisma.purchaseDocument.count({ where: { storagePath: p } }));
        if (left === 0) gone.push(p); else console.log(`  файл ${p} оставлен: на него ссылаются ${left} др. записей`);
      }
      await removeStoredFiles(gone);
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  // ----- Проверки и план -----
  const problems: string[] = [];
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organizationId: orgId, name: { contains: "Веллмех" } } });
  const client = await prisma.client.findFirst({ where: { organizationId: orgId, name: { contains: "Меркури" } } });
  if (!client) problems.push("клиент «Меркури Мода» не найден");
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") problems.push("журнал уже содержит применённое внесение — сначала --rollback --apply");

  // 1. п/п и счёт в пустые поля
  type Edit = { row: number; id: string; label: string; before: Record<string, unknown>; after: Record<string, unknown> };
  const edits: Edit[] = [];
  for (const f of FILL) {
    const rows = await prisma.payment.findMany({
      where: { organizationId: orgId, supplierId: supplier.id, status: "COMPLETED", ppNo: null, paidAt: { gte: d(f.where.paidAt), lt: new Date(d(f.where.paidAt).getTime() + 86400000) }, ...(f.where.invoiceNo === null ? { invoiceNo: null } : { invoiceNo: f.where.invoiceNo }) },
      orderBy: { amount: "asc" },
    });
    const sum = r2(rows.reduce((s, x) => s + Number(x.amount), 0));
    if (!rows.length || sum !== r2(f.where.amount)) {
      const already = await prisma.payment.count({ where: { organizationId: orgId, supplierId: supplier.id, ppNo: f.pp } });
      if (already) { console.log(`Строка ${f.n}: п/п ${f.pp} уже проставлен (${already} зап.) — пропуск`); continue; }
      problems.push(`строка ${f.n} реестра (${rub(f.amount)}, п/п ${f.pp}): в базе без п/п найдено ${rows.length} зап. на ${rub(sum)}, ожидалось ${rub(f.where.amount)} — не вношу`);
      continue;
    }
    for (const x of rows) {
      const before: Record<string, unknown> = { ppNo: x.ppNo };
      const after: Record<string, unknown> = { ppNo: f.pp };
      if (!x.invoiceNo) { before.invoiceNo = x.invoiceNo; after.invoiceNo = f.invoiceNo; }
      if (REG_DATES && (f.n === 35 || f.n === 37)) {
        before.paidAt = x.paidAt.toISOString(); after.paidAt = d(f.regDate).toISOString();
        if (f.n === 37) { before.confirmed = x.confirmed; before.confirmedAt = x.confirmedAt?.toISOString() ?? null; before.confirmedBy = x.confirmedBy; after.confirmed = true; after.confirmedAt = "NOW"; after.confirmedBy = `${SRC}: п/п №${f.pp} от ${ruDate(f.regDate)}, ${rub(f.amount)}`; }
      }
      edits.push({ row: f.n, id: x.id, label: `${rub(Number(x.amount))}, ${x.paidAt.toISOString().slice(0, 10)}, счёт ${x.invoiceNo ?? "—"}`, before, after });
    }
  }
  // 2. мелкие оплаты (по флагу)
  const smallPlan: typeof SMALL_PAY = [];
  for (const s of SMALL_PAY) {
    const ex = await prisma.payment.count({ where: { organizationId: orgId, supplierId: supplier.id, OR: [{ ppNo: s.pp }, { amount: s.amount, paidAt: d(s.date) }] } });
    if (ex) { console.log(`Строка ${s.n}: оплата ${rub(s.amount)} уже есть в базе — пропуск`); continue; }
    smallPlan.push(s);
  }

  // 3. ТЗ 183
  const exists = await prisma.productionOrder.findMany({ where: { organizationId: orgId, workOrderNumber: TZ.number }, select: { number: true } });
  if (exists.length) problems.push(`ТЗ ${TZ.number} уже есть в базе (${exists.map((e) => e.number).join(", ")}) — скрипт не дублирует`);
  const nm = (s: string) => s.replace(/[\s\-–—_/]+/g, "").toLowerCase();
  const models = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const mm = models.filter((m) => nm(m.name) === nm(TZ.model));
  if (mm.length !== 1) problems.push(`артикул ${TZ.model}: найдено ${mm.length}, ожидался 1`);
  const colors = await prisma.colorRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, note: true } });
  const cr = matchColorRef(TZ.color, colors);
  if (!cr) problems.push(`цвет «${TZ.color}» не найден в справочнике — новый цвет скрипт не создаёт`);
  const lots = await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, lotNumber: TZ.lot }, include: { purchase: { select: { number: true, status: true } }, rawMaterial: { select: { name: true } } } });
  const lot = lots.length === 1 ? lots[0] : null;
  if (!lot) problems.push(`лот ${TZ.lot}: найдено ${lots.length}, ожидался 1`);
  else {
    if (lot.purchase?.number !== TZ.purchase) problems.push(`лот ${TZ.lot} в закупке ${lot.purchase?.number}, ожидалась ${TZ.purchase}`);
    const expect = Number(lot.materialCostExclVat) * 1.04;
    if (Math.abs(expect - TZ.matUnit) > 0.01) problems.push(`цена в ТЗ ${TZ.matUnit} ≠ лот без НДС × 1,04 = ${r2(expect)}`);
    if (Number(lot.quantityRemaining) < TZ.matQty) problems.push(`в лоте ${TZ.lot} остаток ${lot.quantityRemaining} < ${TZ.matQty}`);
  }
  // арифметика документов
  if (r2(TZ.matQty * TZ.matUnit) !== TZ.upd.net) problems.push(`УПД: ${TZ.matQty} × ${TZ.matUnit} = ${r2(TZ.matQty * TZ.matUnit)} ≠ ${TZ.upd.net}`);
  if (r2(TZ.upd.net * 0.22) !== TZ.upd.vat) problems.push(`УПД: НДС 22% от ${TZ.upd.net} = ${r2(TZ.upd.net * 0.22)} ≠ ${TZ.upd.vat}`);
  if (r2(TZ.upd.net + TZ.upd.vat) !== TZ.upd.gross) problems.push("УПД: сумма с НДС не сходится");
  if (TZ.upd.gross !== TZ.matTotal) problems.push("сумма УПД ≠ сумме материалов в ТЗ 183");
  if (r2(TZ.workPrice * TZ.qty + TZ.matTotal) !== TZ.total) problems.push("работа + материалы ≠ итого ТЗ 183");
  const pTz = join(DOWNLOADS, F_TZ), pUpd = join(DOWNLOADS, F_UPD);
  for (const p of [pTz, pUpd]) if (!existsSync(p)) problems.push(`файл не найден: ${p}`);
  const warehouse = (await prisma.warehouse.findMany({ where: { organizationId: orgId } })).find((w) => w.isDefault) ?? (await prisma.warehouse.findFirst({ where: { organizationId: orgId } }));
  if (!warehouse) problems.push("нет склада");

  // ----- Отчёт -----
  const out: string[] = [];
  out.push("", "## 1. п/п № и № счёта в пустые поля оплат (из реестра)", "", "| строка реестра | оплата в базе | было | станет |", "|---|---|---|---|");
  for (const e of edits) out.push(`| ${e.row} | ${e.id} (${e.label}) | ${JSON.stringify(e.before)} | ${JSON.stringify(e.after)} |`);
  if (!edits.length) out.push("| — | нечего вносить | | |");
  if (!REG_DATES) out.push("", "Не правятся (решение владельца, флаг --registry-dates): строка 35 — дата в базе 02.07.2026 (дата подтверждения поставщика), в выписке 01.07.2026; строка 37 — дата в базе 17.07.2026 (дата согласования), в выписке 20.07.2026, оплата в базе «не подтверждена».");
  out.push("", `## 2. Мелкие оплаты не по сырью ${SMALL ? "(ВНОСЯТСЯ по флагу --small-payments)" : "(НЕ вносятся; флаг --small-payments)"}`, "", "| строка | дата | сумма | п/п | счёт | за что |", "|---|---|---:|---|---|---|");
  for (const s of smallPlan) out.push(`| ${s.n} | ${ruDate(s.date)} | ${rub(s.amount)} | ${s.pp} | №${s.inv} от ${ruDate(s.invDate)} | ${s.what} |`);
  out.push(`Итого ${rub(smallPlan.reduce((a, s) => a + s.amount, 0))}: как «аванс без привязки» уменьшили бы долг поставщику на эту сумму (обязательства по ним в учёте нет).`);
  out.push("", "## 3. ТЗ № 183 (создаётся, PLANNED, без списаний)", "",
    `Артикул ${TZ.model} → ${mm[0]?.name ?? "?"}; цвет ${TZ.color} → ${cr?.name ?? "?"}; размер ${TZ.size}; ${TZ.qty} шт.; работа ${rub(TZ.workPrice)} (в т.ч. НДС 22%); дата ТЗ ${ruDate(TZ.date)}; клиент ${client?.name ?? "?"}; договор ${CONTRACT}; склад ${warehouse?.name ?? "?"}; партия не назначается.`,
    `Материал заказчика: ${TZ.lotName}, ${TZ.matQty} шт × ${TZ.matUnit.toLocaleString("ru-RU")} без НДС (+22%) = ${rub(TZ.matTotal)}; итого по ТЗ ${rub(TZ.total)}; срок работ до ${ruDate(TZ.deadline)} (в заметку ТЗ).`,
    lot ? `Лот ${TZ.lot} (${lot.purchase?.number}): остаток ${lot.quantityRemaining} из ${lot.quantityReceived}, цена лота ${rub(Number(lot.unitCost))} с НДС ${lot.vatRate}% (без НДС ${rub(Number(lot.materialCostExclVat))}; ×1,04 = ${r2(Number(lot.materialCostExclVat) * 1.04)}) — списание НЕ делается (решение владельца: 10 шт → остаток ${Number(lot.quantityRemaining) - TZ.matQty}).` : "Лот не найден.",
    `Документы к ТЗ: «${F_TZ}» (TZ_APPENDIX, №183, ${ruDate(TZ.date)}, файл сохраняется в UPLOAD_DIR); «${F_UPD}» (UPD, ${TZ.upd.number} от ${ruDate(TZ.upd.date)}, без файла).`);
  if (problems.length) out.push("", "## ПРОБЛЕМЫ — запись не выполняется", ...problems.map((x) => `- ${x}`));
  console.log(out.join("\n"));
  if (problems.length) { console.log(`\nНайдено проблем: ${problems.length}. Запись невозможна.`); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (!APPLY) { console.log("\nПробный прогон: БД и UPLOAD_DIR не менялись. Для записи — --apply (на боевой ещё --live)."); await prisma.$disconnect(); return; }

  // ----- Применение -----
  if (isLive) { console.log("\nКопия базы и файлов перед применением: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") }); }
  const { readDocumentFiles } = await import("../src/lib/purchase-files");
  const { writeDriveFile } = await import("../src/lib/drive-files");
  const { removeStoredFiles } = await import("../src/lib/fitting-files");
  const { nextDocumentNumber } = await import("../src/lib/numbering");
  const journal: Journal = { script: `${SCRIPT}.ts`, status: "applied", at: new Date().toISOString(), flags: [REG_DATES && "--registry-dates", SMALL && "--small-payments"].filter(Boolean) as string[], edits: [], payments: [], order: null, docs: [], files: [] };
  const read = await readDocumentFiles([new File([readFileSync(pTz)], F_TZ)]);
  if ("error" in read) throw new Error(`${F_TZ}: ${read.error}`);
  const stored = await writeDriveFile(orgId, read.files[0]);
  journal.files.push(stored.storagePath);
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      for (const e of edits) {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(e.after)) data[k] = k === "paidAt" ? new Date(v as string) : v === "NOW" ? now : v;
        await tx.payment.update({ where: { id: e.id }, data });
        journal.edits.push({ id: e.id, row: e.row, before: e.before, after: { ...e.after, ...(e.after.confirmedAt === "NOW" ? { confirmedAt: now.toISOString() } : {}) } });
      }
      if (SMALL) {
        for (const s of smallPlan) {
          const p = await tx.payment.create({
            data: {
              organizationId: orgId, supplierId: supplier.id, amount: s.amount, kind: "OTHER", status: "COMPLETED", paidAt: d(s.date),
              ppNo: s.pp, invoiceNo: s.inv, docRef: `п/п №${s.pp} от ${ruDate(s.date)}; счёт Веллмех №${s.inv} от ${ruDate(s.invDate)}`,
              notes: `Не сырьё, без привязки к закупке/ТЗ: ${s.what}. Договор купли-продажи №2502 от 26.02.2025. Источник: ${SRC}, строка ${s.n}. Обязательства в учёте нет — решение владельца о статье расхода.`,
              confirmed: true, confirmedAt: now, confirmedBy: `${SRC}: п/п №${s.pp}`,
            },
            select: { id: true },
          });
          journal.payments.push({ id: p.id, row: s.n });
        }
      }
      const number = await nextDocumentNumber(tx, "productionOrder", orgId, "П");
      const order = await tx.productionOrder.create({
        data: {
          organizationId: orgId, number, productModelId: mm[0].id, rawWarehouseId: warehouse!.id, finishedWarehouseId: warehouse!.id, status: "PLANNED",
          plannedQuantity: TZ.qty, producedQuantity: 0, color: capitalizeColor(TZ.color), colorRefId: cr!.id, size: TZ.size, materialDescription: TZ.material,
          clientId: client!.id, contractNumber: CONTRACT, workOrderNumber: TZ.number, workOrderDate: d(TZ.date), clientWorkPricePerUnit: TZ.workPrice,
          notes: `ТЗ №${TZ.number} от ${ruDate(TZ.date)}: создано по документу «${F_TZ}» (${SCRIPT}.ts). Материал заказчика: ${TZ.lotName}, ${TZ.matQty} шт × ${TZ.matUnit.toLocaleString("ru-RU")} без НДС (22%) = ${rub(TZ.matTotal)} — УПД ${TZ.upd.number} от ${ruDate(TZ.upd.date)}. Списание лота ${TZ.lot} не заведено (статус «Запланировано»). Итого по ТЗ ${rub(TZ.total)}; срок завершения работ ${ruDate(TZ.deadline)}.`,
        },
        select: { id: true, number: true },
      });
      journal.order = { id: order.id, number: order.number };
      const a = await tx.driveDocument.create({
        data: { organizationId: orgId, driveFileId: `local-${randomUUID()}`, title: F_TZ.slice(0, 200), docType: "TZ_APPENDIX", mimeType: stored.storedMime, sizeBytes: stored.storedSize, docNumber: TZ.number, docDate: d(TZ.date), year: 2026, ...stored, storedAt: new Date(), productionOrderId: order.id },
        select: { id: true },
      });
      journal.docs.push({ id: a.id, title: F_TZ, storagePath: stored.storagePath });
      const u = await tx.driveDocument.create({
        data: {
          organizationId: orgId, driveFileId: `local-${randomUUID()}`, title: F_UPD, docType: "UPD", mimeType: "application/vnd.ms-excel", sizeBytes: statSync(pUpd).size, docNumber: TZ.upd.number, docDate: d(TZ.upd.date), year: 2026,
          productionOrderId: order.id,
          notes: `УПД ${TZ.upd.number} от ${ruDate(TZ.upd.date)}: продавец ООО «Меркури Мода» → покупатель ООО «ВЕЛЛМЕХ», договор б/н от 01.07.2025; ${TZ.lotName}, ${TZ.matQty} шт × ${TZ.matUnit.toLocaleString("ru-RU")} = ${rub(TZ.upd.net)} без НДС, НДС 22% ${rub(TZ.upd.vat)}, всего ${rub(TZ.upd.gross)}. Файл .xls в приложение не загружен (формат не поддерживается).`,
        },
        select: { id: true },
      });
      journal.docs.push({ id: u.id, title: F_UPD, storagePath: null });
    }, { timeout: 60000, maxWait: 15000 });
  } catch (e) {
    console.error("Сбой — транзакция отменена, файл удаляю:", e);
    await removeStoredFiles(journal.files);
    await prisma.$disconnect();
    process.exit(1);
  }
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено: правок оплат ${journal.edits.length}, новых оплат ${journal.payments.length}, ТЗ ${journal.order?.number}, документов ${journal.docs.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
