// Таблица «ТЗ артикула и их состав» (карточка артикула): итог = сумма строк, всего по артикулу = сумма по ТЗ, равно плиткам с точностью до округления до рубля.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-article-tz-table.ts
// Только чтение. Код возврата 1 — при расхождениях.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadOrdersDrill } from "../src/lib/orders-drill";
import { buildTzTable, MONEY_COLS, roundKeepingSum } from "../src/lib/article-tz-table";
import { isRepair, sumOrders, sumTotal } from "../src/lib/orders-sum";
import type { DrillOrder } from "../src/lib/dashboard-drill";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what} ${extra}`); } };

(async () => {
  // само округление: сумма округлённых = округлённая сумма
  for (const v of [[0.5, 0.5, 0.5, 0.5], [1.2, 2.2, 3.2, 4.4], [-1.4, -2.4, 3.9], [10.49, 10.49, 10.49]]) ok(`roundKeepingSum ${v}`, roundKeepingSum(v).reduce((a, b) => a + b, 0) === Math.round(v.reduce((a, b) => a + b, 0)));

  const org = (await prisma.organization.findFirst())!.id;
  const all = await loadOrdersDrill(org, "all", "on");
  const byModel = new Map<string, DrillOrder[]>();
  for (const o of all) { if (isRepair(o)) continue; (byModel.get(o.mid) ?? byModel.set(o.mid, []).get(o.mid)!).push(o); }
  let maxDiff = 0, multi = 0;
  for (const os of byModel.values()) {
    if (os.length > 1) multi++;
    for (const vat of ["incl", "excl"] as const) {
      const t = buildTzTable(os, vat);
      const tag = `${os[0].ml} [${vat}]`;
      for (const c of MONEY_COLS) ok(`${tag}: Σ строк «${c}» = итог`, Math.abs(t.rows.reduce((a, r) => a + r[c], 0) - t.total[c]) < 0.005);
      ok(`${tag}: Σ итогов строк = итог`, Math.abs(t.rows.reduce((a, r) => a + r.total, 0) - t.total.total) < 0.005);
      ok(`${tag}: итог = сумма статей`, Math.abs(MONEY_COLS.reduce((a, c) => a + t.total[c], 0) - t.total.total) < 0.005);
      ok(`${tag}: изделий = Σ`, Math.abs(t.rows.reduce((a, r) => a + r.qty, 0) - t.total.qty) < 0.005);
      const s = sumOrders(os, vat);
      ok(`${tag}: изделий = плитке`, Math.abs(t.total.qty - s.qty) < 0.01 * os.length + 0.001);
      const d = Math.abs(t.total.total - sumTotal(s));
      maxDiff = Math.max(maxDiff, d);
      ok(`${tag}: итог ${t.total.total} vs плитки ${sumTotal(s).toFixed(2)}`, d <= 3, `(разница ${d.toFixed(2)})`);
      ok(`${tag}: нет NaN`, [...t.rows, t.total].every((r) => Object.values(r).every((v) => typeof v !== "number" || Number.isFinite(v))));
    }
  }
  console.log(`Артикулов: ${byModel.size} (с несколькими ТЗ: ${multi}); проверок: ${checks}; расхождений: ${fails}; макс. разница с плитками: ${maxDiff.toFixed(2)} ₽`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();
