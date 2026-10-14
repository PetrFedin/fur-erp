/**
 * Заполнение пустых названий изделий (salesName) из описания артикула: у части артикулов в description лежит чистое
 * название из «Наименование Продукции» Word-ТЗ (приложение к договору подряда) — одна строка, без цен и каталога.
 * Ставит ТОЛЬКО в пустое salesName. Длины (АРТИКУЛА.xlsx, «NS» = не применимо) уже заполнены, спорный М057 (Regular и Short) не трогаем.
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал); --rollback --apply возвращает пустые названия.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fill-articles-2026-10-15.ts [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { supplierArticleTitle } from "../src/lib/supplier-article";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-articles-2026-10-15.json");
// Спорные описания — не ставим (в описании не название, а пояснение).
const SKIP = new Set(["MH17"]);

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:fill-articles");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string; name: string; newName: string }[];
    console.log(`откат: ${j.length}`);
    if (!APPLY) return console.log("пробный откат (--apply)");
    for (const r of j) await prisma.productModel.updateMany({ where: { id: r.id, salesName: r.newName }, data: { salesName: null } });
    return console.log("откат выполнен");
  }
  const ms = await prisma.productModel.findMany({ where: { OR: [{ category: null }, { category: { not: "Ремонт" } }] }, orderBy: { name: "asc" } });
  const todo: { id: string; name: string; newName: string }[] = [];
  console.log("артикул | поле | значение | источник");
  for (const m of ms) {
    if (m.salesName?.trim() || SKIP.has(m.name)) continue;
    const d = (m.description ?? "").trim();
    if (!d || d.includes("\n") || d.length > 80 || /^(Каталог|Цены)/i.test(d)) continue;
    const t = supplierArticleTitle(null, d);
    if (!t) continue;
    const newName = t.charAt(0).toUpperCase() + t.slice(1);
    todo.push({ id: m.id, name: m.name, newName });
    console.log(`${m.name} | salesName | ${newName} | описание артикула (наименование из Word-ТЗ)`);
  }
  console.log(`будет заполнено: ${todo.length}`);
  if (!APPLY) return console.log("пробный прогон (--apply)");
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  for (const t of todo) await prisma.productModel.updateMany({ where: { id: t.id, OR: [{ salesName: null }, { salesName: "" }] }, data: { salesName: t.newName } });
  const old = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : [];
  writeFileSync(JOURNAL, JSON.stringify([...old, ...todo], null, 2));
  console.log("применено, журнал:", JOURNAL);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
