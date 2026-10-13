// Проверки мастера «Новая закупка»: раскладка расходов (Σ по лотам = введённому), проверка ввода и сумма счёта,
// подписи строк расчёта → сектора состава цены (Σ секторов = цена лота). Только чтение базы (справочники).
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-batch-wizard.ts
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadIntakeRefs, planBatch } from "../src/lib/batch-intake-server";
import { EMPTY_EXPENSES, spreadExpenses, compositionOf, type BatchExpenses } from "../src/lib/batch-expenses";
import { EMPTY_ROW, itemsOf, validateRows, type BatchPayload, type IntakeRow } from "../src/lib/batch-intake";
import { COMP_CATS, lotComposition } from "../src/lib/price-composition";
import { planExpenseLines } from "../src/lib/plan-expenses";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what} ${extra}`); } };
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const refs = await loadIntakeRefs(prisma, org);
  const mat = refs.materials[0].name;
  const sup = refs.suppliers[0].id;
  const mk = (n: number, lot: string, qty: string, price: string, extra: Partial<IntakeRow> = {}): IntakeRow => ({ ...EMPTY_ROW, n, lot, material: mat, qty, price, ...extra });
  const rows = [mk(1, "T1", "100", "390"), mk(2, "T2", "48,5", "250"), mk(3, "T3", "60", "120,37"), mk(4, "T4", "13", "1500")];
  const rate = 80.1234;
  const e: BatchExpenses = { ...EMPTY_EXPENSES, fee: "7,35", broker: "9000", brokerMode: "rub", dressing: "221000,55", transport: "44200", customs: "110500,33", transit: "22100", other: "11050,07" };

  // 1. раскладка: Σ по лотам = введённое (обе базы деления)
  for (const base of ["qty", "value"] as const) {
    const res = spreadExpenses(rows, rate, { ...e, base });
    const sp = res.spread;
    ok(`[${base}] выделка Σ`, near(sp.dressing, 221000.55), String(sp.dressing));
    ok(`[${base}] транспорт Σ`, near(sp.transport, 44200), String(sp.transport));
    ok(`[${base}] таможня Σ`, near(sp.customs, 110500.33), String(sp.customs));
    ok(`[${base}] упаковка Σ`, near(sp.packing, 11050.07), String(sp.packing));
    ok(`[${base}] транзит Σ`, near(sp.transit, 22100), String(sp.transit));
    const filled = rows.map((r) => ({ ...r, ...res.patch.get(r.n)! }));
    const comp = compositionOf(filled, { rate, currency: "USD", vatDefault: 22, pct: res.pct });
    ok(`[${base}] брокерский ₽ Σ`, near(comp.broker, 9000, 0.5), String(comp.broker));
    ok(`[${base}] Σ линий = итог`, near(comp.goods + comp.fee + comp.feeVat + comp.goodsVat + comp.dressing + comp.transport + comp.customs + comp.packing + comp.broker + comp.transit, comp.totalIncl, 0.01));
    // позиции → costPlan → сектора
    const validation = validateRows(filled, { currency: "USD", vatDefault: 22, materials: refs.materials.map((m) => ({ id: m.id, name: m.name })), colors: [], existingLots: new Map(), rate, pctCols: res.pct }, { fur: {}, color: {} });
    ok(`[${base}] строки без ошибок`, validation.errorCount === 0, JSON.stringify(validation.checks.map((c) => c.errors)));
    const items = itemsOf(filled, validation.checks, { vatDefault: 22, rate, currency: "USD", pctCols: res.pct, serviceVatPct: 22 });
    let sumTotal = 0;
    for (const it of items) {
      const cp = it.costPlan!;
      const total = Number(cp.unitCostInclVat) * it.quantity;
      sumTotal += total;
      const c = lotComposition({ breakdown: null, plans: [cp], vatRate: it.vatRate, qty: it.quantity, totalIncl: total })!;
      const s = COMP_CATS.reduce((a, k) => a + c.incl[k.key], 0);
      ok(`[${base}] лот ${it.lot}: Σ секторов = цена лота`, near(s, total, 0.01), `${s} ≠ ${total}`);
      ok(`[${base}] лот ${it.lot}: нет нераспознанных строк`, c.unused.length === 0, c.unused.join(","));
      ok(`[${base}] лот ${it.lot}: таможня в «Транспорт и таможня»`, c.incl.transport > 0 && c.pack > 0 && c.incl.fx > 0, JSON.stringify(c.incl));
    }
    ok(`[${base}] Σ лотов = итог мастера`, near(sumTotal, comp.totalIncl, 0.5), `${sumTotal} ≠ ${comp.totalIncl}`);
    const pl = planExpenseLines(items.map((i) => ({ quantity: i.quantity, vatRate: i.vatRate, costPlan: i.costPlan })));
    const byKey = Object.fromEntries(pl.lines.map((l) => [l.key, l.incl]));
    ok(`[${base}] блок «Расходы»: таможня`, near(byKey.customs ?? 0, 110500.33, 0.05), String(byKey.customs));
    ok(`[${base}] блок «Расходы»: упаковка`, near(byKey.packing ?? 0, 11050.07, 0.05), String(byKey.packing));
    ok(`[${base}] блок «Расходы»: выделка`, near(byKey.dressing ?? 0, 221000.55, 0.05), String(byKey.dressing));
  }

  // 2. проверка ввода (серверный planBatch)
  const header = { auctionId: refs.auctions[0].id, newAuction: null, supplierId: sup, warehouseId: "", orderDate: "2026-06-01", currency: "USD", exchangeRate: "80", vatDefault: "22", invoiceNumber: "", receiveNow: false, notes: "" };
  const pay = (rs: IntakeRow[], h: Partial<typeof header> & { invoiceAmount?: string; serviceVat?: string } = {}): BatchPayload => ({ key: "k".repeat(10), header: { ...header, ...h }, rows: rs, decisions: { fur: {}, color: {} }, pct: {}, docs: [], ackMismatch: false });
  const blocking = (rs: IntakeRow[], h = {}) => planBatch(pay(rs, h), refs, 0).preview;
  const errs = (rs: IntakeRow[], h = {}) => { const p = blocking(rs, h); return [...p.blocking, ...p.validation.checks.flatMap((c) => c.errors)].join(" | "); };
  ok("количество 0", /количество/.test(errs([mk(1, "A1", "0", "10")])));
  ok("цена < 0", /отрицательн/.test(errs([mk(1, "A1", "1", "-5")])));
  ok("НДС 120", /от 0 до 100/.test(errs([mk(1, "A1", "1", "5", { vat: "120" })])));
  ok("курс 0", /курс/i.test(errs([mk(1, "A1", "1", "5")], { exchangeRate: "0" })));
  ok("дата в будущем при приёмке", /в будущем/.test(errs([mk(1, "A1", "1", "5")], { orderDate: "2999-01-01", receiveNow: true })));
  ok("дата в будущем без приёмки — можно", !/в будущем/.test(errs([mk(1, "A1", "1", "5")], { orderDate: "2999-01-01", receiveNow: false })));
  ok("дубль лота", /повторяется/.test(errs([mk(1, "A1", "1", "5"), mk(2, "A1", "1", "5")])));
  ok("отрицательный расход в строке", /отрицательн/.test(errs([mk(1, "A1", "1", "5", { dressing: "-1" })])));
  ok("расход не число", /не число/.test(errs([mk(1, "A1", "1", "5", { customs: "abc" })])));
  const okRows = [mk(1, "A1", "10", "100"), mk(2, "A2", "5", "200")];
  const base0 = blocking(okRows);
  ok("корректный ввод — без блокировок", base0.blocking.length === 0, base0.blocking.join("|"));
  const tot = base0.totals.inclVat;
  const good = blocking(okRows, { invoiceAmount: String(tot).replace(".", ",") });
  ok("сумма счёта = Σ — предупреждения нет", good.mismatchDocs === 0 && good.docs.length === 1 && good.docs[0].recon?.ok === true, JSON.stringify(good.docs));
  const bad = blocking(okRows, { invoiceAmount: String(tot + 1000) });
  ok("сумма счёта ≠ Σ — предупреждение", bad.mismatchDocs === 1, JSON.stringify(bad.docs.map((d) => d.recon?.message)));
  ok("сумма счёта — мусор: блок", /Сумма счёта/.test(blocking(okRows, { invoiceAmount: "abc" }).blocking.join("|")));
  ok("НДС на сборы 150: блок", /НДС на сборы/.test(blocking(okRows, { serviceVat: "150" }).blocking.join("|")));

  console.log(fails === 0 ? `Мастер «Новая закупка»: проверок ${checks}, расхождений 0` : `Мастер «Новая закупка»: проверок ${checks}, расхождений ${fails}`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();
