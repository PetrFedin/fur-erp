/**
 * Сверка присланных файлов на 09.11 (продажи и остатки по 8 ноября включительно) с массивом:
 *   «заказ и продажи 09-11-2026.xlsx» ↔ текущая версия отчёта по размерам (sales-report-sizes) и витрина;
 *   «поступления и продажи 09-11-2026.xlsx» ↔ DmMovement и отчёт по (модель · цвет).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/compare-files-2026-11-09.ts
 */
import "./stubs/server-only-shim";
import { join } from "node:path";
import { homedir } from "node:os";
const DL = join(homedir(), "Downloads");
const REPORT = process.argv.find((a) => a.startsWith("--report="))?.slice(9) ?? join(DL, "заказ и продажи 09-11-2026.xlsx");
const SEASONS = ["FW25/26", "SS26", "FW26/27"] as const;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const f2 = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const db = createAuditedClient("script:compare-files");
  const { loadReportSizesState } = await import("../src/lib/import-keys");
  const { parseSizesWorkbook, sizeKey, withDupKeys } = await import("../src/lib/import-core");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(REPORT);
  const file = parseSizesWorkbook(wb);
  if (file.errors.length) { console.log("ОШИБКИ разбора:", file.errors); process.exit(1); }
  const cur = await loadReportSizesState(org, db);
  const val = cur!.value as { rows: { acode: string; color: string; size: string; seas?: Record<string, Record<string, number>>; sold?: number }[] };
  console.log(`Версия в базе: ${cur!.key}; строк в базе ${val.rows.length}, в файле ${file.rows.length}`);
  const dbMap = new Map(withDupKeys(val.rows, sizeKey).map((x) => [x.key, x.row]));
  const fMap = new Map(withDupKeys(file.rows, sizeKey).map((x) => [x.key, x.row]));
  const onlyDb = [...dbMap.keys()].filter((k) => !fMap.has(k));
  const onlyFile = [...fMap.keys()].filter((k) => !dbMap.has(k));
  console.log(`Только в базе: ${onlyDb.length}; только в файле: ${onlyFile.length}`);
  for (const k of onlyDb.slice(0, 15)) console.log("  [база]", k);
  for (const k of onlyFile.slice(0, 15)) console.log("  [файл]", k);
  const FIELDS = ["conf", "deliv", "confEur", "delivEur", "soldAll", "soldSsn", "soldOld", "rubAll", "discAll", "scAll"];
  let diffRows = 0; const diffByField: Record<string, number> = {}; const examples: string[] = [];
  for (const [k, fr] of fMap) {
    const dr = dbMap.get(k); if (!dr) continue;
    let rowDiff = false;
    for (const s of SEASONS) for (const fld of FIELDS) {
      const a = num(dr.seas?.[s]?.[fld]), b = num(fr.seas?.[s]?.[fld]);
      if (Math.abs(a - b) > 0.5) { rowDiff = true; diffByField[`${s}.${fld}`] = (diffByField[`${s}.${fld}`] ?? 0) + 1; if (examples.length < 25) examples.push(`${k} ${s}.${fld}: база ${f2(a)} / файл ${f2(b)}`); }
    }
    if (Math.abs(num(dr.sold) - num(fr.sold)) > 0.5) { rowDiff = true; diffByField["sold"] = (diffByField["sold"] ?? 0) + 1; if (examples.length < 25) examples.push(`${k} sold: база ${num(dr.sold)} / файл ${num(fr.sold)}`); }
    if (rowDiff) diffRows++;
  }
  console.log(`Строк с расхождением значений: ${diffRows}`, diffByField);
  for (const e of examples) console.log("  ", e);
  const tot = (rows: typeof val.rows, fld: string) => SEASONS.reduce((a, s) => a + rows.reduce((x, r) => x + num(r.seas?.[s]?.[fld]), 0), 0);
  for (const fld of ["conf", "deliv", "soldAll", "delivEur", "rubAll"]) console.log(`Итого ${fld}: база ${f2(tot(val.rows, fld))} · файл ${f2(tot(file.rows as typeof val.rows, fld))}`);

  // Файл поступлений/продаж ↔ отчёт по (артикул · цвет)
  const mov = await db.$queryRawUnsafe<{ model: string; color: string; kind: string; pcs: number }[]>(
    `SELECT split_part("colorKey", '|', 1) AS model, split_part("colorKey", '|', 2) AS color, kind, sum(pcs)::int AS pcs FROM "DmMovement" WHERE "organizationId" = '${org}' GROUP BY 1, 2, 3`);
  console.log("Виды движений:", [...new Set(mov.map((m) => m.kind))]);
  const dates = await db.$queryRawUnsafe<{ kind: string; mn: Date; mx: Date }[]>(`SELECT kind, min(date) mn, max(date) mx FROM "DmMovement" GROUP BY 1`);
  console.log("Даты файла:", dates.map((d) => `${d.kind}: ${d.mn.toISOString().slice(0, 10)} … ${d.mx.toISOString().slice(0, 10)}`));
  const sku = await db.$queryRawUnsafe<{ model: string; color: string; deliv: number; sold: number }[]>(`SELECT "modelCode" model, "colorCanon" color, sum(deliv)::int deliv, sum(sold)::int sold FROM "vDmStockSku" GROUP BY 1, 2`);
  const rep = new Map(sku.map((s) => [`${s.model}|${s.color}`, s]));
  const recv = new Map<string, number>(), sold = new Map<string, number>();
  for (const m of mov) { const k = `${m.model}|${m.color}`; const tgt = /поступ|receipt|recv|приход/i.test(m.kind) ? recv : sold; tgt.set(k, (tgt.get(k) ?? 0) + m.pcs); }
  const keys = new Set([...rep.keys(), ...recv.keys(), ...sold.keys()]);
  const out: string[] = [];
  for (const k of keys) {
    const r = rep.get(k); const a = recv.get(k) ?? 0, b = sold.get(k) ?? 0;
    const dd = (r?.deliv ?? 0) - a, ds = (r?.sold ?? 0) - b;
    if (dd !== 0 || ds !== 0) out.push(`${k}: отчёт получено ${r?.deliv ?? 0} / файл ${a} (Δ ${dd}); отчёт продано ${r?.sold ?? 0} / файл ${b} (Δ ${ds})`);
  }
  console.log(`Модель · цвет с расхождением отчёта и файла поступлений/продаж: ${out.length}`);
  for (const o of out) console.log("  ", o);
  process.exit(0);
})();
