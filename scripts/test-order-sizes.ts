/**
 * Проверка единого разбора размеров ТЗ (src/lib/order-sizes.ts) на данных БД и на фиксированных примерах.
 *   node --env-file=.env node_modules/.bin/tsx scripts/test-order-sizes.ts
 */
import { PrismaClient } from "@prisma/client";
import { parseOrderSizes, parseOrderSizesDetailed, orderHasSize, collectOrderSizes, SINGLE_SIZE } from "../src/lib/order-sizes";

const prisma = new PrismaClient();
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${name}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`); }
};

eq("44, 46", parseOrderSizes("44, 46"), ["44", "46"]);
eq("повторы", parseOrderSizes("42, 42, 44, 44, 48, 48"), ["42", "44", "48"]);
eq("через пробел", parseOrderSizes("46 46 50"), ["46", "50"]);
eq("без пробелов", parseOrderSizes("57,57,58,58,59,59"), ["57", "58", "59"]);
eq("единый", parseOrderSizes("единый размер"), [SINGLE_SIZE]);
eq("Единый", parseOrderSizes("Единый размер"), [SINGLE_SIZE]);
eq("NS", parseOrderSizes("NS"), [SINGLE_SIZE]);
eq("58.58", parseOrderSizes("58.58"), ["58"]);
eq("перчатки", parseOrderSizes("6 6 6 7 7 7 8 8"), ["6", "7", "8"]);
eq("габариты", parseOrderSizes("165*24"), ["165*24"]);
eq("габариты 9,5", parseOrderSizes("165*9,5"), ["165*9,5"]);
eq("пусто", parseOrderSizes(null), []);
eq("фильтр 44 в «44, 46»", orderHasSize("44, 46", "44"), true);
eq("фильтр 46 в «44, 46»", orderHasSize("44, 46", "46"), true);
eq("фильтр 48 в «44, 46»", orderHasSize("44, 46", "48"), false);
eq("фильтр единый", orderHasSize("NS", SINGLE_SIZE), true);

async function main() {
  const orders = await prisma.productionOrder.findMany({ select: { number: true, size: true } });
  const kinds: Record<string, number> = {};
  const bad: string[] = [];
  const all: Array<string | null> = [];
  for (const o of orders) {
    const d = parseOrderSizesDetailed(o.size);
    kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    all.push(o.size);
    if (d.kind === "none") bad.push(`${o.number} «${o.size ?? ""}»`);
    if (d.kind === "sizes" && d.perUnit.length === 0) bad.push(`${o.number} пустой разбор`);
  }
  console.log(`ТЗ в БД: ${orders.length}`, kinds, "значения фильтра:", collectOrderSizes(all).join(" | "));
  if (bad.length) console.log("не разобраны:", bad.join("; "));
  // каждое ТЗ с числовым размером находится по каждому своему размеру
  let hits = 0;
  for (const o of orders) for (const s of parseOrderSizes(o.size)) { if (!orderHasSize(o.size, s)) { fail++; console.error("FAIL фильтр", o.number, s); } else hits++; }
  console.log(`проверок «ТЗ ↔ размер»: ${hits}`);
  if (fail) { console.error(`ошибок: ${fail}`); process.exitCode = 1; } else console.log("OK");
}
main().finally(() => prisma.$disconnect());
