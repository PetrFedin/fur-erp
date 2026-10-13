/**
 * Справочник артикулов из файла системы продаж «АРТИКУЛА.xlsx» (лист «Лист3»: АРТИКУЛ, ДЛИННА, Article, Fabric, …).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/load-articles-sales-2026-10-13.ts [--apply] [--file путь.xlsx]
 *   … --rollback [--apply]   откат по журналу
 * По умолчанию — пробный прогон (ничего не пишет). --apply: перед записью scripts/backup.sh, журнал отката
 * docs-inventory/corrections-journal-articles-sales-2026-10-13.json, клиент с журналом изменений «script:load-articles-sales».
 *
 * Что делает (артикул = код до слэша, сравнение по articleKey: М/M, дефисы и регистр не важны):
 *   • код найден в справочнике → ПУСТОЕ salesCode заполняется кодом из файла (заполненное не трогаем); в aliases добавляются полные
 *     написания из колонки Article (если они не заняты другим артикулом); lengthClass = Short/Regular/Long, если во всех строках
 *     артикула длина одна; «NS» (без размера, аксессуары) = пусто; разные длины у одного артикула — НЕ гадаем, не пишем, печатаем в отчёт;
 *   • кода нет в справочнике → создаётся запись (isActive, без ТЗ) с теми же полями; сама по себе она в списках не мешает
 *     («Изделия» скрывают артикулы без ТЗ и остатка).
 * Название в продажах (salesName) файл не содержит — существующие не трогаем.
 */
import "./stubs/server-only-shim";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const fi = args.indexOf("--file");
const FILE = fi >= 0 ? args[fi + 1] : "/Users/petr/Downloads/АРТИКУЛА.xlsx";
const ROOT = path.join(__dirname, "..");
const JOURNAL = path.join(ROOT, "docs-inventory/corrections-journal-articles-sales-2026-10-13.json");
const norm = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const LEN = new Set(["Short", "Regular", "Long"]);

type J = { time: string; action: "update" | "create"; id: string; name: string; before?: Record<string, unknown>; after: Record<string, unknown>; rolledBack?: string };
const readJ = (): J[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { articleKey, spellingsOf } = await import("../src/lib/article-key");
  const prisma = createAuditedClient("script:load-articles-sales");
  const org = await prisma.organization.findFirstOrThrow();
  const orgId = org.id;

  if (ROLLBACK) {
    const j = readJ();
    let n = 0;
    for (const e of [...j].reverse()) {
      if (e.rolledBack) continue;
      console.log(`${e.action === "create" ? "удалить" : "вернуть"} ${e.name}`);
      if (APPLY) {
        if (e.action === "create") {
          const rel = await prisma.productionOrder.count({ where: { productModelId: e.id } });
          if (rel) { console.log("  есть ТЗ — не удаляю"); continue; }
          await prisma.productModel.deleteMany({ where: { id: e.id } });
        } else await prisma.productModel.update({ where: { id: e.id }, data: e.before as never });
        e.rolledBack = new Date().toISOString();
      }
      n++;
    }
    if (APPLY) writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
    console.log(APPLY ? `откат: ${n}` : `пробный прогон отката: ${n} (добавьте --apply)`);
    return;
  }

  const { parseTableFile } = await import("../src/lib/table-file");
  const table = await parseTableFile(readFileSync(FILE), FILE);
  const head = table[0].map((h) => h.trim());
  const col = (n: string) => head.findIndex((h) => h.toLowerCase() === n.toLowerCase());
  const iCode = col("АРТИКУЛ"), iLen = col("ДЛИННА"), iArt = col("Article");
  if (iCode < 0 || iLen < 0 || iArt < 0) throw new Error("нет колонок АРТИКУЛ / ДЛИННА / Article: " + head.join("|"));

  type G = { code: string; lens: Set<string>; arts: string[] };
  const groups = new Map<string, G>();
  for (const r of table.slice(1)) {
    const code = norm(r[iCode] ?? "");
    if (!code) continue;
    const k = articleKey(code);
    const g = groups.get(k) ?? { code, lens: new Set<string>(), arts: [] };
    g.lens.add(norm(r[iLen] ?? ""));
    const a = norm(r[iArt] ?? "");
    if (a && a.length <= 120 && !g.arts.includes(a)) g.arts.push(a);
    groups.set(k, g);
  }

  const models = await prisma.productModel.findMany({ where: { organizationId: orgId } });
  const byKey = new Map(models.map((m) => [articleKey(m.name), m]));
  const lite = models.map((m) => ({ id: m.id, name: m.name, sku: m.sku, category: m.category, salesCode: m.salesCode, salesName: m.salesName, aliases: m.aliases, isActive: m.isActive }));
  const taken = new Map<string, string>(); // ключ написания -> id владельца
  for (const a of lite) for (const sp of spellingsOf(a)) if (!taken.has(sp.key)) taken.set(sp.key, a.id);

  const journal: J[] = [];
  const conflicts: string[] = [], skipped: string[] = [];
  let upd = 0, crt = 0;
  for (const [k, g] of groups) {
    const lensReal = [...g.lens].filter((x) => x !== "NS" && x !== "");
    const bad = lensReal.filter((x) => !LEN.has(x));
    let length: string | null = null;
    if (bad.length) conflicts.push(`${g.code}: неизвестная длина ${bad.join(",")}`);
    else if (lensReal.length > 1) conflicts.push(`${g.code}: в строках разные длины (${[...g.lens].join(", ")}) — длина не записана`);
    else if (lensReal.length === 1 && g.lens.has("NS")) conflicts.push(`${g.code}: длина ${lensReal[0]} и NS в разных строках — длина не записана`);
    else if (lensReal.length === 1) length = lensReal[0];

    const cur = byKey.get(k);
    const owner = cur?.id ?? "new:" + k;
    const aliases = [...(cur?.aliases ?? [])];
    for (const a of g.arts) {
      const ak = articleKey(a);
      if (!ak || ak === articleKey(cur?.name ?? g.code)) continue;
      const o = taken.get(ak);
      if (o && o !== owner) { skipped.push(`${g.code}: написание «${a}» занято другим артикулом`); continue; }
      if (!aliases.some((x) => articleKey(x) === ak)) { aliases.push(a); taken.set(ak, owner); }
    }
    let salesCode = cur?.salesCode ?? null;
    if (!salesCode) {
      const o = taken.get(articleKey(g.code));
      if (o && o !== owner) skipped.push(`${g.code}: код продаж занят другим артикулом`);
      else { salesCode = g.code; taken.set(articleKey(g.code), owner); }
    }
    if (cur) {
      const data: Record<string, unknown> = {};
      if (salesCode !== cur.salesCode) data.salesCode = salesCode;
      if (aliases.length !== cur.aliases.length) data.aliases = aliases;
      if (length && cur.lengthClass !== length) data.lengthClass = length;
      if (!Object.keys(data).length) continue;
      const before = Object.fromEntries(Object.keys(data).map((f) => [f, (cur as Record<string, unknown>)[f]]));
      console.log(`обновить ${cur.name}:`, JSON.stringify(data));
      journal.push({ time: new Date().toISOString(), action: "update", id: cur.id, name: cur.name, before, after: data });
      upd++;
    } else {
      const data = { organizationId: orgId, name: g.code, salesCode, aliases, lengthClass: length, isActive: true };
      console.log(`создать ${g.code}:`, JSON.stringify({ salesCode, length, aliases: aliases.length }));
      journal.push({ time: new Date().toISOString(), action: "create", id: "", name: g.code, after: data });
      crt++;
    }
  }
  console.log(`\nартикулов в файле ${groups.size}; обновить ${upd}; создать ${crt}`);
  if (conflicts.length) console.log("\nНЕ ЗАПИСАНО (разные длины):\n  " + conflicts.join("\n  "));
  if (skipped.length) console.log("\nПРОПУЩЕНО:\n  " + skipped.join("\n  "));
  const inFile = new Set(groups.keys());
  console.log("\nВ справочнике, но не в файле (без кода продаж останутся пустыми): " + models.filter((m) => !inFile.has(articleKey(m.name))).map((m) => m.name).join(", "));

  if (!APPLY) { console.log("\nпробный прогон: ничего не записано (добавьте --apply)"); return; }
  execFileSync(path.join(__dirname, "backup.sh"), { stdio: "inherit" });
  const all = readJ();
  for (const e of journal) {
    if (e.action === "update") await prisma.productModel.update({ where: { id: e.id }, data: e.after as never });
    else { const m = await prisma.productModel.create({ data: e.after as never }); e.id = m.id; }
    all.push(e);
    writeFileSync(JOURNAL, JSON.stringify(all, null, 1));
  }
  console.log("записано:", journal.length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
