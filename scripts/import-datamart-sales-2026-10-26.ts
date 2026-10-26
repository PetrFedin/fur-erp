/**
 * Продажи и поступления из витрины datamart (MOVofGoodsDynamic) → SalesReceiptLine. ПОКА ТОЛЬКО РАСЧЁТ: БД не меняется.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-datamart-sales-2026-10-26.ts [--dir=~/Downloads] [--out=/путь/отчёт.md]
 *
 * Источники (выгружены скриптами datamart-all.txt на VDI): sales_lines.csv, deliveries_lines.csv, orders_lines.csv (названия категорий KTT).
 * Что считает: сводки по заказам и «сезонным годам», сверку строка-в-строку с тем, что сейчас в разделе «Продажи», разбор по блокам / меху / категориям / длинам,
 * что не удалось сопоставить, и что сделала бы запись (сколько строк заменить).
 */
import Module from "module";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync } from "fs";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const DIR = process.argv.find((a) => a.startsWith("--dir="))?.slice(6) ?? join(homedir(), "Downloads");
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "";
const out: string[] = [];
const say = (s = "") => { console.log(s); out.push(s); };
const f2 = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const num = (s: string | undefined) => (s == null || s === "" ? 0 : Number(s));

type Row = Record<string, string>;
function readCsv(file: string): Row[] {
  const text = readFileSync(join(DIR, file), "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const split = (l: string) => { const o: string[] = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ";") { o.push(cur); cur = ""; } else cur += c; } o.push(cur); return o; };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => { const c = split(l); return Object.fromEntries(head.map((h, i) => [h, c[i] ?? ""])); });
}
const isoOf = (s: string) => { const m = /(\d\d)\/(\d\d)\/(\d{4})/.exec(s); return m ? `${m[3]}-${m[1]}-${m[2]}` : ""; };
const syear = (season: string) => (season === "FW 25/26" ? "2025" : season === "SS 2026" || season === "FW 26/27" ? "2026" : season);

// Уровни категорий по названию KTT (из уже загруженных строк системы; для отсутствующих — правило).
type Lv = { l2: string; l3: string; l4: string; l5: string | null };
const RULE: Record<string, Lv> = {
  "Косынка меховая": { l2: "Аксессуары", l3: "Головные уборы", l4: "Косынка", l5: "Косынка меховая" },
  "Манжеты": { l2: "Аксессуары", l3: "Перчатки (текстиль)", l4: "Манжеты", l5: null },
  "Муфта меховая": { l2: "Аксессуары", l3: "Перчатки (текстиль)", l4: "Муфта меховая", l5: null },
};
// Категория Budget PCS по названию KTT.
const PCS_CAT = (n: string): { block: "RTW" | "Acc"; cat: string } | null => {
  if (/^Шарф/.test(n)) return { block: "Acc", cat: "Шарфы" };
  if (/^Повязка/.test(n)) return { block: "Acc", cat: "Повязка меховая" };
  if (/^Шапка/.test(n)) return { block: "Acc", cat: "Шапка меховая" };
  if (/^Косынка/.test(n)) return { block: "Acc", cat: "Косынка" };
  if (/^(Варежки|Манжеты|Муфта)/.test(n)) return { block: "Acc", cat: "Манжеты, муфты, варежки" };
  if (/^(Шуба|Пальто|Полупальто)/.test(n)) return { block: "RTW", cat: "Шубы" };
  if (/^Жилет/.test(n)) return { block: "RTW", cat: "Жилет меховой" };
  if (/^Куртк/.test(n)) return { block: "RTW", cat: "Куртки меховые" };
  if (/^Кардиган/.test(n)) return { block: "RTW", cat: "Кардиган меховой" };
  if (/^(Пончо|Накидк)/.test(n)) return { block: "RTW", cat: "Накидки и пончо" };
  return null;
};
const FUR = (fabric: string) => { const { furTypeOfFabric } = require("../src/lib/sales-receipts-core") as typeof import("../src/lib/sales-receipts-core"); const f = furTypeOfFabric(fabric); return f === "SABLE" ? "Соболь" : f === "MINK" ? "Норка" : f === "SWAKARA" ? "Каракульча" : f === "FOX" ? "Лиса" : f === "LYNX" ? "Рысь" : f; };
const LEN: Record<string, string> = { "1612": "Short", "1317": "Long", "1876": "Regular" };

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { modelCodeOfArticle } = await import("../src/lib/sales-receipts-core");
  const prisma = new PrismaClient();
  const sales = readCsv("sales_lines.csv"), deliv = readCsv("deliveries_lines.csv"), orders = readCsv("orders_lines.csv");
  const kttName = new Map(orders.map((r) => [r.KTTID, r.KTTName]));
  const nameOf = (k: string) => kttName.get("KTT" + k.padStart(7, "0")) ?? `KTT${k}`;

  const db = await prisma.salesReceiptLine.findMany();
  const lv = new Map<string, Lv>();
  for (const r of db) { const n = r.level5 ?? r.level4; if (n && r.level2) lv.set(n, { l2: r.level2, l3: r.level3 ?? "", l4: r.level4 ?? "", l5: r.level5 }); }
  const lvOf = (n: string): { v: Lv | null; src: "система" | "правило" | "нет" } => (lv.has(n) ? { v: lv.get(n)!, src: "система" } : RULE[n] ? { v: RULE[n], src: "правило" } : { v: null, src: "нет" });

  say("# Расчёт загрузки продаж и поступлений из datamart (БД не менялась)");
  say(`Дата расчёта: ${new Date().toISOString().slice(0, 16).replace("T", " ")} · источник: ${DIR}`);
  say();

  // ---- 1. Сводка по заказам: база vs система
  say("## 1. По заказам: база (datamart) и то, что сейчас в разделе «Продажи»");
  say("| вид | заказ | сезон | datamart: строк / шт. / EUR без НДС | система: строк / шт. / EUR без НДС |");
  say("|---|---|---|---|---|");
  const agg = <T,>(rows: T[], key: (r: T) => string, pcs: (r: T) => number, eur: (r: T) => number) => { const m = new Map<string, [number, number, number]>(); for (const r of rows) { const a = m.get(key(r)) ?? [0, 0, 0]; a[0]++; a[1] += pcs(r); a[2] += eur(r); m.set(key(r), a); } return m; };
  const dmS = agg(sales, (r) => `SALE|${r.OrderNumber}|${r.SeasonName}`, (r) => num(r.Qty), (r) => num(r.SalesRetailEURwoVAT));
  const dmR = agg(deliv, (r) => `RECEIPT|${r.OrderNumber}|?`, (r) => num(r.DeliveryPCS), () => 0);
  const sysA = agg(db, (r) => `${r.kind}|${r.orderNo}|${r.season}`, (r) => r.pcs ?? 0, (r) => Number(r.retailEurExVat ?? 0));
  const allKeys = [...new Set([...dmS.keys(), ...dmR.keys(), ...sysA.keys()])].sort();
  for (const k of allKeys) {
    const [kind, ord, sea] = k.split("|");
    const d = dmS.get(k) ?? (kind === "RECEIPT" ? dmR.get(`RECEIPT|${ord}|?`) : undefined);
    const sysKey = kind === "RECEIPT" ? [...sysA.keys()].find((x) => x.startsWith(`RECEIPT|${ord}|`)) : k;
    const s = sysKey ? sysA.get(sysKey) : undefined;
    if (kind === "RECEIPT" && sea !== "?") continue;
    say(`| ${kind === "SALE" ? "продажи" : "поступления"} | ${ord} | ${sea === "?" ? sysKey?.split("|")[2] ?? "" : sea} | ${d ? `${d[0]} / ${f2(d[1])} / ${f2(d[2])}` : "—"} | ${s ? `${s[0]} / ${f2(s[1])} / ${f2(s[2])}` : "—"} |`);
  }
  const tot = (rows: [number, number, number][]) => rows.reduce((a, r) => [a[0] + r[0], a[1] + r[1], a[2] + r[2]], [0, 0, 0]);
  const dmSt = tot([...dmS.values()]), sysSt = tot([...sysA.entries()].filter(([k]) => k.startsWith("SALE")).map(([, v]) => v));
  const dmRt = tot([...dmR.values()]), sysRt = tot([...sysA.entries()].filter(([k]) => k.startsWith("RECEIPT")).map(([, v]) => v));
  say(`\nИтого продажи: datamart ${dmSt[0]} строк, ${f2(dmSt[1])} шт., ${f2(dmSt[2])} EUR без НДС · система ${sysSt[0]} строк, ${f2(sysSt[1])} шт., ${f2(sysSt[2])} EUR.`);
  say(`Итого поступления: datamart ${dmRt[0]} строк, ${f2(dmRt[1])} шт. · система ${sysRt[0]} строк, ${f2(sysRt[1])} шт.`);

  // ---- 2. Блок × «сезонный год»
  say("\n## 2. Блок и «сезонный год» файла MVST (2025 = FW 25/26, 2026 = SS 2026 + FW 26/27), продажи");
  say("| год | блок | шт. | EUR без НДС | EUR с НДС |");
  say("|---|---|---|---|---|");
  const blockOf = (n: string) => PCS_CAT(n)?.block ?? "RTW";
  const g2 = new Map<string, [number, number, number]>();
  for (const r of sales) { const k = `${syear(r.SeasonName)}|${blockOf(nameOf(r.KTTKey)) === "Acc" ? "Аксессуары" : "Одежда"}`; const a = g2.get(k) ?? [0, 0, 0]; a[0] += num(r.Qty); a[1] += num(r.SalesRetailEURwoVAT); a[2] += num(r.SalesRetailEUR); g2.set(k, a); }
  for (const [k, v] of [...g2.entries()].sort()) say(`| ${k.split("|")[0]} | ${k.split("|")[1]} | ${f2(v[0])} | ${f2(v[1])} | ${f2(v[2])} |`);

  // ---- 3. Тип меха × категория × длина
  say("\n## 3. Продажи по типу меха, категории и длине (все 5 заказов)");
  say("| блок | мех | категория | длина | шт. | EUR без НДС |");
  say("|---|---|---|---|---|---|");
  const g3 = new Map<string, [number, number]>();
  const unmappedCat = new Map<string, number>();
  for (const r of sales) {
    const n = nameOf(r.KTTKey), c = PCS_CAT(n);
    if (!c) { unmappedCat.set(n, (unmappedCat.get(n) ?? 0) + num(r.Qty)); }
    const len = c?.block === "RTW" ? LEN[r.LengthID] ?? "—" : "—";
    const k = `${c?.block ?? "?"}|${FUR(r.Fabric)}|${c?.cat ?? n}|${len}`;
    const a = g3.get(k) ?? [0, 0]; a[0] += num(r.Qty); a[1] += num(r.SalesRetailEURwoVAT); g3.set(k, a);
  }
  for (const [k, v] of [...g3.entries()].sort()) { const p = k.split("|"); say(`| ${p[0] === "RTW" ? "Одежда" : p[0] === "Acc" ? "Аксессуары" : "?"} | ${p[1]} | ${p[2]} | ${p[3]} | ${f2(v[0])} | ${f2(v[1])} |`); }
  if (unmappedCat.size) say(`\nКатегории без соответствия в Budget PCS: ${[...unmappedCat.entries()].map(([k, v]) => `${k} (${v} шт.)`).join(", ")}`);

  // ---- 4. Сопоставление строк с системой (без учёта номера заказа)
  say("\n## 4. Строки продаж: совпадение с системой");
  const norm = (a: string) => a.toUpperCase().replace(/[^A-Z0-9А-Я]/g, "");
  const keyOf = (art: string, color: string, iso: string, pcs: number) => `${norm(art)}|${norm(color)}|${iso}|${pcs}`;
  const sysSale = db.filter((r) => r.kind === "SALE");
  const sm = new Map<string, number>(); for (const r of sysSale) { const k = keyOf(r.article, r.colorId ?? "", r.date.toISOString().slice(0, 10), r.pcs ?? 0); sm.set(k, (sm.get(k) ?? 0) + 1); }
  let match = 0; const onlyDm: string[] = [];
  for (const r of sales) { const k = keyOf(r.Article, r.ColorID, isoOf(r.SalesDate), num(r.Qty)); if ((sm.get(k) ?? 0) > 0) { match++; sm.set(k, sm.get(k)! - 1); } else onlyDm.push(`${r.OrderNumber} ${isoOf(r.SalesDate)} ${r.Article} ${r.ColorID} ${num(r.Qty)} шт. ${f2(num(r.SalesRetailEURwoVAT))} EUR`); }
  const onlySys = [...sm.entries()].filter(([, n]) => n > 0).reduce((s, [, n]) => s + n, 0);
  say(`Строк в datamart ${sales.length}; совпало с системой по «артикул + цвет + дата + штуки» ${match}; только в datamart ${onlyDm.length}; только в системе ${onlySys} (из ${sysSale.length}).`);
  say("Только в datamart (первые 25):"); onlyDm.slice(0, 25).forEach((s) => say("  - " + s));

  // ---- 5. Поступления: совпадение
  say("\n## 5. Строки поступлений: совпадение с системой");
  const sysRec = db.filter((r) => r.kind === "RECEIPT");
  const rm = new Map<string, number>(); for (const r of sysRec) { const k = `${norm(r.article)}|${norm(r.colorId ?? "")}`; rm.set(k, (rm.get(k) ?? 0) + (r.pcs ?? 0)); }
  const dr = new Map<string, number>(); for (const r of deliv) { const k = `${norm(r.Article)}|${norm(r.ColorID)}`; dr.set(k, (dr.get(k) ?? 0) + num(r.DeliveryPCS)); }
  let same = 0, diff = 0; const diffs: string[] = [];
  for (const k of new Set([...rm.keys(), ...dr.keys()])) { const a = rm.get(k) ?? 0, b = dr.get(k) ?? 0; if (a === b) same++; else { diff++; diffs.push(`${k}: система ${a} / datamart ${b}`); } }
  say(`По связке «артикул + цвет»: совпадает ${same}, различается ${diff}. Примеры различий (до 20):`); diffs.slice(0, 20).forEach((s) => say("  - " + s));

  // ---- 6. Уровни категорий и модельные коды
  say("\n## 6. Названия категорий (KTT) и уровни в системе");
  const names = new Map<string, number>(); for (const r of sales) names.set(nameOf(r.KTTKey), (names.get(nameOf(r.KTTKey)) ?? 0) + num(r.Qty));
  for (const [n, q] of [...names.entries()].sort((a, b) => b[1] - a[1])) { const l = lvOf(n); say(`- ${n}: ${q} шт. → ${l.v ? `${l.v.l2} / ${l.v.l3} / ${l.v.l4}${l.v.l5 ? " / " + l.v.l5 : ""} (${l.src})` : "НЕТ соответствия — понадобится решение"}`); }
  const codes = new Set(sales.map((r) => modelCodeOfArticle(r.Article)));
  say(`Модельные коды из артикулов: ${[...codes].filter(Boolean).slice(0, 40).join(", ")}`);

  // ---- 7. Что сделала бы запись
  const tags = new Map<string, number>(); for (const r of db) tags.set(r.importTag, (tags.get(r.importTag) ?? 0) + 1);
  say("\n## 7. Что сделает запись (пока не выполнялась)");
  say(`В базе сейчас строк: ${db.length}, по меткам импорта: ${[...tags.entries()].map(([k, v]) => `${k}: ${v}`).join(", ")}.`);
  say(`Новая загрузка из datamart: продажи ${sales.length} строк (${f2(dmSt[1])} шт.), поступления ${deliv.length} строк (${f2(dmRt[1])} шт.).`);
  say("Порядок записи: резервная копия базы (scripts/backup.sh) → выгрузка старых строк в журнал → замена одной транзакцией с контролем итогов → откат одной командой.");
  say("Не загружается из datamart: скидка (в выгрузке нет столбца); поля скидки в новых строках останутся пустыми.");

  if (OUT) { writeFileSync(OUT, out.join("\n")); console.log(`\nОтчёт записан: ${OUT}`); }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
