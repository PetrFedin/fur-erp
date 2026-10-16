// Для ДЕМО-сборки: файлы src/data/*.json и src/lib/data/article-tz-profile.json вшиваются в приложение при сборке и содержат
// реальные коммерческие данные (счета, документы, цены лотов, профили артикулов). Эта команда заменяет их пустыми
// заготовками той же формы, а затем обезличивает зашитые в код реквизиты и тексты (demo-sanitize.mjs). Запускается в Dockerfile при DEMO_BUILD=true ИЛИ вручную перед `next build` демо-стенда.
// Меняет файлы в рабочей папке (для возврата: git checkout -- src/data src/lib/data).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeSources } from "./demo-sanitize.mjs";

// Корень рабочей копии: первый аргумент (для проверок) или текущая папка.
const ROOT = process.argv[2] ?? ".";

const FILES = ["src/data/lot-usd-sources.json", "src/data/raw-audit-2026-02-09.json", "src/data/reconciliation.json", "src/data/registry-coverage.json", "src/lib/data/article-tz-profile.json"];
const today = new Date().toISOString().slice(0, 10);

function emptify(v, depth) {
  if (Array.isArray(v)) return [];
  if (typeof v === "string") return "";
  if (typeof v === "number") return 0;
  if (typeof v === "boolean") return false;
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (depth >= 1 && keys.length > 8) return {};
    return Object.fromEntries(keys.map((k) => [k, emptify(v[k], depth + 1)]));
  }
  return v;
}

for (const f of FILES) {
  const src = JSON.parse(readFileSync(join(ROOT, f), "utf8"));
  const out = f.endsWith("article-tz-profile.json") ? {} : emptify(src, 0);
  if ("checkedAt" in out) out.checkedAt = today;
  if ("registryDate" in out) out.registryDate = today;
  if ("note" in out) out.note = "Демонстрационные данные";
  if ("_comment" in out) out._comment = "Демо";
  writeFileSync(join(ROOT, f), JSON.stringify(out, null, 1) + "\n");
  console.log("обезличен:", f);
}

// Дальше: реквизиты, фамилии, названия компаний, Word-шаблоны ТЗ, пресеты расчётов, каталог задач по долгу (см. demo-sanitize.mjs).
await sanitizeSources(ROOT);
