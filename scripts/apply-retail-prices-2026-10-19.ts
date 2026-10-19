/**
 * Текущие розничные цены из листа «Current Price» файла «отчет по товарам фото и цены 2.xlsx» (257 строк: артикул × размер × цвет, ₽).
 *
 *   TSX="node --conditions=react-server --env-file=.env node_modules/.bin/tsx"
 *   $TSX scripts/apply-retail-prices-2026-10-19.ts                 # пробный прогон: сопоставление и отчёт (БД не меняется)
 *   $TSX scripts/apply-retail-prices-2026-10-19.ts --apply         # записать в НЕ боевую базу (копия)
 *   $TSX scripts/apply-retail-prices-2026-10-19.ts --apply --live  # в боевую (сам делает bash scripts/backup.sh)
 *   $TSX scripts/apply-retail-prices-2026-10-19.ts --rollback --apply [--live]
 *   --file="/путь.xlsx" — другой источник
 *
 * Что делает:
 *  1) Кладёт ВЕСЬ прайс (артикул, цвет, размер, цена) в SystemState «retail-prices:2026-10-19» — по нему считаются маркапы по артикулу и цвету
 *     (видят только сотрудники заказчика: подрядчику страницы Cashflow/«Продажи» закрыты, ключ не читается ни одним кабинетом подрядчика).
 *  2) Модели, у которых во ВСЕХ строках прайса одна и та же цена и у которых ProductModel.sellingPrice пуст, получают sellingPrice = эта цена.
 *     Где в базе уже стоит ДРУГАЯ цена — не перезаписывается, расхождение в отчёте (решение по цене остаётся за владельцем). Где цены разные по цветам/размерам — sellingPrice не ставится (одна цена на модель была бы выдумкой), цены лежат в п.1.
 * НДС: цена «с НДС» (розничная цена на полке): в продажах за 143 строки с совпадающим артикулом и цветом цена до скидки равна текущей (медиана отношения 1,00; 93 строки совпали до рубля), а столбцы «с НДС» в продажах — те же числа.
 * Сопоставление: код модели из начала артикула (латиница/кириллица, дефис и пробел не важны); неоднозначные и ненайденные — в список.
 * Журнал отката: docs-inventory/cashflow-sales-2026-10-19/prices-journal<-база>.json (прежние sellingPrice и прежнее значение ключа).
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? join(homedir(), "Downloads", "отчет по товарам фото и цены 2.xlsx");
const ROOT = join(__dirname, "..");
const DIR = join(ROOT, "docs-inventory", "cashflow-sales-2026-10-19");
const fmt = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 0 });

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; keyBefore: unknown | null; models: { id: string; name: string; before: string | null; after: string }[] };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { modelCodeOfArticle, normCode } = await import("../src/lib/sales-receipts-core");
  const { RETAIL_PRICES_KEY: RETAIL_KEY } = await import("../src/lib/margin");
  const prisma = createAuditedClient("script:apply-retail-prices-2026-10-19");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const isLive = dbName === "fur_erp";
  const JOURNAL = join(DIR, `prices-journal${isLive ? "" : "-" + dbName}.json`);
  const orgId = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Боевая база: нужен --live. Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (APPLY && !isLive && LIVE) { console.log("--live указан, но база не fur_erp."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); };

  if (ROLLBACK) {
    const j: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    console.log(`Откат: моделей ${j.models.length}, ключ прайса${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      if (isLive) backup();
      for (const m of j.models) {
        const cur = await prisma.productModel.findUnique({ where: { id: m.id }, select: { sellingPrice: true } });
        if (cur && cur.sellingPrice && Math.abs(cur.sellingPrice.toNumber() - Number(m.after)) < 0.005) await prisma.productModel.update({ where: { id: m.id }, data: { sellingPrice: m.before } });
        else console.log(`  ${m.name}: цена изменена после скрипта — не откатываю`);
      }
      if (j.keyBefore === null) await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: RETAIL_KEY } });
      else await prisma.systemState.update({ where: { organizationId_key: { organizationId: orgId, key: RETAIL_KEY } }, data: { value: j.keyBefore as object } });
      writeFileSync(JOURNAL, JSON.stringify({ ...j, status: "rolled-back", at: new Date().toISOString() }, null, 1));
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets.find((w) => w.name === "Current Price");
  if (!ws) throw new Error("В файле нет листа «Current Price»");
  type PR = { acode: string; color: string; size: string; price: number; modelCode: string | null; row: number };
  const rows: PR[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const v = (row.values as unknown[]).slice(1);
    if (!v[0] || v[11] == null) return;
    rows.push({ acode: String(v[0]), color: String(v[10] ?? ""), size: String(v[7] ?? ""), price: Number(v[11]), modelCode: modelCodeOfArticle(String(v[0])), row: rn });
  });
  console.log(`Строк прайса: ${rows.length}, артикулов ${new Set(rows.map((r) => r.acode)).size}`);

  const models = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, salesCode: true, sellingPrice: true } });
  const byCode = new Map<string, typeof models>();
  for (const m of models) for (const k of new Set([normCode(m.name), ...(m.salesCode ? [normCode(m.salesCode)] : [])])) byCode.set(k, [...(byCode.get(k) ?? []), m]);
  const unmatched: string[] = [], ambiguous: string[] = [];
  const perModel = new Map<string, { m: (typeof models)[number]; prices: Set<number>; rows: PR[] }>();
  for (const r of rows) {
    if (!r.modelCode) { unmatched.push(`стр. ${r.row} «${r.acode}»: код модели не распознан`); continue; }
    const c = byCode.get(r.modelCode) ?? [];
    if (c.length === 0) { unmatched.push(`стр. ${r.row} «${r.acode}»: модели ${r.modelCode} нет в системе`); continue; }
    if (c.length > 1) { ambiguous.push(`стр. ${r.row} «${r.acode}»: код у нескольких моделей: ${c.map((m) => m.name).join(", ")}`); continue; }
    const e = perModel.get(c[0].id) ?? { m: c[0], prices: new Set<number>(), rows: [] };
    e.prices.add(r.price); e.rows.push(r);
    perModel.set(c[0].id, e);
  }
  const todo: { id: string; name: string; before: string | null; after: string }[] = [];
  const conflicts: string[] = [], multi: string[] = [], same: string[] = [];
  for (const e of perModel.values()) {
    if (e.prices.size > 1) { multi.push(`${e.m.name}: цен ${e.prices.size} (${[...e.prices].sort((a, b) => a - b).map(fmt).join(", ")}) — по цветам/размерам; sellingPrice не ставлю`); continue; }
    const p = [...e.prices][0];
    const cur = e.m.sellingPrice ? e.m.sellingPrice.toNumber() : null;
    if (cur === null) todo.push({ id: e.m.id, name: e.m.name, before: null, after: p.toFixed(2) });
    else if (Math.abs(cur - p) < 0.5) same.push(e.m.name);
    else conflicts.push(`${e.m.name}: в базе ${fmt(cur)}, в прайсе ${fmt(p)} — не перезаписываю`);
  }
  // Цены по цветам: расхождения у моделей, где sellingPrice уже стоит (для справки владельцу).
  const diffMulti: string[] = [];
  for (const e of perModel.values()) if (e.prices.size > 1 && e.m.sellingPrice) {
    const cur = e.m.sellingPrice.toNumber();
    diffMulti.push(`${e.m.name}: в базе ${fmt(cur)} ${e.prices.has(cur) ? "(есть среди цен прайса)" : "(в прайсе такой цены нет)"}`);
  }
  console.log(`\nСопоставлено моделей: ${perModel.size}; строк прайса сопоставлено ${rows.length - unmatched.length - ambiguous.length} из ${rows.length}`);
  console.log(`К установке sellingPrice (пусто → цена прайса, одна цена на всю модель): ${todo.length}`);
  todo.forEach((t) => console.log(`  + ${t.name}: ${fmt(Number(t.after))} ₽ с НДС`));
  console.log(`Уже равно прайсу: ${same.length}${same.length ? " — " + same.join(", ") : ""}`);
  for (const [t, l] of [["Расхождение с базой (не перезаписываю)", conflicts], ["Цены разные по цветам/размерам", multi], ["Модели с несколькими ценами, у которых в базе уже стоит одна цена", diffMulti], ["Не найдено в системе", unmatched], ["Неоднозначно", ambiguous]] as const) if (l.length) { console.log(`\n## ${t}`); l.forEach((s) => console.log("  - " + s)); }

  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (боевая: --apply --live)."); await prisma.$disconnect(); return; }
  const prev: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое внесение — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (isLive) backup();
  const cur = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: RETAIL_KEY } }, select: { value: true } });
  const value = {
    asOf: "2026-10-19", vatIncluded: true, vatRatePct: 22, source: "отчет по товарам фото и цены 2.xlsx, лист «Current Price»",
    rows: rows.filter((r) => r.modelCode && (byCode.get(r.modelCode)?.length ?? 0) === 1).map((r) => ({ acode: r.acode, color: r.color, size: r.size, price: r.price, modelCode: r.modelCode })),
  };
  const journal: Journal = { script: "apply-retail-prices-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, keyBefore: (cur?.value as unknown) ?? null, models: [] };
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: RETAIL_KEY } }, create: { organizationId: orgId, key: RETAIL_KEY, value }, update: { value } });
  for (const t of todo) {
    await prisma.productModel.update({ where: { id: t.id }, data: { sellingPrice: t.after } });
    journal.models.push(t);
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  }
  console.log(`\nЗаписано: прайс (${value.rows.length} строк) и sellingPrice у ${journal.models.length} моделей. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
