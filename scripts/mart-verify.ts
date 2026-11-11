/* Сверка представлений массива с эталонами владельца: экраны и отчёты читают только их.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/mart-verify.ts */
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
type R = Record<string, unknown>;
const q = <T = R>(s: string) => db.$queryRawUnsafe<T[]>(s);
let bad = 0;
const check = (label: string, got: number, want: number) => { const ok = Math.abs(got - want) < 1; if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${got.toLocaleString("ru-RU")}${ok ? "" : ` (ожидалось ${want.toLocaleString("ru-RU")})`}`); };
(async () => {
  const { MART_EXPECTED } = await import("../src/lib/mart/build");
  const [t] = await q<{ conf: string; deliv: string; sold_season: string }>(`SELECT sum(conf)::text conf, sum(deliv)::text deliv, sum(sold_all)::text sold_season FROM "vDmSeasonTotals"`);
  check("Заказано", Number(t.conf), MART_EXPECTED.ordered);
  check("Получено", Number(t.deliv), MART_EXPECTED.received);
  check("Продано (всего по сезонам)", Number(t.sold_season), MART_EXPECTED.sold);
  const [s] = await q<{ stock: string; retail: string; shown: string }>(`SELECT sum(stock)::text stock, sum("stockRetailRub")::text retail, sum(stock_shown)::text shown FROM "vDmStockSku"`);
  check("Остаток (получено − продано)", Number(s.stock), MART_EXPECTED.stock);
  check("Остаток по прайсу, ₽", Number(s.retail), MART_EXPECTED.stockRetailRub);
  const [m] = await q<{ stock: string }>(`SELECT sum(stock)::text stock FROM "vDmStockModel"`);
  check("Остаток по моделям = по изделиям", Number(m.stock), Number(s.stock));
  const [c] = await q<{ a: string; b: string }>(`SELECT (SELECT sum(material_rub) FROM "vDmOrderCost")::text a, (SELECT sum("totalCost") FROM "DmLotUse")::text b`);
  check("Материалы по ТЗ = расход лотов", Number(c.a), Number(c.b));
  const [lp] = await q<{ a: string; b: string }>(`SELECT (SELECT sum("lotsCostSum") FROM "vDmPurchaseChain")::text a, (SELECT sum("totalCost") FROM "DmLot" WHERE "purchaseId" IS NOT NULL)::text b`);
  check("Лоты по закупкам = лоты", Number(lp.a), Number(lp.b));
  const [pp] = await q<{ a: string; b: string }>(`SELECT (SELECT sum(coalesce(paid,0)+coalesce(pending,0)) FROM "vDmPaymentsBySupplier")::text a, (SELECT sum(amount) FROM "DmPayment")::text b`);
  check("Платежи по контрагентам = платежи", Number(pp.a), Number(pp.b));
  console.log(bad ? `\nРасхождений: ${bad}` : "\nВсе представления сходятся с эталонами");
  process.exitCode = bad ? 2 : 0;
})().finally(() => db.$disconnect());
