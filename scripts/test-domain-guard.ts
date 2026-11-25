/**
 * Страж домена денег: решения «долг или переплата», допуск на округление и перенос переплат принимает src/domain/money.ts.
 * В экранах и витрине «Сырья» новые прямые пороги (OVERPAY_FROM, PAY_EPS, «< -0.5», overpayTarget) не появляются; прежние места — в списке
 * ниже (перенос на домен — следующий этап), их число не растёт.
 *   node --env-file=.env node_modules/.bin/tsx scripts/test-domain-guard.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/(app)/lots", "src/app/(app)/purchases", "src/app/(app)/analytics/raw", "src/components/level-tiles.tsx", "src/components/level-summary.tsx", "src/components/fur-selection-total.tsx", "src/components/_fur-selection-total", "src/lib/mart", "src/lib/dashboard-data.ts", "src/lib/payments-overview.ts", "src/app/(app)/payments", "src/app/(app)/dashboard"];
// Сравнение суммы с «0,5 ₽» руками — нельзя: isZero / isPositive / isNegative из домена. Остальное — пороги и перенос переплат.
const RX = /OVERPAY_FROM|PAY_EPS|overpayTarget\(|overpayLabel|< -0\.5|< -1\b|[<>]=? *0\.5\b/g;
// Прежние места (на 23.11.2026): числа не растут; их перенос на isZero/isPositive/isNegative и debtState — по мере правки файлов.
const ALLOWED: Record<string, number> = {
  "src/app/(app)/dashboard/pay-tiles.tsx": 1,
  "src/app/(app)/dashboard/_raw-block/raw-cards.tsx": 1, // вынесено из raw-block.tsx
  "src/app/(app)/dashboard/sales-block-table.tsx": 6,
  "src/app/(app)/lots/auction-view.tsx": 3,
  "src/app/(app)/lots/_auction-view/cost-breakdown.tsx": 1, // вынесено из auction-view.tsx
  "src/app/(app)/lots/contractor-hides/hides-view.tsx": 1,
  "src/app/(app)/lots/lining/[batch]/view.tsx": 1,
  "src/app/(app)/lots/summary-view.tsx": 2,
  "src/app/(app)/payments/actions.ts": 8,
  "src/app/(app)/payments/card-actions.ts": 3,
  "src/app/(app)/payments/client-date-detail.tsx": 2,
  "src/app/(app)/payments/client-payments-table.tsx": 1,
  // вынесено из payments/page.tsx (16): те же сравнения с PAY_EPS, плюс строки импорта PAY_EPS в каждом файле
  "src/app/(app)/payments/_page/suppliers-tab.tsx": 10,
  "src/app/(app)/payments/_page/supplier-tiles.tsx": 5,
  "src/app/(app)/payments/_page/auctions-table.tsx": 3,
  "src/app/(app)/payments/pay-actions.ts": 5,
  "src/app/(app)/payments/payment-lines.tsx": 1,
  "src/app/(app)/payments/payments-overview.tsx": 2,
  "src/app/(app)/payments/wizard-actions.ts": 3,
  "src/app/(app)/purchases/[id]/fallback-tiles.tsx": 3, // вынесено из page.tsx
  "src/app/(app)/purchases/_actions/payments.ts": 4, // вынесено из actions.ts
  "src/app/(app)/purchases/page.tsx": 4,
  "src/app/(app)/purchases/purchases-tree.tsx": 8,
  "src/components/_fur-selection-total/helpers.ts": 1, // вынесено из fur-selection-total.tsx
  "src/components/_fur-selection-total/table-cells.tsx": 1,
  "src/components/level-tiles.tsx": 3,
  "src/lib/dashboard-data.ts": 1,
  "src/lib/mart/build.ts": 1,
  "src/lib/mart/level-totals.ts": 1,
};

function walk(p: string, out: string[] = []): string[] {
  if (statSync(p).isFile()) { out.push(p); return out; }
  for (const n of readdirSync(p)) walk(join(p, n), out);
  return out;
}

let bad = 0;
for (const root of ROOTS) {
  for (const f of walk(root).filter((x) => /\.(ts|tsx)$/.test(x))) {
    const n = (readFileSync(f, "utf8").match(RX) ?? []).length;
    const allowed = ALLOWED[f] ?? 0;
    if (n > allowed) { bad++; console.log(`FAIL ${f}: порогов и переносов вне домена ${n}, допустимо ${allowed}`); }
  }
}
console.log(bad ? `\nНовых формул долга/переплаты вне src/domain/money.ts: ${bad}` : "OK: новых формул долга и переплаты вне домена денег нет");
process.exit(bad ? 1 : 0);
