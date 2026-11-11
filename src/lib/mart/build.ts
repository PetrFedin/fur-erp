import "server-only";
import type { PrismaClient } from "@prisma/client";
import { loadReportSizes } from "@/lib/margin-server";
import { loadRetailPricesState } from "@/lib/import-keys";
import { normCode } from "@/lib/sales-receipts-core";
import { loadOrderRows } from "@/lib/analytics-orders";

/**
 * Единая витрина данных (read model). Пересборка целиком по организации одной транзакцией.
 * Изделие = артикул · цвет · размер. Штуки — из отчёта «заказ и продажи» (эталон владельца), даты — из строк файла, цены — прайс по размеру,
 * закупка — по партиям (ТЗ) и средневзвешенная, с контролем по отчёту (поступило € ÷ шт. × курс 110: курс 110 только для розницы/сверки).
 * Правила сверки — в docs/data-mart/DATA-MART-PLAN-2026-11-11.md.
 */
export const RETAIL_RATE = 110;
const SEASONS = ["FW25/26", "SS26", "FW26/27"] as const;
const n = (v: unknown) => Number(v ?? 0) || 0;

/** Эталон владельца (10.11.2026): отчёт «заказ и продажи». */
export const MART_EXPECTED = { ordered: 845, received: 637, sold: 291, stock: 346, stockRetailRub: 689_484_200 } as const;

export type MartSummary = { skus: number; parties: number; movements: number; checks: { key: string; label: string; expected: number | null; actual: number | null; status: string; note: string | null }[] };

export async function buildMart(db: PrismaClient, orgId: string): Promise<MartSummary> {
  const sizes = await loadReportSizes(orgId);
  const priceRows = ((await loadRetailPricesState(orgId))?.value as { rows?: { acode: string; color: string; size: string; price: number }[] } | undefined)?.rows ?? [];
  const price = new Map<string, number>();
  for (const p of priceRows) { const k = `${p.acode}|${p.color}|${p.size}`; if (!price.has(k)) price.set(k, p.price); }

  // Партии (ТЗ): закупка единицы с работой, 4 % и расходами; по модели. Цвета и размеры ТЗ пока не сопоставлены с изделием отчёта (estimated).
  const orderRows = (await loadOrderRows(orgId, "all", "on")).filter((o) => o.group === "done" && o.qty > 0);
  const partiesByModel = new Map<string, { id: string; number: string; qty: number; unit: number; work: number }[]>();
  for (const o of orderRows) {
    const code = normCode(o.modelName ?? "");
    const arr = partiesByModel.get(code) ?? [];
    arr.push({ id: o.id, number: o.number, qty: o.qty, unit: (o.costIncl + o.work) / o.qty, work: o.work / o.qty });
    partiesByModel.set(code, arr);
  }
  const avgOf = (ps: { qty: number; unit: number }[]) => { const q = ps.reduce((a, p) => a + p.qty, 0); return q > 0 ? ps.reduce((a, p) => a + p.qty * p.unit, 0) / q : null; };

  const lines = await db.salesReceiptLine.findMany({ where: { organizationId: orgId, modelCode: { not: null } }, select: { modelCode: true, article: true, colorId: true, kind: true, date: true, season: true, pcs: true, retailRub: true } });

  const now = new Date();
  let skuCount = 0, partyCount = 0;
  const flagsOf: Record<string, string[]> = {};
  let sumConf = 0, sumDeliv = 0, sumSold = 0, sumStock = 0, sumRetail = 0, sumCostAvg = 0, sumCostRep = 0, oversold = 0, oversoldUnits = 0, noTz = 0, noTzUnits = 0;

  await db.$transaction(async (tx) => {
    await tx.dmCostParty.deleteMany({ where: { organizationId: orgId } });
    await tx.dmSku.deleteMany({ where: { organizationId: orgId } }); // каскадом: сезоны и остатки
    await tx.dmMovement.deleteMany({ where: { organizationId: orgId } });
    await tx.dmCheck.deleteMany({ where: { organizationId: orgId } });

    for (const r of sizes) {
      const modelCode = normCode(r.modelCode ?? r.acode.split("/")[0] ?? "");
      const seas = r.seas ?? {};
      const deliv = SEASONS.reduce((a, s) => a + n(seas[s]?.deliv), 0);
      const confOf = (s: (typeof SEASONS)[number]) => (s === "FW26/27" ? n(seas[s]?.conf) : n(seas[s]?.conf ?? seas[s]?.deliv));
      const conf = SEASONS.reduce((a, s) => a + confOf(s), 0);
      const sold = n(r.sold), stock = deliv - sold;
      const delivEur = SEASONS.reduce((a, s) => a + n(seas[s]?.delivEur), 0);
      const p = price.get(`${r.acode}|${r.color}|${r.size}`) ?? null;
      const parties = partiesByModel.get(modelCode) ?? [];
      const unitAvg = avgOf(parties);
      const unitRep = deliv > 0 && delivEur > 0 ? (delivEur / deliv) * RETAIL_RATE : null;
      const flags: string[] = [];
      if (stock < 0) flags.push("продано сверх прихода отчёта");
      if (!parties.length) flags.push("нет ТЗ для закупки");
      if (unitAvg && unitRep && Math.abs(unitAvg - unitRep) > unitRep * 0.05) flags.push("закупка по ТЗ и по отчёту расходится > 5 %");
      if (stock > 0 && p === null) flags.push("нет цены в прайсе");

      const sku = await tx.dmSku.create({ data: {
        organizationId: orgId, modelCode, acode: r.acode, color: r.color, size: r.size, cls: r.cls, fur: r.fur ?? null, cat1: r.l2 ?? null, cat2: r.l4 || r.l5 || null, builtAt: now,
        seasons: { create: SEASONS.filter((s) => seas[s]).map((s) => { const c = seas[s]!; return { season: s, conf: confOf(s), deliv: n(c.deliv), confEur: s === "FW26/27" ? n(c.confEur) : n(c.confEur ?? c.delivEur), delivEur: n(c.delivEur), soldAll: n(c.soldAll), soldSsn: n(c.soldSsn), soldOld: n(c.soldOld), rubAll: n(c.rubAll), discAll: n(c.discAll), scAll: n(c.scAll) }; }) },
        stock: { create: { deliv, sold, stock, retailPrice: p, stockRetailRub: p ? stock * p : 0, unitCostAvgRub: unitAvg, unitCostReportRub: unitRep, stockCostAvgRub: unitAvg ? Math.max(0, stock) * unitAvg : null, stockCostReportRub: unitRep ? Math.max(0, stock) * unitRep : null, costSource: parties.length ? "ТЗ (средневзвешенно по модели)" : unitRep ? "отчёт (SC EUR × 110)" : null, flags } },
      }, select: { id: true } });
      skuCount++;
      if (parties.length) {
        await tx.dmCostParty.createMany({ data: parties.map((x) => ({ organizationId: orgId, skuId: sku.id, orderId: x.id, orderNumber: x.number, qty: x.qty, unitCostRub: x.unit, workRub: x.work, estimated: true })) });
        partyCount += parties.length;
      }
      sumConf += conf; sumDeliv += deliv; sumSold += sold; sumStock += stock; sumRetail += p ? stock * p : 0;
      sumCostAvg += unitAvg ? Math.max(0, stock) * unitAvg : 0; sumCostRep += unitRep ? Math.max(0, stock) * unitRep : 0;
      if (stock < 0) { oversold++; oversoldUnits += -stock; }
      if (!parties.length && stock > 0) { noTz++; noTzUnits += stock; }
      flagsOf[sku.id] = flags;
    }

    if (lines.length) {
      for (let i = 0; i < lines.length; i += 2000) {
        await tx.dmMovement.createMany({ data: lines.slice(i, i + 2000).map((l) => ({ organizationId: orgId, modelCode: normCode(l.modelCode ?? ""), acode: l.article, color: l.colorId ?? "", kind: l.kind, date: l.date, season: l.season, pcs: l.pcs ?? 0, retailRub: n(l.retailRub) })) });
      }
    }
  }, { timeout: 300_000, maxWait: 20_000 });

  const fileReceipts = lines.filter((l) => l.kind === "RECEIPT").reduce((a, l) => a + (l.pcs ?? 0), 0);
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const checks: MartSummary["checks"] = [
    { key: "ordered", label: "Заказано, шт. (отчёт)", expected: MART_EXPECTED.ordered, actual: sumConf, status: eq(sumConf, MART_EXPECTED.ordered) ? "ok" : "fail", note: null },
    { key: "received", label: "Получено, шт. (отчёт)", expected: MART_EXPECTED.received, actual: sumDeliv, status: eq(sumDeliv, MART_EXPECTED.received) ? "ok" : "fail", note: null },
    { key: "sold", label: "Продано товара сезона, шт.", expected: MART_EXPECTED.sold, actual: sumSold, status: eq(sumSold, MART_EXPECTED.sold) ? "ok" : "fail", note: null },
    { key: "stock", label: "Остаток, шт. (получено − продано)", expected: MART_EXPECTED.stock, actual: sumStock, status: eq(sumStock, MART_EXPECTED.stock) ? "ok" : "fail", note: null },
    { key: "stockRetail", label: "Остаток по прайсу по размерам, ₽", expected: MART_EXPECTED.stockRetailRub, actual: sumRetail, status: eq(sumRetail, MART_EXPECTED.stockRetailRub) ? "ok" : "fail", note: null },
    { key: "fileVsReport", label: "Приход по строкам файла и по отчёту, шт.", expected: sumDeliv, actual: fileReceipts, status: eq(fileReceipts, sumDeliv) ? "ok" : "info", note: eq(fileReceipts, sumDeliv) ? null : `в файле на ${fileReceipts - sumDeliv} шт. больше: даты есть только в файле, штуки берём из отчёта` },
    { key: "oversold", label: "Размеры с продажей сверх прихода", expected: 0, actual: oversold, status: oversold === 0 ? "ok" : "info", note: oversold ? `${oversoldUnits} шт. проданы из товара до FW25 или не попали в отчёт; на экранах остаток «–»` : null },
    { key: "noTz", label: "Остаток без ТЗ для закупки, шт.", expected: 0, actual: noTzUnits, status: noTz === 0 ? "ok" : "warn", note: noTz ? `${noTz} размеров: закупку берём из отчёта (SC EUR × 110)` : null },
    { key: "costAvgVsReport", label: "Закупка остатка: ТЗ (средневзв.) против отчёта, ₽", expected: sumCostRep, actual: sumCostAvg, status: sumCostRep > 0 && Math.abs(sumCostAvg - sumCostRep) <= sumCostRep * 0.05 ? "ok" : "warn", note: sumCostRep > 0 ? `разница ${(((sumCostAvg - sumCostRep) / sumCostRep) * 100).toFixed(1)} %; цвета и размеры ТЗ пока не сопоставлены с изделиями (оценка по модели)` : null },
  ];
  await db.dmCheck.createMany({ data: checks.map((c) => ({ organizationId: orgId, key: c.key, label: c.label, expected: c.expected, actual: c.actual, status: c.status, note: c.note, builtAt: now })) });
  return { skus: skuCount, parties: partyCount, movements: lines.length, checks };
}
