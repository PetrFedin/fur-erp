// Для ДЕМО-сборки: файлы src/data/*.json и src/lib/data/article-tz-profile.json вшиваются в приложение при сборке и содержат
// реальные коммерческие данные (счета, документы Drive, цены лотов, профили артикулов). Эта команда заменяет их пустыми
// заготовками той же формы. Запускается в Dockerfile при DEMO_BUILD=true ИЛИ вручную перед `next build` демо-стенда.
// Меняет файлы в рабочей папке (для возврата: git checkout -- src/data src/lib/data).
import { readFileSync, writeFileSync } from "node:fs";

const FILES = ["src/data/drive-sync-snapshot.json", "src/data/lot-usd-sources.json", "src/data/raw-audit-2026-02-09.json", "src/data/reconciliation.json", "src/data/registry-coverage.json", "src/lib/data/article-tz-profile.json"];
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
  const src = JSON.parse(readFileSync(f, "utf8"));
  const out = f.endsWith("article-tz-profile.json") ? {} : emptify(src, 0);
  if ("checkedAt" in out) out.checkedAt = today;
  if ("registryDate" in out) out.registryDate = today;
  if ("note" in out) out.note = "Демонстрационные данные";
  if ("_comment" in out) out._comment = "Демо";
  writeFileSync(f, JSON.stringify(out, null, 1) + "\n");
  console.log("обезличен:", f);
}
