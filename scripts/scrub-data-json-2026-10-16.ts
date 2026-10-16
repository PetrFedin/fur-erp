/**
 * Очистка репозиторных данных src/data/*.json и src/lib/calc-presets.json от Google Диска и «MVST» (решения владельца от 16.10.2026).
 * Работает только с файлами репозитория (БД не трогает). Идемпотентно: повторный запуск ничего не меняет.
 *   npx tsx scripts/scrub-data-json-2026-10-16.ts           # пробный прогон: что изменится
 *   npx tsx scripts/scrub-data-json-2026-10-16.ts --apply   # записать файлы
 * Ключи, на которых что-то держится, не ломаем: fileId → внутренний ключ doc-… (та же уникальность), folderUrl/folderPath/drivePath — убираем.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { internalFileKey, residual, scrubNote } from "./lib/scrub-text";

const APPLY = process.argv.includes("--apply");
const ROOT = join(__dirname, "..");
const DROP_KEYS = new Set(["folderUrl", "folderPath", "drivePath", "path"]);
const KEY_KEYS = new Set(["fileId"]);
const report: string[] = [];

/** Дополнительные правила для JSON-текстов (формулировки реестра сверки). */
const JSON_RULES: [RegExp, string][] = [
  [/нет ни в Drive, ни в БД/g, "нет ни в документах, ни в БД"],
  [/глобальный поиск Drive/g, "глобальный поиск"],
  [/Глобальный поиск по Drive/g, "Глобальный поиск"],
  [/ в Drive/g, ""],
  [/в Drive /g, ""],
  [/ из Drive/g, ""],
  [/ по Drive/g, ""],
  [/Drive-версией реестра/g, "версией реестра"],
  [/Drive-версия реестра/g, "версия реестра"],
  [/Drive «мех»/g, "документов"],
  [/Google Drive «Мех»/g, "документов"],
  [/текущего Drive/g, "текущих документов"],
  [/современного Drive/g, "текущих документов"],
  [/расчётов Drive/g, "расчётов"],
  [/нового Drive/g, "документов"],
  [/Drive/g, "документах"],
];

function cleanString(s: string): string {
  let out = scrubNote(s);
  for (const [re, to] of JSON_RULES) out = out.replace(re, to);
  return out.replace(/ {2,}/g, " ").replace(/\s+([,.;:])/g, "$1");
}

function walk(v: unknown, path: string, key?: string): unknown {
  if (typeof v === "string") {
    if (key && KEY_KEYS.has(key) && /^[A-Za-z0-9_-]{25,}$/.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v)) return internalFileKey(v);
    return cleanString(v);
  }
  if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, key));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (DROP_KEYS.has(k) && typeof x === "string" && (k !== "path" || /^мех\//.test(x))) continue;
      if ((k === "drivePath" || k === "folderUrl") && x != null) continue;
      o[k] = walk(x, `${path}/${k}`, k);
    }
    return o;
  }
  return v;
}

function jsonDump(j: unknown, indent: number): string {
  return JSON.stringify(j, null, indent) + "\n";
}

function process_(rel: string, indent: number, tweak?: (j: Record<string, unknown>) => void) {
  const file = join(ROOT, rel);
  const text = readFileSync(file, "utf8");
  const j = JSON.parse(text);
  if (jsonDump(j, indent) !== text) { report.push(`${rel}: формат не совпал с JSON.stringify(…, null, ${indent}) — пропуск`); return; }
  const next = walk(j, "") as Record<string, unknown>;
  tweak?.(next);
  const out = jsonDump(next, indent);
  const left: string[] = [];
  const scan = (v: unknown, p: string) => {
    if (typeof v === "string") { const r = residual(v); if (r) left.push(`${p}: …${r}…`); }
    else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) scan(x, `${p}/${k}`);
  };
  scan(next, "");
  const changed = out !== text;
  report.push(`${rel}: ${changed ? "изменится" : "без изменений"}; остаточных упоминаний: ${left.length}`);
  for (const l of left.slice(0, 10)) report.push("   ! " + l);
  if (APPLY && changed) writeFileSync(file, out);
}

// reconciliation.json: журнал «перепроверки по Drive» — убираем пункты про структуру Диска целиком (правило В).
process_("src/data/reconciliation.json", 1, (j) => {
  const rc = j.recheck as { found?: string[]; notFound?: string[]; ownerDecisions?: string[] } | undefined;
  if (rc) {
    const dropRe = /fileId|папк[аеуи] «мех»|папок поставок|Drive|Google|проинвентаризирован|перепривязан/i;
    // пункты определяем по ИСХОДНОМУ тексту — но он уже очищен; поэтому отбрасываем по характерным оборотам Диска
    for (const k of ["found", "notFound", "ownerDecisions"] as const) {
      const before = rc[k] ?? [];
      rc[k] = before.filter((x) => !dropRe.test(x));
    }
  }
  const note = j.note as string | undefined;
  if (note) j.note = note.replace(/^Перепроверено ([\d.]+) по актуальной систематизированной структуре\s*[«"]?[^:]*: /, "Перепроверено $1 по документам: ");
});
process_("src/data/registry-coverage.json", 1);
process_("src/data/raw-audit-2026-02-09.json", 2, (j) => {
  const src = j.source as Record<string, unknown> | undefined;
  if (src) { delete src.fileId; delete src.drivePath; src.title = "Исторический контроль остатков сырья"; }
});
// Файлы с собственным форматированием — только точечные текстовые замены.
for (const [rel, pairs] of [
  ["src/data/lot-usd-sources.json", [["из расчётов Drive", "из расчётов"]]],
  ["src/lib/calc-presets.json", [["MVST", "THE FUR"]]],
] as const) {
  const file = join(ROOT, rel);
  const text = readFileSync(file, "utf8");
  let out = text;
  for (const [a, b] of pairs) out = out.split(a).join(b);
  report.push(`${rel}: ${out !== text ? "изменится" : "без изменений"}`);
  if (APPLY && out !== text) writeFileSync(file, out);
}

console.log(report.join("\n"));
console.log(APPLY ? "\nЗаписано." : "\nПробный прогон: файлы не менялись. Для записи — --apply.");
