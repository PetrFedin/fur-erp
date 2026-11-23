/**
 * Слои (этап 2 плана архитектуры): страницы, раскладки и компоненты не обращаются к базе напрямую — данные приходят из загрузчиков и
 * репозиториев в src/lib (и витрины src/lib/mart). Server actions и route.ts вправе читать и писать базу.
 * Прежние файлы (на 24.11.2026) перечислены ниже: список только сокращается — при правке страницы запрос выносится в src/lib и файл
 * удаляется из списка. Новый файл со `from "@/lib/prisma"` в странице или компоненте тест не пропустит.
 *   node --env-file=.env node_modules/.bin/tsx scripts/test-layer-guard.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const LEGACY = new Set<string>([
  "src/app/(app)/analytics/margin/page.tsx",
  "src/app/(app)/analytics/raw/lot/[id]/page.tsx",
  "src/app/(app)/analytics/raw/lot/[id]/plan-lot-card.tsx",
  "src/app/(app)/analytics/raw/page.tsx",
  "src/app/(app)/articles/page.tsx",
  "src/app/(app)/articles/supplier-view.tsx",
  "src/app/(app)/attention/page.tsx",
  "src/app/(app)/attention/unallocated-block.tsx",
  "src/app/(app)/budget/[id]/page.tsx",
  "src/app/(app)/budget/compare/page.tsx",
  "src/app/(app)/budget/page.tsx",
  "src/app/(app)/calendar/page.tsx",
  "src/app/(app)/chat/page.tsx",
  "src/app/(app)/clients/[id]/page.tsx",
  "src/app/(app)/clients/page.tsx",
  "src/app/(app)/data-check/page.tsx",
  "src/app/(app)/documents/analysis-section.tsx",
  "src/app/(app)/documents/page.tsx",
  "src/app/(app)/documents/todo-summary.tsx",
  "src/app/(app)/documents/ver-status.ts",
  "src/app/(app)/fittings/[id]/page.tsx",
  "src/app/(app)/fittings/new/page.tsx",
  "src/app/(app)/fittings/page.tsx",
  "src/app/(app)/history/comments/page.tsx",
  "src/app/(app)/history/page.tsx",
  "src/app/(app)/inbox/[id]/page.tsx",
  "src/app/(app)/inbox/page.tsx",
  "src/app/(app)/layout.tsx",
  "src/app/(app)/lots/auction-docs-pay.tsx",
  "src/app/(app)/lots/auction-view.tsx",
  "src/app/(app)/lots/lining/[batch]/page.tsx",
  "src/app/(app)/lots/page.tsx",
  "src/app/(app)/lots/summary-view.tsx",
  "src/app/(app)/materials/[id]/page.tsx",
  "src/app/(app)/materials/page.tsx",
  "src/app/(app)/models/[id]/page.tsx",
  "src/app/(app)/payments/[id]/page.tsx",
  "src/app/(app)/payments/client-debt-block.tsx",
  "src/app/(app)/payments/page.tsx",
  "src/app/(app)/plan/page.tsx",
  "src/app/(app)/plan/seasons/page.tsx",
  "src/app/(app)/production/[id]/page.tsx",
  "src/app/(app)/production/batches/[number]/page.tsx",
  "src/app/(app)/production/batches/page.tsx",
  "src/app/(app)/production/docs-pay.tsx",
  "src/app/(app)/production/new/page.tsx",
  "src/app/(app)/production/page.tsx",
  "src/app/(app)/purchases/[id]/page.tsx",
  "src/app/(app)/purchases/batch/page.tsx",
  "src/app/(app)/purchases/lining/new/page.tsx",
  "src/app/(app)/purchases/new/page.tsx",
  "src/app/(app)/purchases/page.tsx",
  "src/app/(app)/reconciliation/bridge.ts",
  "src/app/(app)/reconciliation/live.ts",
  "src/app/(app)/reconciliation/page.tsx",
  "src/app/(app)/repair/page.tsx",
  "src/app/(app)/sales/movement/page.tsx",
  "src/app/(app)/scheme/page.tsx",
  "src/app/(app)/settings/articles-ref/page.tsx",
  "src/app/(app)/settings/auctions/page.tsx",
  "src/app/(app)/settings/categories/page.tsx",
  "src/app/(app)/settings/channels/page.tsx",
  "src/app/(app)/settings/colors/page.tsx",
  "src/app/(app)/settings/contractors/[id]/page.tsx",
  "src/app/(app)/settings/contractors/page.tsx",
  "src/app/(app)/settings/expense-categories/page.tsx",
  "src/app/(app)/settings/fur-attrs/page.tsx",
  "src/app/(app)/settings/furs/page.tsx",
  "src/app/(app)/settings/import/page.tsx",
  "src/app/(app)/shipments/[id]/page.tsx",
  "src/app/(app)/shipments/page.tsx",
  "src/app/(app)/supplier/auction-calcs/[id]/page.tsx",
  "src/app/(app)/supplier/auction-calcs/compare-block.tsx",
  "src/app/(app)/supplier/auction-calcs/page.tsx",
  "src/app/(app)/supplier/calendar/page.tsx",
  "src/app/(app)/supplier/page.tsx",
  "src/app/(app)/supplier/raw/[purchaseId]/page.tsx",
  "src/app/(app)/supplier/raw/page.tsx",
  "src/app/(app)/supplier/tz/[id]/page.tsx",
  "src/app/(app)/supplier/tz/new/page.tsx",
  "src/app/(app)/supplier/tz/page.tsx",
  "src/app/(app)/suppliers/[id]/page.tsx",
  "src/app/(app)/suppliers/page.tsx",
  "src/app/(app)/supply-plan/page.tsx",
  "src/app/(app)/users/page.tsx",
  "src/app/(app)/verify/page.tsx",
  "src/app/(app)/verify/verify-block.tsx",
  "src/app/(app)/warehouses/[id]/page.tsx",
  "src/app/(app)/warehouses/page.tsx",
  "src/app/(print)/production/[id]/print/page.tsx",
  "src/app/(print)/production/batches/[number]/print/page.tsx",
  "src/components/comments/record-comments.tsx",
  "src/components/record-history.tsx",
  "src/components/role-switch-actions.ts",
]);

function walk(p: string, out: string[] = []): string[] {
  if (statSync(p).isFile()) { out.push(p); return out; }
  for (const n of readdirSync(p)) walk(join(p, n), out);
  return out;
}

const isActionOrRoute = (f: string, s: string) => /actions?\.tsx?$|-actions\.tsx?$|route\.ts$/.test(f) || /^["']use server["']/.test(s.trimStart());
let bad = 0, still = 0;
for (const f of [...walk("src/app"), ...walk("src/components")].filter((x) => /\.(ts|tsx)$/.test(x))) {
  const s = readFileSync(f, "utf8");
  if (!/from "@\/lib\/prisma"/.test(s) || isActionOrRoute(f, s)) continue;
  if (LEGACY.has(f)) { still++; continue; }
  bad++; console.log(`FAIL ${f}: страница или компонент обращается к базе напрямую — вынесите запрос в src/lib`);
}
// файл вынесли из списка — убираем его и из LEGACY (список должен сокращаться)
const stale = [...LEGACY].filter((f) => { try { return !/from "@\/lib\/prisma"/.test(readFileSync(f, "utf8")); } catch { return true; } });
for (const f of stale) console.log(`INFO ${f}: больше не обращается к базе напрямую — удалите из LEGACY`);
console.log(bad ? `\nНовых прямых обращений к базе из страниц и компонентов: ${bad}` : `OK: новых прямых обращений к базе из страниц и компонентов нет (прежних: ${still})`);
process.exit(bad ? 1 : 0);
