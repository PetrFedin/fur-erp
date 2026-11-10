/**
 * Закупка «СП 09.26» (З-2026-0050…0057, черновики): транспорт на выделку и обратно приводится к расчёту закупки (СОЮЗПУШНИНА 09-26, фин) и УПД №317 от 10.11.2026:
 * тонировка («Прогресс») 27,88 ₽ и торторо («ЛИС») 21,74 ₽ за шкуру вместо 20 ₽. Итог по лотам должен сойтись с УПД 64 464 504,98 ₽.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-sp0926-transport-2026-11-10.ts <расчёт.xlsx> [--apply]
 * Без --apply — только отчёт. Прежние значения costPlan — в docs-inventory/corrections-journal-sp0926-transport-2026-11-10.json (откат: вернуть costPlan из журнала).
 */
import "./stubs/server-only-shim";
import ExcelJS from "exceljs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cv = (v: unknown) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v);
const TR_LABEL = "Транспорт на выделку и обратно, ₽";

(async () => {
  const file = process.argv[2], apply = process.argv.includes("--apply");
  if (!file) throw new Error("usage: <расчёт.xlsx> [--apply]");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const xl = new Map<string, { q: number; unit: number; transport: number }>();
  for (let r = 3; r <= 31; r++) xl.set(String(cv(ws.getCell(r, 25).value)).replace(".", "-"), { q: Number(cv(ws.getCell(r, 5).value)), unit: Number(cv(ws.getCell(r, 19).value)), transport: Number(cv(ws.getCell(r, 15).value)) || 0 });
  const { createAuditedClient } = await import("../src/lib/prisma");
  const db = createAuditedClient("script:fix-sp0926-transport");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const items = await db.purchaseItem.findMany({ where: { purchase: { organizationId: org, auctionSession: "СП 09.26", status: "DRAFT" } }, select: { id: true, lotNumber: true, quantity: true, costPlan: true } });
  const journal: { id: string; lot: string; before: unknown }[] = [];
  let before = 0, after = 0, changed = 0;
  for (const it of items) {
    const raw = String(it.lotNumber), lot = raw.startsWith("СП0926-") ? raw : "СП0926-" + raw, x = xl.get(lot);
    const plan = it.costPlan as { unitCostInclVat?: string; expenseExclVat?: string; costBreakdown?: { items?: { label: string; value: number }[] } } | null;
    if (!x || !plan?.costBreakdown?.items) { console.log("пропуск", raw, !x ? "нет в расчёте" : "нет costPlan"); continue; }
    const q = Number(it.quantity), u0 = Number(plan.unitCostInclVat ?? 0); before += u0 * q;
    const tr = plan.costBreakdown.items.find((i) => i.label === TR_LABEL);
    const delta = x.unit - u0; // добавка к себестоимости единицы, ₽
    if (!tr || Math.abs(delta) < 0.005) { after += u0 * q; continue; }
    journal.push({ id: it.id, lot, before: it.costPlan });
    const next = JSON.parse(JSON.stringify(plan));
    const t2 = next.costBreakdown.items.find((i: { label: string }) => i.label === TR_LABEL);
    t2.value = Number((tr.value + delta).toFixed(6));
    const tot = next.costBreakdown.items.find((i: { label: string }) => /^Итого себестоимость за единицу/.test(i.label));
    if (tot) tot.value = Number(x.unit.toFixed(6));
    next.unitCostInclVat = String(x.unit);
    next.expenseExclVat = String(Number(plan.expenseExclVat ?? 0) + delta);
    after += x.unit * q; changed++;
    console.log(lot, `транспорт ${tr.value} → ${t2.value.toFixed(2)}; ₽/ед ${u0.toFixed(2)} → ${x.unit.toFixed(2)}`);
    if (apply) await db.purchaseItem.update({ where: { id: it.id }, data: { costPlan: next } });
  }
  console.log(`лотов изменено: ${changed}; итог было ${before.toFixed(2)} → стало ${after.toFixed(2)} (УПД 64464504.98)${apply ? " — ПРИМЕНЕНО" : " — только расчёт, без --apply ничего не записано"}`);
  if (apply && journal.length) {
    const jp = join(__dirname, "..", "docs-inventory", "corrections-journal-sp0926-transport-2026-11-10.json");
    const prev = existsSync(jp) ? JSON.parse(readFileSync(jp, "utf8")) : [];
    writeFileSync(jp, JSON.stringify([...prev, { at: new Date().toISOString(), items: journal }], null, 1));
    console.log("журнал отката:", jp);
  }
  process.exit(0);
})().catch((e) => { console.error(String(e).slice(0, 800)); process.exit(1); });
