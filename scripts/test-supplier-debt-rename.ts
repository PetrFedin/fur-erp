/**
 * Долг поставщику по частям не зависит от написания названий аукционов (только чтение, базу не меняет):
 *   node --env-file=.env node_modules/.bin/tsx scripts/test-supplier-debt-rename.ts
 * Берёт реальные данные, считает долг, затем в памяти «переименовывает» аукционы (прежнее написание → короткое имя из
 * справочника, а также произвольное новое имя при условии, что прежнее остаётся алиасом) и считает снова.
 * Ожидание: общий долг, три части (получено / счёт выставлен / ожидаемое) и разбивка по аукционам совпадают.
 */
import Module from "module";
import { join } from "path";
import assert from "node:assert/strict";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return origResolve.call(this, req, ...rest);
};

const EXPECTED_DEBT = "186691785.22"; // долг на момент создания справочника (все годы)

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { computeSupplierDebt, loadDebtInputs, findInvoice, INVOICES_FOR_DRAFTS } = await import("../src/lib/supplier-debt");
  const { findAuctionIn } = await import("../src/lib/auction-ref-core");
  const { replaceFirstLine } = await import("../src/lib/auction-key");
  const { SEED_AUCTIONS } = await import("./auction-seed-data");
  type Lite = { id: string; name: string; aliases: string[]; isService: boolean; confirmed: boolean };

  const prisma = new PrismaClient();
  let fails = 0;
  const ok = (c: boolean, m: string) => { console.log(`${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
  try {
    const org = (await prisma.organization.findFirstOrThrow()).id;
    const { allPurchases, auctionPayments, advances, refs } = await loadDebtInputs(prisma, org);
    const parts = (d: ReturnType<typeof computeSupplierDebt>) => ({
      debt: d.debt.toFixed(2), received: d.receivedNet.toFixed(2), invoiced: d.invoiced.toFixed(2), expected: d.expected.toFixed(2),
      total: d.total.toFixed(2), nonAuction: d.nonAuctionDebt.toFixed(2),
      by: d.byAuction.map((a) => [a.dueReceived.toFixed(2), a.dueInvoiced.toFixed(2), a.dueExpected.toFixed(2), a.due.toFixed(2)].join("/")).sort(),
    });

    const base = computeSupplierDebt(allPurchases, auctionPayments, advances, refs);
    const b = parts(base);
    ok(b.debt === EXPECTED_DEBT, `долг (все годы) = ${b.debt}`);
    ok(INVOICES_FOR_DRAFTS.length === 4, "4 счёта на неполученные части");

    // 1) переименование по предложениям справочника (то, что делает apply-auction-names.ts): стабы не трогаем
    const seedRefs: Lite[] = SEED_AUCTIONS.filter((s) => s.aliases.length && !s.isService).map((s, i) => ({ id: `s${i}`, name: s.name, aliases: s.aliases, isService: false, confirmed: true }));
    const rename = (text: string | null, list: Lite[], to: (a: Lite) => string): string | null => {
      if (!text) return text;
      const a = findAuctionIn(text, list);
      return a ? replaceFirstLine(text, to(a)) : text;
    };
    const apply = (to: (a: Lite) => string, list: Lite[]) => ({
      purchases: allPurchases.map((p) => ({ ...p, auctionSession: rename(p.auctionSession, list, to) })),
      pays: auctionPayments.map((p) => ({ ...p, auctionSession: rename(p.auctionSession, list, to) })),
    });
    const r1 = apply((a) => a.name, seedRefs);
    const changed = r1.purchases.filter((p, i) => p.auctionSession !== allPurchases[i].auctionSession).length;
    console.log(`     (до применения apply-auction-names.ts в памяти переименовывается 36 закупок, после — 0; сейчас: ${changed})`);
    const afterSeed = parts(computeSupplierDebt(r1.purchases, r1.pays, advances, seedRefs));
    assert.deepEqual(afterSeed, b);
    ok(true, "ПОСЛЕ переименования по справочнику: долг и все части совпадают с исходными");

    // 2) тот же расчёт без справочника в аргументах (названия в данных — короткие, счета опознаются по ключу)
    const afterNoRefs = parts(computeSupplierDebt(r1.purchases, r1.pays, advances));
    assert.deepEqual(afterNoRefs, b);
    ok(true, "ПОСЛЕ переименования, без справочника: совпадает");

    // 3) произвольное будущее имя («Фур Харвестерс июнь»), прежние написания в алиасах → счёт находится по справочнику
    const custom: Lite[] = seedRefs.map((r) => ({ ...r, name: `Тест ${r.id}`, aliases: [r.name, ...r.aliases] }));
    const r3 = apply((a) => a.name, custom);
    const afterCustom = parts(computeSupplierDebt(r3.purchases, r3.pays, advances, custom));
    assert.deepEqual(afterCustom, b);
    ok(true, "ПОСЛЕ произвольного переименования (имя ≠ ключу, прежние имена — алиасы): совпадает");
    const fh = custom.find((c) => c.aliases.includes("FH 06.26"))!;
    ok(!!findInvoice(fh.name, custom), `счёт FH находится по справочнику при новом имени «${fh.name}»`);
    ok(!findInvoice(fh.name), "без справочника новое имя счёт не находит (значит, срабатывает именно справочник)");
  } finally {
    await prisma.$disconnect();
  }
  if (fails) { console.log(`\nПровалено: ${fails}`); process.exit(1); }
  console.log("\nВсе проверки пройдены");
}

main();
