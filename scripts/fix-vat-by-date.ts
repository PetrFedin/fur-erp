/**
 * Исправление ставки НДС лотов по дате закупки (до 01.01.2026 — 20%, с 2026 — 22%).
 * Исправляются ТОЛЬКО однозначные случаи: все даты документов лота (закупка, приёмка, УПД, приход) по одну сторону 2026
 * И цены лота (НДС материала на единицу) уже согласованы со ставкой по дате — меняется только поле ставки (vatRate лота
 * и его позиций закупки), суммы не меняются. Остальное (неоднозначные даты, цены под старую ставку) — только в отчёте.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-vat-by-date.ts            # пробный прогон (по умолчанию)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-vat-by-date.ts --apply    # записать (ТОЛЬКО по разрешению владельца)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-vat-by-date.ts --rollback --apply
 * Журнал: docs-inventory/corrections-journal-vat-by-date.json (значения «до» для отката).
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { loadAudit, runChecks, rub, iso, sideOf, expectedRate } from "./vat-audit-core";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-vat-by-date.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const N = (x: { toString(): string } | null | undefined) => Number(x?.toString() ?? 0);
type Journal = { time: string; lots: { id: string; before: string; after: string }[]; items: { id: string; before: string; after: string }[]; rolledBack?: string };

async function main() {
  const prisma = new PrismaClient();
  try {
    if (ROLLBACK) {
      if (!existsSync(JOURNAL)) { console.log("Журнала нет — откатывать нечего"); return; }
      const j = JSON.parse(readFileSync(JOURNAL, "utf-8")) as Journal;
      if (j.rolledBack) { console.log("Уже откачено", j.rolledBack); return; }
      console.log(`${APPLY ? "Откат" : "Будет откачено (добавьте --apply)"}: лотов ${j.lots.length}, позиций ${j.items.length}`);
      if (APPLY) {
        for (const l of j.lots) await prisma.rawMaterialLot.update({ where: { id: l.id }, data: { vatRate: l.before } });
        for (const i of j.items) await prisma.purchaseItem.update({ where: { id: i.id }, data: { vatRate: i.before } });
        j.rolledBack = new Date().toISOString();
        writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
        console.log("Откачено");
      }
      return;
    }
    if (APPLY && existsSync(JOURNAL) && !(JSON.parse(readFileSync(JOURNAL, "utf-8")) as Journal).rolledBack) { console.log("Журнал уже есть и не откачен — сначала --rollback --apply"); return; }

    const data = await loadAudit(prisma);
    const r = runChecks(data);
    const fixes = [...r.lotFixable.values()];
    console.log(`РЕЖИМ: ${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН (ничего не записывается)"}`);
    console.log(`Однозначно исправимых лотов: ${fixes.length}; требуют решения владельца: ${r.ambiguous.size}\n`);

    const itemFixes: { id: string; before: string; after: string }[] = [];
    for (const x of fixes) {
      console.log(`  лот ${x.lot.lotNumber ?? "без номера"} · ${x.lot.rawMaterial.name} · закупка ${x.lot.purchase?.number ?? "—"} (${iso(x.lot.purchase?.orderDate ?? x.lot.receivedDate)}): ${N(x.lot.vatRate)}% → ${x.to}% — ${x.why}`);
      for (const it of x.lot.purchaseItems) {
        if (N(it.vatRate) !== x.to && expectedRate(sideOf(it.purchase.orderDate)) === x.to) itemFixes.push({ id: it.id, before: String(it.vatRate), after: String(x.to) });
      }
    }
    console.log(`  позиций закупки к правке: ${itemFixes.length}`);

    // Влияние на Главную: суммы строк списания не зависят от поля ставки лота (они из цен лота) — меняется только разбивка по ставкам.
    const fixedRate = new Map(fixes.map((x) => [x.lot.id, x.to]));
    const groups = (rateOf: (u: (typeof data.usages)[number]) => number) => {
      const m = new Map<number, { incl: number; vat: number; lines: number }>();
      let incl = 0, excl = 0;
      for (const u of data.usages) {
        const rt = rateOf(u);
        const i = N(u.totalCost);
        const e = u.vatRate != null ? i / (1 + N(u.vatRate) / 100) : N(u.quantity) * (N(u.lot.materialCostExclVat) + N(u.lot.expenseCostExclVat));
        const g = m.get(rt) ?? { incl: 0, vat: 0, lines: 0 };
        g.incl += i; g.vat += i - e; g.lines += 1; m.set(rt, g);
        incl += i; excl += e;
      }
      return { m, incl, excl };
    };
    const before = groups((u) => (u.vatRate != null ? N(u.vatRate) : N(u.lot.vatRate)));
    const after = groups((u) => (u.vatRate != null ? N(u.vatRate) : fixedRate.get(u.lotId) ?? N(u.lot.vatRate)));
    const show = (t: string, g: typeof before) => {
      console.log(`  ${t}: списания с НДС ${rub(g.incl)}, без НДС ${rub(g.excl)}, НДС в списаниях ${rub(g.incl - g.excl)} (без 4%)`);
      for (const [rt, v] of [...g.m].sort((a, b) => a[0] - b[0])) console.log(`      ставка ${rt}%: строк ${v.lines}, с НДС ${rub(v.incl)}, НДС ${rub(v.vat)}`);
    };
    console.log("\nВЛИЯНИЕ НА ГЛАВНУЮ (итоги списаний, режим «без 4%»):");
    show("ДО   ", before);
    show("ПОСЛЕ", after);
    console.log(`  Себестоимость и «НДС в списаниях»: Δ с НДС ${rub(after.incl - before.incl)}, Δ без НДС ${rub(after.excl - before.excl)}, Δ НДС ${rub(after.incl - after.excl - (before.incl - before.excl))} (однозначные правки меняют только разбивку по ставкам)`);

    // Сценарии для случаев «на решение владельца» (не применяются скриптом): ставка меняется, цена с НДС остаётся → цена без НДС пересчитывается.
    if (r.ambiguous.size) {
      console.log("\nНА РЕШЕНИЕ ВЛАДЕЛЬЦА (скрипт не меняет):");
      let dInclExcl = 0;
      for (const a of r.ambiguous.values()) {
        const l = a.lot;
        const to = expectedRate(sideOf(l.purchase?.orderDate ?? l.receivedDate));
        const oldExcl = N(l.materialCostExclVat), vat = N(l.materialVatAmount), exp = N(l.expenseCostExclVat);
        const newExcl = (oldExcl + vat) / (1 + to / 100);
        const used = data.usages.filter((u) => u.lotId === l.id);
        const qty = used.reduce((s, u) => s + N(u.quantity), 0);
        const dExclUsed = qty * (newExcl + exp - (oldExcl + exp));
        dInclExcl += dExclUsed;
        console.log(`  лот ${l.lotNumber} · закупка ${l.purchase?.number} (дата закупки ${iso(l.purchase?.orderDate)}, приход ${iso(l.receivedDate)}): ставка ${N(l.vatRate)}%; по дате закупки → ${to}%. ${a.why}; ${a.consistentWith}.`);
        console.log(`      если принять ${to}% и оставить цену с НДС: цена без НДС ${rub(oldExcl)} → ${rub(newExcl)} за ед.; списано ${rub(qty)} ед. в ${new Set(used.map((u) => u.productionOrderId)).size} ТЗ → «без НДС» в списаниях Δ ${rub(dExclUsed)} ₽, «НДС в списаниях» Δ ${rub(-dExclUsed)} ₽, «с НДС» без изменений.`);
      }
      console.log(`  Σ по случаям: списания без НДС Δ ${rub(dInclExcl)} ₽, НДС в списаниях Δ ${rub(-dInclExcl)} ₽.`);
    }

    // Альтернатива владельцу: считать не по дате закупки, а по дате прихода лота (если она по другую сторону 2026).
    const alt = data.lots.filter((l) => l.purchase && sideOf(l.purchase.orderDate) !== sideOf(l.receivedDate) && N(l.vatRate) !== expectedRate(sideOf(l.receivedDate)));
    if (alt.length) {
      console.log("\nАЛЬТЕРНАТИВА «по дате прихода лота» (скрипт не меняет): лоты, где ставка = по дате закупки, но приход по другую сторону 2026:");
      let dSum = 0;
      for (const l of alt) {
        const to = expectedRate(sideOf(l.receivedDate));
        const oldExcl = N(l.materialCostExclVat), vat = N(l.materialVatAmount);
        const newExcl = (oldExcl + vat) / (1 + to / 100);
        const qty = data.usages.filter((u) => u.lotId === l.id).reduce((a, u) => a + N(u.quantity), 0);
        const d = qty * (newExcl - oldExcl);
        dSum += d;
        console.log(`  лот ${l.lotNumber} · ${l.purchase!.number}: ${N(l.vatRate)}% → ${to}%, без НДС за ед. ${rub(oldExcl)} → ${rub(newExcl)}; списано ${rub(qty)} → списания без НДС Δ ${rub(d)} ₽`);
      }
      console.log(`  Σ: списания без НДС Δ ${rub(dSum)} ₽, НДС в списаниях Δ ${rub(-dSum)} ₽ (с НДС без изменений).`);
    }

    if (!APPLY) { console.log("\nПробный прогон: ничего не записано."); return; }
    if (!fixes.length) { console.log("Нечего применять"); return; }
    const journal: Journal = { time: new Date().toISOString(), lots: fixes.map((x) => ({ id: x.lot.id, before: String(x.lot.vatRate), after: String(x.to) })), items: itemFixes };
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // сначала журнал — потом запись
    await prisma.$transaction([
      ...journal.lots.map((l) => prisma.rawMaterialLot.update({ where: { id: l.id }, data: { vatRate: l.after } })),
      ...journal.items.map((i) => prisma.purchaseItem.update({ where: { id: i.id }, data: { vatRate: i.after } })),
    ]);
    console.log("Применено. Откат: --rollback --apply");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
