/**
 * Страж домена денег: решения «долг или переплата», допуск на округление и перенос переплат принимает src/domain/money.ts.
 * В экранах и витрине «Сырья» новые прямые пороги (OVERPAY_FROM, PAY_EPS, «< -0.5», overpayTarget) не появляются; прежние места — в списке
 * ниже (перенос на домен — следующий этап), их число не растёт.
 *   node --env-file=.env node_modules/.bin/tsx scripts/test-domain-guard.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/(app)/lots", "src/app/(app)/purchases", "src/app/(app)/analytics/raw", "src/components/level-tiles.tsx", "src/components/level-summary.tsx", "src/components/fur-selection-total.tsx", "src/lib/mart"];
const RX = /OVERPAY_FROM|PAY_EPS|overpayTarget\(|overpayLabel|< -0\.5|< -1\b/g;
const ALLOWED: Record<string, number> = {
  "src/app/(app)/lots/auction-view.tsx": 3,
  "src/app/(app)/lots/summary-view.tsx": 2,
  "src/app/(app)/purchases/actions.ts": 4,
  "src/app/(app)/purchases/purchases-tree.tsx": 3,
  "src/app/(app)/purchases/[id]/page.tsx": 3,
  "src/lib/mart/level-totals.ts": 1, // overpayTarget(...) подаётся в transferOverpay из домена
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
