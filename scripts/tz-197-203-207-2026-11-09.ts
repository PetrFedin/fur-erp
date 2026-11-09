/**
 * Партия 24 (новая, 09.11.2026): ТЗ № 197, 203–207 из приложений к Договору подряда №1605 и УПД ООО «Меркури Мода» → ООО «ВЕЛЛМЕХ» МФВМ/118–123 от 02.10.2026
 * (файлы — docs-inventory/incoming-2026-11-09-tz, строки УПД — upd.json там же, разобраны из xls).
 * Делает то же, что tz-193-202-2026-11-02: ТЗ «В работе», списание лотов по строкам УПД (consumeFromLot + ProductionMaterialUsage, commission4),
 * ТЗ 197 (как 201): шкуры подрядчика 176 000 ₽/изд. с НДС — строкой расходов «Шкуры подрядчика по документу ТЗ» без НДС; подкладка — по УПД МФВМ/118.
 * Дополнительно: создаёт партию №24 и привязывает к ней ТЗ; перед записью проверяет дубли ТЗ/УПД, суммы, НДС, остатки лотов, нормы расхода.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/tz-197-203-207-2026-11-09.ts             # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/tz-197-203-207-2026-11-09.ts --apply     # (до этого bash scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/tz-197-203-207-2026-11-09.ts --rollback
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const ROOT = resolve(__dirname, "..");
const DIR = join(ROOT, "docs-inventory", "incoming-2026-11-09-tz");
const JOURNAL = join(ROOT, "docs-inventory", "corrections-journal-batch24-tz-197-203-207-2026-11-09.json");
const D = Prisma.Decimal;
const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));
const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const N = (s: string) => s.replace(/[-\s]/g, "").toUpperCase().replace(/М/g, "M").replace(/А/g, "A").replace(/С/g, "C");

/** ТЗ → УПД (сопоставлено по лотам: строки УПД = строки «Заказчик передал» приложения). */
const UPD_OF: Record<string, string | null> = { "197": "МФВМ/000118", "203": "МФВМ/000119", "204": "МФВМ/000120", "205": "МФВМ/000121", "206": "МФВМ/000122", "207": "МФВМ/000123" };
const BATCH_NO = 24;
const MATS = "Материалы заказчика по документу ТЗ", HIDES = "Шкуры подрядчика по документу ТЗ", EXTRA = "Доп. материалы";

type Item = { name: string; color: string; model: string; material: string; size: string; lining: string; qty: number; work: number; extra: number; unit: number; total: number };
type Doc = { wo: string; date: string; deadline: string; docTotal: number; items: Item[]; file: string };
type UpdLine = { code: string; name: string; unit: string; qty: number; price: number; net: number; vat: number; gross: number };
type Upd = { file: string; date: string; total: { net: number; vat: number; gross: number }; lines: UpdLine[] };

function docxText(file: string) {
  const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8", maxBuffer: 20_000_000 });
  return xml.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (c) => c.replace(/<\/w:p>/g, " ").replace(/<\/w:tc>$/, "\n</w:tc>")).replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, " | ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\n\s*\n+/g, "\n");
}
/** Таблица изделий приложения: колонки читаются из шапки (у ТЗ 194 есть «Дополнительные материалы», у ТЗ 201 — «Стоимость шкур на изделие»). */
function parseDoc(file: string): Doc {
  const t = docxText(file);
  const lines = t.split("\n").map((l) => l.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*$/, "").replace(/\s*\|\s*/g, "").trim()).filter(Boolean);
  const iNo = lines.findIndex((l) => l === "№"), iHead = lines.findIndex((l) => l.startsWith("ИТОГО в руб. в т.ч. НДС"));
  const heads = lines.slice(iNo + 1, iHead + 1).filter((l) => l !== "22%");
  const iTot = lines.findIndex((l, i) => i > iHead && /^(Итого|ИТОГО):?$/.test(l));
  const flat = lines.slice(iHead + 1, iTot), n = heads.length + 1;
  const col = (re: RegExp) => heads.findIndex((h) => re.test(h));
  const cExtra = col(/^(Дополнительные материалы|Стоимость шкур)/);
  const items: Item[] = [];
  for (let i = 0; i + n - 1 < flat.length; i += n) {
    const c = flat.slice(i + 1, i + n);
    items.push({ name: c[0], color: c[1], model: c[2], material: c[3], size: c[4], lining: c[5], qty: num(c[6]), work: num(c[7]), extra: cExtra >= 0 ? num(c[cExtra]) : 0, unit: num(c[heads.length - 2]), total: num(c[heads.length - 1]) });
  }
  const wo = /ТЕХНИЧЕСКОЕ ЗАДАНИЕ №\s*(\d+)/.exec(t)![1];
  const d = /(\d{2})\.(\d{2})\.(\d{4})\s*г/.exec(t)!;
  return { wo, date: `${d[3]}-${d[2]}-${d[1]}`, deadline: /не позднее\s+(\d{2}\.\d{2}\.\d{4})/.exec(t)?.[1] ?? "", docTotal: num(/составляет\s*([\d.,]+)\s*рублей/.exec(t)![1]), items, file: file.split("/").pop()! };
}

type J = { batchId: string | null; orders: string[]; expenses: string[]; usages: string[]; movements: string[]; categories: string[]; lots: { lotId: string; qty: string }[]; order192Notes: null };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { consumeFromLot, returnToLot } = await import("../src/lib/stock");
  const prisma = createAuditedClient("script:tz-197-203-207-2026-11-09");
  console.log(ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН");
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

  if (ROLLBACK) {
    const j: J = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      const us = await tx.productionMaterialUsage.findMany({ where: { id: { in: j.usages } } });
      for (const u of us) await returnToLot(tx, { organizationId: org.id, lotId: u.lotId, quantity: u.quantity, notes: "Откат tz-197-203-207" });
      await tx.productionMaterialUsage.deleteMany({ where: { id: { in: j.usages } } });
      await tx.stockMovement.deleteMany({ where: { id: { in: j.movements } } });
      await tx.stockMovement.deleteMany({ where: { organizationId: org.id, notes: "Откат tz-197-203-207" } });
      await tx.productionExpense.deleteMany({ where: { id: { in: j.expenses } } });
      await tx.productionOrder.deleteMany({ where: { id: { in: j.orders } } });
      for (const c of j.categories) await tx.expenseCategory.deleteMany({ where: { id: c } });
      if (j.batchId) await tx.productionBatch.deleteMany({ where: { id: j.batchId, orders: { none: {} } } });
    }, { timeout: 180000 });
    writeFileSync(JOURNAL.replace(/\.json$/, `.rolled-back-${Date.now()}.json`), readFileSync(JOURNAL));
    execFileSync("rm", [JOURNAL]);
    console.log("Откат выполнен.");
    await prisma.$disconnect();
    return;
  }
  if (APPLY && existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); await prisma.$disconnect(); return; }

  const upd: Record<string, Upd> = JSON.parse(readFileSync(join(DIR, "upd.json"), "utf8"));
  const docs = readdirSync(DIR).filter((f) => f.endsWith(".docx")).map((f) => parseDoc(join(DIR, f))).filter((d) => d.wo in UPD_OF).sort((a, b) => Number(a.wo) - Number(b.wo));
  const problems: string[] = [], warns: string[] = [];
  if (docs.length !== Object.keys(UPD_OF).length) problems.push(`приложений ${docs.length} из ${Object.keys(UPD_OF).length}`);
  const exist = await prisma.productionOrder.findMany({ where: { organizationId: org.id, workOrderNumber: { in: Object.keys(UPD_OF) } }, select: { workOrderNumber: true } });
  if (exist.length) problems.push(`ТЗ уже есть в системе: ${exist.map((e) => e.workOrderNumber).join(", ")}`);
  const models = await prisma.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true } });

  // Лоты по строкам УПД
  type P = { wo: string; line: UpdLine; lotId: string; lotLabel: string };
  const plan: P[] = [], need = new Map<string, number>();
  for (const d of docs) {
    const u = UPD_OF[d.wo] ? upd[UPD_OF[d.wo]!] : null;
    if (UPD_OF[d.wo] && !u) { problems.push(`ТЗ ${d.wo}: нет ${UPD_OF[d.wo]} в upd.json`); continue; }
    for (const l of u?.lines ?? []) {
      let lots;
      const lin = /Подкладочная ткань №\s*(\d+)/.exec(l.name);
      if (lin) lots = (await prisma.rawMaterialLot.findMany({ where: { organizationId: org.id, rawMaterial: { name: `Подкладочная ткань №${lin[1]}` } }, include: { purchase: true } })).filter((x) => Math.abs(Math.round(Number(x.materialCostExclVat) * 1.04 * 100) / 100 - l.price) <= 0.05);
      else {
        const mat = /норк/i.test(l.name) ? "Норка" : /собол/i.test(l.name) ? "Соболь" : /лис/i.test(l.name) ? "Лиса" : null;
        const no = /(?:РП|СП)\d{4}\.(\d+)/.exec(l.name)?.[1] ?? /лот\s+(\d+)/.exec(l.name)?.[1] ?? /\b(\d{6})\b/.exec(l.name)?.[1];
        if (!mat || !no) { problems.push(`ТЗ ${d.wo}: не разобрать «${l.name}»`); continue; }
        const cands = await prisma.rawMaterialLot.findMany({ where: { organizationId: org.id, rawMaterial: { name: mat }, lotNumber: { in: [no, `FW26-${no}`] } }, include: { purchase: true } });
        lots = cands.filter((x) => Math.abs(Math.round(Number(x.materialCostExclVat) * 1.04 * 100) / 100 - l.price) <= 0.5);
      }
      if (lots.length !== 1) { problems.push(`ТЗ ${d.wo}: «${l.name}» — подходящих лотов ${lots.length}`); continue; }
      const lot = lots[0];
      const docPrice = Math.round(Number(lot.materialCostExclVat) * 1.04 * 100) / 100;
      if (Math.abs(docPrice - l.price) > 0.05) warns.push(`ТЗ ${d.wo}: «${l.name}» цена УПД ${rub(l.price)}, лот ${rub(docPrice)}`);
      need.set(lot.id, (need.get(lot.id) ?? 0) + l.qty);
      if (Number(lot.quantityRemaining) + 1e-9 < need.get(lot.id)!) problems.push(`ТЗ ${d.wo}: лот ${lot.lotNumber ?? "(без №)"} ${lot.purchase?.number}: осталось ${lot.quantityRemaining}, нужно ${need.get(lot.id)}`);
      plan.push({ wo: d.wo, line: l, lotId: lot.id, lotLabel: `${lin ? `Подкладка №${lin[1]}` : lot.lotNumber} · ${lot.purchase?.number}` });
    }
  }

  // Проверки документов
  for (const [no, u] of Object.entries(upd)) {
    if (!Object.values(UPD_OF).includes(no)) continue;
    const sn = u.lines.reduce((a, l) => a + l.net, 0), sv = u.lines.reduce((a, l) => a + l.vat, 0), sg = u.lines.reduce((a, l) => a + l.gross, 0);
    if (Math.abs(sn - u.total.net) > 0.02 || Math.abs(sv - u.total.vat) > 0.02 || Math.abs(sg - u.total.gross) > 0.02) problems.push(`${no}: сумма строк ${rub(sg)} ≠ итого ${rub(u.total.gross)}`);
    for (const l of u.lines) {
      if (Math.abs(l.qty * l.price - l.net) > 0.02) problems.push(`${no}: «${l.name.slice(0, 40)}» кол-во×цена ${rub(l.qty * l.price)} ≠ ${rub(l.net)}`);
      if (Math.abs(l.net * 0.22 - l.vat) > 0.02) problems.push(`${no}: «${l.name.slice(0, 40)}» НДС ${rub(l.vat)} ≠ 22 % ${rub(l.net * 0.22)}`);
    }
    if (u.date !== "2026-10-02" && !/2 октября 2026/.test(u.date)) warns.push(`${no}: дата ${u.date}`);
    const dup = await prisma.productionOrder.count({ where: { organizationId: org.id, notes: { contains: no } } });
    if (dup) problems.push(`${no}: УПД уже упомянут в ${dup} ТЗ системы (дубль)`);
  }
  for (const d of docs) {
    const sum = d.items.reduce((a, i) => a + i.total, 0);
    if (Math.abs(sum - d.docTotal) > 0.05 && Math.abs(sum + d.items.reduce((a, i) => a + (d.wo === "197" ? 0 : 0), 0) - d.docTotal) > 0.05) problems.push(`ТЗ ${d.wo}: сумма строк ${rub(sum)} ≠ итого ${rub(d.docTotal)}`);
    if (d.items.some((i) => i.model !== d.items[0].model)) warns.push(`ТЗ ${d.wo}: в ТЗ несколько моделей`);
  }
  const batch24 = await prisma.productionBatch.findFirst({ where: { organizationId: org.id, number: BATCH_NO } });
  if (batch24) problems.push(`партия ${BATCH_NO} уже есть в системе`);

  // Отчёт
  for (const d of docs) {
    const model = models.find((m) => N(m.name) === N(d.items[0].model));
    if (!model) problems.push(`ТЗ ${d.wo}: модели ${d.items[0].model} нет в системе`);
    const qty = d.items.reduce((s, i) => s + i.qty, 0), sizes = Array.from(new Set(d.items.map((i) => i.size))).join(" ");
    const ps = plan.filter((p) => p.wo === d.wo), mat = ps.reduce((s, p) => s + p.line.gross, 0);
    const work = d.items.reduce((s, i) => s + i.work * i.qty, 0), extra = d.items.reduce((s, i) => s + i.extra * i.qty, 0);
    const docMats = d.docTotal - work - (d.wo === "197" ? extra : 0);
    console.log(`ТЗ ${d.wo} от ${d.date.split("-").reverse().join(".")} · ${d.items[0].model} × ${qty} · ${d.items[0].color} · ${sizes} · работа ${rub(d.items[0].work)}/шт${extra ? ` · шкуры подрядчика ${rub(extra)}` : ""} · ${UPD_OF[d.wo] ?? "без УПД"}: списание ${ps.length} строк, ${rub(mat)} ₽ с НДС; по документу материалы ${rub(docMats)} ₽`);
    if (UPD_OF[d.wo] && Math.abs(mat - docMats) > 1) warns.push(`ТЗ ${d.wo}: материалы по УПД ${rub(mat)} ≠ по приложению ${rub(docMats)} (разница ${rub(mat - docMats)})`);
    for (const p of ps) console.log(`     ${p.line.qty} × ${p.lotLabel} (${p.line.name.slice(0, 60)})`);
  }
  if (warns.length) console.log("\nПредупреждения:\n  " + warns.join("\n  "));
  if (problems.length) { console.log("\nОШИБКИ (ничего не применено):\n  " + problems.join("\n  ")); await prisma.$disconnect(); process.exit(1); }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась."); await prisma.$disconnect(); return; }

  const j: J = { batchId: null, orders: [], expenses: [], usages: [], movements: [], categories: [], lots: [], order192Notes: null };
  await prisma.$transaction(async (tx) => {
    const cat = async (name: string) => {
      const c = await tx.expenseCategory.findFirst({ where: { organizationId: org.id, name } });
      if (c) return c;
      const n = await tx.expenseCategory.create({ data: { organizationId: org.id, name, kind: "PRODUCTION" } }); j.categories.push(n.id); return n;
    };
    const batch = await tx.productionBatch.create({ data: { organizationId: org.id, number: BATCH_NO, year: 2026, plannedUnits: docs.reduce((a, d) => a + d.items.reduce((s2, i) => s2 + i.qty, 0), 0), notes: `ТЗ 197, 203–207 (09.11.2026: «новая партия 24»; прежняя партия 24 = ТЗ 193–202 влита в партию 23 05.11.2026).\nСырьё передано по УПД МФВМ/118–123 от 02.10.2026. Срок работ до 30.11.2026; изделия у подрядчика.` } });
    j.batchId = batch.id;
    let lastNo = (await tx.productionOrder.findMany({ where: { number: { startsWith: "П-2026-" } }, select: { number: true } })).map((o) => Number(o.number.slice(7))).reduce((a, b) => Math.max(a, b), 0);
    for (const d of docs) {
      const it = d.items[0], qty = d.items.reduce((s, i) => s + i.qty, 0), sizes = Array.from(new Set(d.items.map((i) => i.size))).join(" ");
      const model = models.find((m) => N(m.name) === N(it.model))!;
      const tpl = (await tx.productionOrder.findFirst({ where: { productModelId: model.id }, orderBy: { number: "desc" } })) ?? (await tx.productionOrder.findFirst({ where: { workOrderNumber: "192" } }))!;
      const date = new Date(d.date + "T00:00:00.000Z");
      const u = UPD_OF[d.wo];
      const ps = plan.filter((p) => p.wo === d.wo);
      const matLines = ps.map((p) => `• ${p.line.name} (${p.lotLabel}): ${p.line.qty} ${p.line.unit} × ${rub(p.line.price)} ₽ без НДС = ${rub(p.line.gross)} ₽ с НДС 22 %`).join("\n");
      const colorName = it.color.replace(/^Черный$/i, "Чёрный");
      const colorRef = await tx.colorRef.findFirst({ where: { organizationId: org.id, name: { equals: colorName, mode: "insensitive" } } });
      const work = d.items.reduce((s, i) => s + i.work * i.qty, 0), extra = d.items.reduce((s, i) => s + i.extra * i.qty, 0);
      const notes = [
        `ТЗ №${d.wo} от ${d.date.split("-").reverse().join(".")}: данные внесены из приложения к Договору подряда №1605 (${d.file}). Изделие у подрядчика, в рознице ещё не получено: «В работе».`,
        `Изделие: ${it.name}; цвет ${it.color}; модель ${it.model}; материал ${it.material}; размеры ${sizes}; подкладка ${it.lining}. Цена работы ${rub(it.work)} ₽/шт. Итого по ТЗ ${rub(d.docTotal)} ₽ с НДС 22 %.`,
        u ? `Материалы заказчика — списаны со склада по лотам по УПД ${u} от 01.10.2026 (Меркури Мода → Веллмех), scripts/tz-193-202-2026-11-02:\n${matLines}\nИтого по УПД: ${rub(ps.reduce((s, p) => s + p.line.gross, 0))} ₽ с НДС 22 %.` : "",
        d.wo === "197" ? `Шкуры красной лисы — подрядчика: ${rub(extra / qty)} ₽/изд. с НДС (11 шкур × 16 000 ₽, как ТЗ 158 и 201), всего ${rub(extra)} ₽ — строкой расходов «${HIDES}» (без НДС); закупки этих шкур в системе нет.` : "",
        `Срок завершения работ: до ${d.deadline}. Оплата: аванс 70 %, доплата по готовности.`,
      ].filter(Boolean).join("\n");
      lastNo += 1;
      const o = await tx.productionOrder.create({
        data: {
          organizationId: org.id, number: `П-2026-${String(lastNo).padStart(4, "0")}`, productModelId: model.id, rawWarehouseId: tpl.rawWarehouseId, finishedWarehouseId: tpl.finishedWarehouseId,
          status: "IN_PROGRESS", plannedQuantity: new D(qty), producedQuantity: new D(0), color: colorName, colorRefId: colorRef?.id ?? null, size: sizes, materialDescription: it.material,
          lining: it.lining === "-" ? null : it.lining, notes, clientId: tpl.clientId, contractNumber: tpl.contractNumber, contractorId: tpl.contractorId,
          workOrderNumber: d.wo, workOrderDate: date, batchId: batch.id, clientWorkPricePerUnit: new D(it.work),
        },
      });
      j.orders.push(o.id);
      for (const p of ps) {
        const r = await consumeFromLot(tx, { organizationId: org.id, lotId: p.lotId, quantity: p.line.qty, productionOrderId: o.id, notes: `ТЗ ${d.wo}: ${p.line.name} (УПД ${u})` });
        const mv = await tx.stockMovement.findMany({ where: { productionOrderId: o.id, lotId: p.lotId, id: { notIn: j.movements } }, select: { id: true } });
        for (const m of mv) { j.movements.push(m.id); await tx.stockMovement.update({ where: { id: m.id }, data: { date } }); }
        const us = await tx.productionMaterialUsage.create({ data: { productionOrderId: o.id, rawMaterialId: r.rawMaterialId, lotId: p.lotId, quantity: p.line.qty, unitCost: r.unitCost, totalCost: r.totalCost, commission4: true, date }, select: { id: true } });
        j.usages.push(us.id);
        j.lots.push({ lotId: p.lotId, qty: String(p.line.qty) });
      }
      const exp = async (name: string, incl: number, descr: string) => {
        const c = await cat(name);
        const e = await tx.productionExpense.create({ data: { productionOrderId: o.id, categoryId: c.id, amount: new D((incl / 1.22).toFixed(2)), date, description: descr } });
        j.expenses.push(e.id);
      };
      if (d.wo === "197") await exp(HIDES, extra, `шкуры красной лисы подрядчика по ТЗ №197: 5 × 176 000 ₽ (без НДС; с НДС 22 % ${rub(extra)} ₽)`);
    }
    for (const l of new Set(plan.map((p) => p.lotId))) {
      const lot = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: l } });
      if (lot.quantityRemaining.isNegative()) throw new Error(`Лот ${lot.lotNumber}: остаток ниже 0 — откат`);
    }
  }, { timeout: 180000, maxWait: 15000 });
  writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
  console.log(`\nПрименено: ТЗ ${j.orders.length}, списаний ${j.usages.length}, строк расходов ${j.expenses.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
