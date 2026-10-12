/**
 * Аудит НДС по датам закупки (ТОЛЬКО ЧТЕНИЕ БД): docs-inventory/vat-audit-2026-10-12.md.
 * Правило: закупка/УПД до 01.01.2026 → 20%, с 01.01.2026 → 22%.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/audit-vat-2026.ts
 */
import "./stubs/server-only-shim";
import { writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { loadAudit, runChecks, lotDates, rub, iso, type Finding } from "./vat-audit-core";
import { vatBreakdown, vatKindLabel } from "../src/lib/tz-vat";

const N = (x: { toString(): string } | null | undefined) => Number(x?.toString() ?? 0);

async function main() {
  const prisma = new PrismaClient();
  try {
    const data = await loadAudit(prisma);
    const r = runChecks(data);
    const f = r.findings;
    const infoCross = data.lots.filter((l) => !lotDates(l, data.upd).unambiguous && !r.ambiguous.has(l.id));

    // (g) и (h) по каждому ТЗ
    const orders = new Map<string, typeof data.usages>();
    for (const u of data.usages) orders.set(u.productionOrderId, [...(orders.get(u.productionOrderId) ?? []), u]);
    const gBad: Finding[] = [];
    const cardVat = new Map<string, number>();
    const numberOf = new Map<string, string>();
    for (const [id, us] of orders) {
      const num = us[0].productionOrder.number;
      numberOf.set(id, num);
      const b = vatBreakdown(us.map((u) => ({ ...u, lot: u.lot })) as Parameters<typeof vatBreakdown>[0], "off");
      let vatSum = 0;
      for (const row of b.rows) {
        const vat = N(row.incl as never) - N(row.excl as never);
        const byRate = (N(row.incl as never) * row.rate) / (100 + row.rate);
        vatSum += vat;
        if (Math.abs(vat - byRate) > 1) {
          gBad.push({ type: "g", orderNumber: num, purchase: "—", lot: "—", material: `ТЗ ${num}`, date: "—", rate: `${row.rate}%`, expected: `НДС ${rub(byRate)}`, note: `в разбивке ТЗ НДС по ставке ${row.rate}% = ${rub(vat)} (строк ${row.lines}, с НДС ${rub(N(row.incl as never))}); по формуле ставки должно быть ${rub(byRate)}` });
        }
      }
      cardVat.set(id, vatSum);
      void vatKindLabel;
    }
    // (h) Главная: loadDrillOrders (те же данные, что «НДС в списаниях» плитки ТЗ и «Состав по лотам»)
    const hBad: Finding[] = [];
    let homeTotal = 0, cardTotal = 0, homeOk = false;
    try {
      const { loadDrillOrders } = await import("../src/lib/dashboard-data");
      const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
      const drill = await loadDrillOrders(org!.id, "all", { auction: [], fur: [], color: [], attr: [], batch: [], status: [], vat: [], catgroup: [] } as never, "off", "all");
      homeOk = true;
      for (const o of drill) {
        const home = o.lines.reduce((a, l) => a + (l.i - l.ci) - (l.e - l.ce), 0);
        const card = cardVat.get(o.id) ?? 0;
        homeTotal += home; cardTotal += card;
        if (Math.abs(home - card) > 1) hBad.push({ type: "h", orderNumber: o.number, purchase: "—", lot: "—", material: `ТЗ ${o.number}`, date: "—", rate: "—", expected: `карточка ${rub(card)}`, note: `Главная/«Состав по лотам»: НДС ${rub(home)}; карточка (разбивка по ставкам): ${rub(card)}; разница ${rub(home - card)}` });
      }
    } catch (e) {
      console.log("(h) Главная не прочитана:", (e as Error).message.slice(0, 200));
    }
    f.push(...gBad, ...hBad);

    // Сводка
    const types: [string, string][] = [
      ["a", "(a) лот/позиция до 2026, ставка не 20%"],
      ["a-неоднозначно", "(a) то же, но даты документов по разные стороны 2026"],
      ["a-цены", "(a) то же, цены согласованы со старой ставкой — решение владельца"],
      ["b", "(b) с 2026, ставка 20%"],
      ["b-неоднозначно", "(b) то же, даты по разные стороны 2026"],
      ["b-цены", "(b) то же, цены согласованы со старой ставкой — решение владельца"],
      ["b2", "(b) с 2026, иная ставка (не 20 и не 22)"],
      ["c", "(c) позиция закупки и лот с разной ставкой"],
      ["d", "(d) цена с НДС и без НДС не сходится со ставкой (>1 ₽/ед.)"],
      ["e", "(e) явная ставка строки ТЗ ≠ ставке лота"],
      ["f-пул", "(f) пул подкладки из поступлений разных лет/ставок"],
      ["g", "(g) бейдж/разбивка ТЗ не сходится со ставкой"],
      ["h", "(h) НДС: карточка ТЗ ≠ Главная/«Состав по лотам»"],
    ];
    const count = (t: string) => f.filter((x) => x.type === t).length;
    const lines: string[] = [];
    lines.push("# Аудит НДС по датам закупки — 12.10.2026", "", "Правило: дата закупки/УПД до 01.01.2026 → 20%, с 01.01.2026 → 22%. Только чтение; данные не менялись.", "");
    lines.push(`Проверено: лотов ${data.lots.length}, позиций закупки ${data.items.length}, строк списания ${data.usages.length}, ТЗ со списаниями ${orders.size}.`, "");
    lines.push("## Сводка", "", "| Тип | Записей |", "|---|---|");
    for (const [t, label] of types) lines.push(`| ${label} | ${count(t)} |`);
    lines.push(`| (e) ТЗ с лотами разных ставок (разбивка ниже) | ${r.mixedOrders.length} |`);
    lines.push(`| (e) строк списания, где ставка лота противоречит дате закупки (эффективная ≠ по дате) | ${r.usageWrong.length} |`);
    lines.push(`| (f) из них подкладка | ${r.usageWrong.filter((x) => x.lining).length} |`);
    lines.push(`| (инфо) ставка совпадает с датой закупки, но дата прихода/УПД по другую сторону 2026 | ${infoCross.length} |`);
    lines.push("", `Исправимо скриптом (однозначно, меняется только поле ставки): лотов ${r.lotFixable.size}; требуют решения: ${r.ambiguous.size}.`, "");
    if (homeOk) lines.push(`НДС в списаниях по всем ТЗ: карточки ${rub(cardTotal)} ₽, Главная ${rub(homeTotal)} ₽, разница ${rub(homeTotal - cardTotal)} ₽.`, "");
    for (const [t, label] of types) {
      const list = f.filter((x) => x.type === t);
      if (!list.length) continue;
      lines.push(`## ${label} — ${list.length}`, "", "| ТЗ | Закупка | Лот | Материал | Дата | Ставка | Должно быть | Примечание |", "|---|---|---|---|---|---|---|---|");
      for (const x of list) lines.push(`| ${x.orderNumber ?? ""} | ${x.purchase} | ${x.lot} | ${x.material} | ${x.date} | ${x.rate} | ${x.expected} | ${x.note.replace(/\|/g, "/")} |`);
      lines.push("");
    }
    if (r.mixedOrders.length) {
      lines.push(`## (e) ТЗ с лотами разных ставок — ${r.mixedOrders.length}`, "", "| ТЗ | Разбивка НДС по ставкам |", "|---|---|");
      for (const m of r.mixedOrders) lines.push(`| ${m.number} | ${m.rows.map((x) => `${x.rate}%: строк ${x.lines}, с НДС ${rub(x.incl)}, НДС ${rub(x.vat)}`).join("; ")} |`);
      lines.push("");
    }
    if (r.usageWrong.length) {
      lines.push(`## (e)/(f) строки списания со ставкой, противоречащей дате закупки лота — ${r.usageWrong.length}`, "", "| ТЗ | Лот | Материал | Ставка в расчёте | По дате | Сумма с НДС |", "|---|---|---|---|---|---|");
      for (const x of r.usageWrong) lines.push(`| ${x.orderNumber} | ${x.lot} | ${x.material}${x.lining ? " (подкладка)" : ""} | ${x.rate}% | ${x.expected}% | ${rub(x.incl)} |`);
      lines.push("");
    }
    writeFileSync(join(__dirname, "..", "docs-inventory", "vat-audit-2026-10-12.md"), lines.join("\n"));

    console.log("СВОДКА");
    for (const [t, label] of types) console.log(String(count(t)).padStart(5), label);
    console.log(String(r.mixedOrders.length).padStart(5), "(e) ТЗ с лотами разных ставок");
    console.log(String(r.usageWrong.length).padStart(5), "(e) строк списания: ставка ≠ по дате закупки лота; из них подкладка:", r.usageWrong.filter((x) => x.lining).length);
    console.log(String(infoCross.length).padStart(5), "(инфо) ставка = по дате закупки, но дата прихода/УПД по другую сторону 2026:", infoCross.map((l) => `${l.purchase?.number}/${l.lotNumber ?? "-"}`).join(", "));
    console.log("Исправимо скриптом:", r.lotFixable.size, "| решение владельца:", r.ambiguous.size);
    if (homeOk) console.log(`НДС в списаниях: карточки ${rub(cardTotal)}, Главная ${rub(homeTotal)}`);
    console.log("\nПРИМЕРЫ (по 10):");
    for (const x of f.filter((y) => !["g", "h"].includes(y.type)).slice(0, 10)) console.log(JSON.stringify(x));
    void iso;
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
