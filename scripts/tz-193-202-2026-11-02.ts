/**
 * ТЗ № 193–202 (кроме 197 — документа нет) из приложений к Договору подряда №1605 и УПД ООО «Меркури Мода» → ООО «ВЕЛЛМЕХ» МФВМ/108–117 от 01.10.2026
 * (файлы — docs-inventory/incoming-2026-11-02, строки УПД — upd.json там же).
 *
 * Что делает (как ТЗ 192 и writeoff-tz-184-192):
 *  • заводит ТЗ «В работе» (изделия у подрядчика, срок до 15.11 / 30.11.2026): модель, цвет, размеры, подкладка, количество, цена работы — из приложения;
 *  • списывает со склада сырьё и подкладку ровно по строкам УПД: consumeFromLot + ProductionMaterialUsage (commission4 = true, цена в УПД = цена лота без НДС × 1,04);
 *    лот находится по номеру из наименования (РП0426.N / СП0526.N / «лот N» / номер норки) среди лотов «N» и «FW26-N» и подтверждается ценой;
 *  • ТЗ 192 уже списан 30.10 (УПД МФВМ/108 — его документ, только отметка в примечании);
 *  • ТЗ 194 (муфты MMF01): «Доп. материалы» 791,78 ₽/шт. по приложению, как у ТЗ 178;
 *  • ТЗ 196 (M049): УПД нет, а таблица материалов приложения с ошибками (лот 1378 дважды, суммы строк не сходятся) — лоты НЕ списываются,
 *    сумма материалов по документу (итого − работа) без НДС — строкой расходов «Материалы заказчика по документу ТЗ» до прихода УПД;
 *  • ТЗ 201 (M029, лиса): шкуры подрядчика 176 000 ₽/изд. с НДС (лот прошлой закупки шкур подрядчика З-2026-0059 израсходован) —
 *    строкой расходов «Шкуры подрядчика по документу ТЗ» без НДС; подкладка — по УПД МФВМ/116.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/tz-193-202-2026-11-02.ts             # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/tz-193-202-2026-11-02.ts --apply     # (до этого bash scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/tz-193-202-2026-11-02.ts --rollback
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const ROOT = resolve(__dirname, "..");
const DIR = join(ROOT, "docs-inventory", "incoming-2026-11-02");
const JOURNAL = join(ROOT, "docs-inventory", "corrections-journal-tz-193-202-2026-11-02.json");
const D = Prisma.Decimal;
const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));
const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const N = (s: string) => s.replace(/[-\s]/g, "").toUpperCase().replace(/М/g, "M").replace(/А/g, "A").replace(/С/g, "C");

/** ТЗ → УПД (сопоставлено по лотам: строки УПД = строки «Заказчик передал» приложения). */
const UPD_OF: Record<string, string | null> = { "193": "МФВМ/000109", "194": "МФВМ/000110", "195": "МФВМ/000111", "196": null, "198": "МФВМ/000113", "199": "МФВМ/000114", "200": "МФВМ/000115", "201": "МФВМ/000116", "202": "МФВМ/000117" };
const LINING_PURCHASE = "З-2026-0061";
const MATS = "Материалы заказчика по документу ТЗ", HIDES = "Шкуры подрядчика по документу ТЗ", EXTRA = "Доп. материалы";

type Item = { name: string; color: string; model: string; material: string; size: string; lining: string; qty: number; work: number; extra: number; unit: number; total: number };
type Doc = { wo: string; date: string; deadline: string; docTotal: number; items: Item[]; file: string };
type UpdLine = { code: string; name: string; unit: string; qty: number; price: number; net: number; vat: number; gross: number };
type Upd = { file: string; date: string; total: { net: number; vat: number; gross: number }; lines: UpdLine[] };

function docxText(file: string) {
  const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8", maxBuffer: 20_000_000 });
  return xml.replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, " | ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\n\s*\n+/g, "\n");
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
  return { wo, date: `${d[3]}-${d[2]}-${d[1]}`, deadline: /не позднее\s+(\d{2}\.\d{2}\.\d{4})/.exec(t)?.[1] ?? "", docTotal: num(/составляет\s+([\d.,]+)\s+рублей/.exec(t)![1]), items, file: file.split("/").pop()! };
}

type J = { orders: string[]; expenses: string[]; usages: string[]; movements: string[]; categories: string[]; lots: { lotId: string; qty: string }[]; order192Notes: { id: string; notes: string | null } | null };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { consumeFromLot, returnToLot } = await import("../src/lib/stock");
  const prisma = createAuditedClient("script:tz-193-202-2026-11-02");
  console.log(ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН");
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

  if (ROLLBACK) {
    const j: J = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      const us = await tx.productionMaterialUsage.findMany({ where: { id: { in: j.usages } } });
      for (const u of us) await returnToLot(tx, { organizationId: org.id, lotId: u.lotId, quantity: u.quantity, notes: "Откат tz-193-202" });
      await tx.productionMaterialUsage.deleteMany({ where: { id: { in: j.usages } } });
      await tx.stockMovement.deleteMany({ where: { id: { in: j.movements } } });
      await tx.stockMovement.deleteMany({ where: { organizationId: org.id, notes: "Откат tz-193-202" } });
      await tx.productionExpense.deleteMany({ where: { id: { in: j.expenses } } });
      await tx.productionOrder.deleteMany({ where: { id: { in: j.orders } } });
      for (const c of j.categories) await tx.expenseCategory.deleteMany({ where: { id: c } });
      if (j.order192Notes) await tx.productionOrder.update({ where: { id: j.order192Notes.id }, data: { notes: j.order192Notes.notes } });
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
      if (lin) lots = await prisma.rawMaterialLot.findMany({ where: { organizationId: org.id, rawMaterial: { name: `Подкладочная ткань №${lin[1]}` }, purchase: { number: LINING_PURCHASE } }, include: { purchase: true } });
      else {
        const mat = /норк/i.test(l.name) ? "Норка" : /собол/i.test(l.name) ? "Соболь" : null;
        const no = /(?:РП|СП)\d{4}\.(\d+)/.exec(l.name)?.[1] ?? /лот\s+(\d+)/.exec(l.name)?.[1] ?? /\b(\d{6})\b/.exec(l.name)?.[1];
        if (!mat || !no) { problems.push(`ТЗ ${d.wo}: не разобрать «${l.name}»`); continue; }
        const cands = await prisma.rawMaterialLot.findMany({ where: { organizationId: org.id, rawMaterial: { name: mat }, lotNumber: { in: [no, `FW26-${no}`] } }, include: { purchase: true } });
        lots = cands.filter((x) => Math.abs(Math.round(Number(x.materialCostExclVat) * 1.04 * 100) / 100 - l.price) <= 0.05);
      }
      if (lots.length !== 1) { problems.push(`ТЗ ${d.wo}: «${l.name}» — подходящих лотов ${lots.length}`); continue; }
      const lot = lots[0];
      const docPrice = Math.round(Number(lot.materialCostExclVat) * 1.04 * 100) / 100;
      if (Math.abs(docPrice - l.price) > 0.05) problems.push(`ТЗ ${d.wo}: «${l.name}» цена УПД ${rub(l.price)}, лот ${rub(docPrice)}`);
      need.set(lot.id, (need.get(lot.id) ?? 0) + l.qty);
      if (Number(lot.quantityRemaining) + 1e-9 < need.get(lot.id)!) problems.push(`ТЗ ${d.wo}: лот ${lot.lotNumber ?? "(без №)"} ${lot.purchase?.number}: осталось ${lot.quantityRemaining}, нужно ${need.get(lot.id)}`);
      plan.push({ wo: d.wo, line: l, lotId: lot.id, lotLabel: `${lin ? `Подкладка №${lin[1]}` : lot.lotNumber} · ${lot.purchase?.number}` });
    }
  }

  // Отчёт
  for (const d of docs) {
    const model = models.find((m) => N(m.name) === N(d.items[0].model));
    if (!model) problems.push(`ТЗ ${d.wo}: модели ${d.items[0].model} нет в системе`);
    const qty = d.items.reduce((s, i) => s + i.qty, 0), sizes = Array.from(new Set(d.items.map((i) => i.size))).join(" ");
    const ps = plan.filter((p) => p.wo === d.wo), mat = ps.reduce((s, p) => s + p.line.gross, 0);
    const work = d.items.reduce((s, i) => s + i.work * i.qty, 0), extra = d.items.reduce((s, i) => s + i.extra * i.qty, 0);
    const docMats = d.docTotal - work - (d.wo === "194" || d.wo === "201" ? extra : 0);
    console.log(`ТЗ ${d.wo} от ${d.date.split("-").reverse().join(".")} · ${d.items[0].model} × ${qty} · ${d.items[0].color} · ${sizes} · работа ${rub(d.items[0].work)}/шт${extra ? ` · ${d.wo === "201" ? "шкуры подрядчика" : "доп. материалы"} ${rub(extra)}` : ""} · ${UPD_OF[d.wo] ?? "без УПД"}: списание ${ps.length} строк, ${rub(mat)} ₽ с НДС; по документу материалы ${rub(docMats)} ₽`);
    if (UPD_OF[d.wo] && Math.abs(mat - docMats) > 1) warns.push(`ТЗ ${d.wo}: материалы по УПД ${rub(mat)} ≠ по приложению ${rub(docMats)} (разница ${rub(mat - docMats)})`);
    for (const p of ps) console.log(`     ${p.line.qty} × ${p.lotLabel} (${p.line.name.slice(0, 60)})`);
  }
  if (warns.length) console.log("\nПредупреждения:\n  " + warns.join("\n  "));
  if (problems.length) { console.log("\nОШИБКИ (ничего не применено):\n  " + problems.join("\n  ")); await prisma.$disconnect(); process.exit(1); }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась."); await prisma.$disconnect(); return; }

  const j: J = { orders: [], expenses: [], usages: [], movements: [], categories: [], lots: [], order192Notes: null };
  await prisma.$transaction(async (tx) => {
    const cat = async (name: string) => {
      const c = await tx.expenseCategory.findFirst({ where: { organizationId: org.id, name } });
      if (c) return c;
      const n = await tx.expenseCategory.create({ data: { organizationId: org.id, name, kind: "PRODUCTION" } }); j.categories.push(n.id); return n;
    };
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
        d.wo === "196" ? `Материалы заказчика: УПД нет, таблица материалов приложения с ошибками (лот 1378 дважды, суммы строк не сходятся) — лоты НЕ списаны. Сумма материалов по документу ${rub(d.docTotal - work)} ₽ с НДС — строкой расходов «${MATS}» (без НДС) до прихода УПД.` : "",
        d.wo === "201" ? `Шкуры красной лисы — подрядчика: ${rub(extra / qty)} ₽/изд. с НДС (11 шкур × 16 000 ₽, как ТЗ 158), всего ${rub(extra)} ₽ — строкой расходов «${HIDES}» (без НДС); закупки этих шкур в системе нет (лот З-2026-0059 израсходован).` : "",
        d.wo === "194" ? `Доп. материалы по приложению: ${rub(extra / qty)} ₽/шт. с НДС, всего ${rub(extra)} ₽ (как ТЗ 178).` : "",
        `Срок завершения работ: до ${d.deadline}. Оплата: аванс 70 %, доплата по готовности.`,
      ].filter(Boolean).join("\n");
      lastNo += 1;
      const o = await tx.productionOrder.create({
        data: {
          organizationId: org.id, number: `П-2026-${String(lastNo).padStart(4, "0")}`, productModelId: model.id, rawWarehouseId: tpl.rawWarehouseId, finishedWarehouseId: tpl.finishedWarehouseId,
          status: "IN_PROGRESS", plannedQuantity: new D(qty), producedQuantity: new D(0), color: colorName, colorRefId: colorRef?.id ?? null, size: sizes, materialDescription: it.material,
          lining: it.lining === "-" ? null : it.lining, notes, clientId: tpl.clientId, contractNumber: tpl.contractNumber, contractorId: tpl.contractorId,
          workOrderNumber: d.wo, workOrderDate: date, clientWorkPricePerUnit: new D(it.work),
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
      if (d.wo === "196") await exp(MATS, d.docTotal - work, `материалы заказчика по документу ТЗ №196 (без НДС; с НДС 22 % ${rub(d.docTotal - work)} ₽); лоты не списаны — ждём УПД`);
      if (d.wo === "201") await exp(HIDES, extra, `шкуры красной лисы подрядчика по ТЗ №201: 5 × 176 000 ₽ (без НДС; с НДС 22 % ${rub(extra)} ₽)`);
      if (d.wo === "194") { const c = await cat(EXTRA); const e = await tx.productionExpense.create({ data: { productionOrderId: o.id, categoryId: c.id, amount: new D(extra.toFixed(2)), date, description: `доп. материалы по приложению к ТЗ №194: 5 × 791,78 ₽` } }); j.expenses.push(e.id); }
    }
    const o192 = await tx.productionOrder.findFirst({ where: { organizationId: org.id, workOrderNumber: "192" } });
    if (o192 && !(o192.notes ?? "").includes("МФВМ/000108")) {
      j.order192Notes = { id: o192.id, notes: o192.notes };
      await tx.productionOrder.update({ where: { id: o192.id }, data: { notes: `${o192.notes ?? ""}\nУПД МФВМ/000108 от 01.10.2026 (Меркури Мода → Веллмех): соболь, лот 15317, 10 шт. × 29 411,29 ₽ = 358 817,74 ₽ с НДС — документ к уже сделанному списанию.` } });
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
