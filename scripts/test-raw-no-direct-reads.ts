/**
 * Страж: экраны раздела «Сырьё» не должны читать основные таблицы (лоты, позиции, движения, списания, платежи) для цифр —
 * цифры берутся из витрины (src/lib/mart). Ниже — прежние чтения, оставленные осознанно (карточки лота и закупки, формы, списки для
 * выбора, документы); их число не должно расти. Новое чтение — либо в витрину, либо сюда с причиной.
 *   node --env-file=.env node_modules/.bin/tsx scripts/test-raw-no-direct-reads.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/(app)/lots", "src/app/(app)/purchases", "src/app/(app)/analytics/raw"];
const RX = /prisma\.(rawMaterialLot|purchaseItem|stockMovement|productionMaterialUsage|payment)\.(findMany|findFirst|aggregate|groupBy|count)\b/g;
// файл → допустимое число прямых чтений (на 23.11.2026)
const ALLOWED: Record<string, number> = {
  "src/app/(app)/lots/auction-view.tsx": 1, // платежи для блока документов и оплат аукциона
  "src/app/(app)/lots/page.tsx": 1, // позиции закупок для выбора вкладки по ссылке ?auction=
  "src/app/(app)/purchases/lining/new/page.tsx": 1, // список тканей для формы
  "src/app/(app)/purchases/page.tsx": 1, // размеры лотов для фильтра
  "src/app/(app)/purchases/new/page.tsx": 1, // лоты для формы
  "src/app/(app)/purchases/[id]/page.tsx": 3, // карточка закупки: лоты, списания, остатки
  "src/app/(app)/analytics/raw/lot/[id]/plan-lot-card.tsx": 1,
  "src/app/(app)/analytics/raw/lot/[id]/page.tsx": 3, // карточка лота
};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/(^|\/)(actions|[a-z-]+-actions)\.ts$/.test(n)) out.push(p);
  }
  return out;
}

let bad = 0;
for (const root of ROOTS) {
  for (const f of walk(root)) {
    const n = (readFileSync(f, "utf8").match(RX) ?? []).length;
    const allowed = ALLOWED[f] ?? 0;
    if (n > allowed) { bad++; console.log(`FAIL ${f}: прямых чтений ${n}, допустимо ${allowed}`); }
  }
}
console.log(bad ? `\nНовых прямых чтений основных таблиц: ${bad}. Цифры берите из витрины (src/lib/mart).` : "OK: новых прямых чтений основных таблиц в «Сырье» нет");
process.exit(bad ? 1 : 0);
