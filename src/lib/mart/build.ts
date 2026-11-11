import "server-only";
import type { PrismaClient } from "@prisma/client";
import { loadReportSizes } from "@/lib/margin-server";
import { buildPlanTables } from "@/lib/mart/plans";
import { buildChainTables, type ChainCounts } from "@/lib/mart/chain";
import { loadRetailPricesState, loadReportSizesState } from "@/lib/import-keys";
import { normCode, colorOfLine } from "@/lib/sales-receipts-core";
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

// ───── Сопоставление партий (ТЗ) с изделиями отчёта: модель · цвет · размер ─────
/** Цвет в сравнимом виде: заглавные, «Ё» → «Е», без лишних пробелов. */
const ck = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/Ё/g, "Е").replace(/\s+/g, " ").trim();
/** Названия цветов отчёта, которых нет в справочнике цветов: к какому цвету справочника относятся. */
const EXTRA_COLOR_ALIASES: Record<string, string> = { TORTOR: "Тортора", VIOLET: "Виолет", BORDEAUX: "Бордовый", ORANGE: "Оранжевый" };
/** Размеры ТЗ: «42, 44, 44, 46», «42,44», «единый размер» → ["42","44","44","46"], ["NS"]. */
function parseTzSizes(raw: string | null | undefined): string[] {
  const t = (raw ?? "").trim();
  if (!t) return [];
  if (/един/i.test(t)) return ["NS"];
  return t.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^(\d{1,2}|NS)$/i.test(x)).map((x) => x.toUpperCase());
}
type Level = "size" | "color" | "model";

export type MartSummary = { skus: number; parties: number; movements: number; checks: { key: string; label: string; expected: number | null; actual: number | null; status: string; note: string | null }[] };

export async function buildMart(db: PrismaClient, orgId: string): Promise<MartSummary> {
  const sizes = await loadReportSizes(orgId);
  const priceRows = ((await loadRetailPricesState(orgId))?.value as { rows?: { acode: string; color: string; size: string; price: number }[] } | undefined)?.rows ?? [];
  const price = new Map<string, number>();
  for (const p of priceRows) { const k = `${p.acode}|${p.color}|${p.size}`; if (!price.has(k)) price.set(k, p.price); }

  // Партии (ТЗ): закупка единицы с работой, 4 % и расходами; цвета и размеры ТЗ сопоставляются с изделиями отчёта (модель · цвет · размер).
  const orderRows = (await loadOrderRows(orgId, "all", "on")).filter((o) => o.group === "done" && o.qty > 0);
  const colorRefs = await db.colorRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true } });
  const refByAlias = new Map<string, string>();
  for (const c of colorRefs) { refByAlias.set(ck(c.name), c.id); for (const a of c.aliases) refByAlias.set(ck(a), c.id); }
  for (const [alias, name] of Object.entries(EXTRA_COLOR_ALIASES)) { const id = colorRefs.find((c) => c.name === name)?.id; if (id && !refByAlias.has(alias)) refByAlias.set(alias, id); }
  const refOfReportColor = (raw: string) => refByAlias.get(ck(colorOfLine(raw))) ?? null;
  const refName = new Map(colorRefs.map((c) => [c.id, c.name]));
  const aliasRows = new Map<string, { alias: string; colorCanon: string; colorRefId: string | null; origin: string }>();
  /** Канонический цвет: по справочнику, иначе само написание (в верхнем регистре); все синонимы попадают в DmColorAlias. */
  const canonOf = (raw: string | null | undefined): { canon: string; refId: string | null } => {
    const key = ck(colorOfLine(raw ?? ""));
    const refId = refByAlias.get(key) ?? null;
    const canon = refId ? ck(refName.get(refId)) : key;
    if (key && !aliasRows.has(key)) aliasRows.set(key, { alias: key, colorCanon: canon, colorRefId: refId, origin: refId ? (EXTRA_COLOR_ALIASES[key] ? "extra" : "ref") : "auto" });
    return { canon, refId };
  };
  const skuKeyOf = (acode: string, canon: string, size: string) => `${ck(acode)}|${canon}|${String(size).toUpperCase()}`;
  const tzRaw = await db.productionOrder.findMany({ where: { organizationId: orgId, id: { in: orderRows.map((o) => o.id) } }, select: { id: true, size: true, colorRefId: true, colors: { select: { colorRefId: true, quantity: true, sizes: true } } } });
  const tzById = new Map(tzRaw.map((t) => [t.id, t]));
  /** Единицы партии по (цвет справочника, размер): сколько штук какого цвета и размера. */
  const tzUnits = (id: string, qty: number): { color: string | null; size: string | null; units: number }[] => {
    const t = tzById.get(id);
    const rows = t?.colors.length ? t.colors.map((c) => ({ color: c.colorRefId as string | null, q: c.quantity ?? 0, sizes: parseTzSizes(c.sizes) })) : [{ color: t?.colorRefId ?? null, q: qty, sizes: parseTzSizes(t?.size) }];
    const totalQ = rows.reduce((a, r) => a + r.q, 0) || 1;
    const out: { color: string | null; size: string | null; units: number }[] = [];
    for (const r of rows) {
      const q = (r.q / totalQ) * qty;
      if (!r.sizes.length) { out.push({ color: r.color, size: null, units: q }); continue; }
      for (const sz of new Set(r.sizes)) out.push({ color: r.color, size: sz, units: (q * r.sizes.filter((x) => x === sz).length) / r.sizes.length });
    }
    return out;
  };
  const tzParties = orderRows.map((o) => ({ id: o.id, number: o.number, model: normCode(o.modelName ?? ""), qty: o.qty, unit: (o.costIncl + o.work) / o.qty, work: o.work / o.qty, units: tzUnits(o.id, o.qty) }));
  const partiesByModel = new Map<string, typeof tzParties>();
  for (const p of tzParties) { const a = partiesByModel.get(p.model) ?? []; a.push(p); partiesByModel.set(p.model, a); }

  // Изделия модели (для сопоставления): ключ — модель; внутри индекс по цвету справочника и размеру
  type SkuInfo = { idx: number; color: string | null; colorRaw: string; size: string; deliv: number };
  const skusByModel = new Map<string, SkuInfo[]>();
  sizes.forEach((r, idx) => { const m = normCode(r.modelCode ?? r.acode.split("/")[0] ?? ""); const a = skusByModel.get(m) ?? []; a.push({ idx, color: refOfReportColor(r.color), colorRaw: ck(colorOfLine(r.color)), size: String(r.size).toUpperCase(), deliv: SEASONS.reduce((x, se) => x + n(r.seas?.[se]?.deliv), 0) }); skusByModel.set(m, a); });
  /** Партии, отнесённые к изделию отчёта: idx → [{партия, штук, точность}] */
  const assigned = new Map<number, { p: (typeof tzParties)[number]; q: number; level: Level }[]>();
  const spread = (list: SkuInfo[], units: number, p: (typeof tzParties)[number], level: Level) => {
    const w = list.reduce((a, x) => a + (x.deliv > 0 ? x.deliv : 0), 0);
    for (const x of list) { const share = w > 0 ? (x.deliv > 0 ? x.deliv : 0) / w : 1 / list.length; if (share <= 0) continue; const arr = assigned.get(x.idx) ?? []; arr.push({ p, q: units * share, level }); assigned.set(x.idx, arr); }
  };
  for (const p of tzParties) {
    const list = skusByModel.get(p.model) ?? [];
    if (!list.length) continue;
    for (const u of p.units) {
      const byColor = u.color ? list.filter((x) => x.color === u.color) : [];
      const exact = u.size ? byColor.filter((x) => x.size === u.size) : [];
      if (exact.length) spread(exact, u.units, p, "size");
      else if (byColor.length) spread(byColor, u.units, p, "color");
      else spread(list, u.units, p, "model");
    }
  }
  const avgOf = (ps: { q: number; p: { unit: number } }[]) => { const q = ps.reduce((a, x) => a + x.q, 0); return q > 0 ? ps.reduce((a, x) => a + x.q * x.p.unit, 0) / q : null; };

  const lines = await db.salesReceiptLine.findMany({ where: { organizationId: orgId, modelCode: { not: null } }, select: { modelCode: true, article: true, colorId: true, kind: true, date: true, season: true, pcs: true, retailRub: true } });

  const now = new Date();
  let skuCount = 0, partyCount = 0;
  const flagsOf: Record<string, string[]> = {};
  let sumConf = 0, sumDeliv = 0, sumSold = 0, sumStock = 0, sumRetail = 0, sumCostAvg = 0, sumCostRep = 0, oversold = 0, oversoldUnits = 0, noTz = 0, noTzUnits = 0;

  const chainRef: { v: ChainCounts | null } = { v: null };
  await db.$transaction(async (tx) => {
    await tx.dmCostParty.deleteMany({ where: { organizationId: orgId } });
    await tx.dmSku.deleteMany({ where: { organizationId: orgId } }); // каскадом: сезоны и остатки
    await tx.dmMovement.deleteMany({ where: { organizationId: orgId } });
    await tx.dmCheck.deleteMany({ where: { organizationId: orgId } });
    await tx.dmRetailPrice.deleteMany({ where: { organizationId: orgId } });
    await tx.dmColorAlias.deleteMany({ where: { organizationId: orgId } });
    await tx.dmLoad.deleteMany({ where: { organizationId: orgId } });

    for (const [skuIdx, r] of sizes.entries()) {
      const modelCode = normCode(r.modelCode ?? r.acode.split("/")[0] ?? "");
      const seas = r.seas ?? {};
      const deliv = SEASONS.reduce((a, s) => a + n(seas[s]?.deliv), 0);
      const confOf = (s: (typeof SEASONS)[number]) => (s === "FW26/27" ? n(seas[s]?.conf) : n(seas[s]?.conf ?? seas[s]?.deliv));
      const conf = SEASONS.reduce((a, s) => a + confOf(s), 0);
      const sold = n(r.sold), stock = deliv - sold;
      const delivEur = SEASONS.reduce((a, s) => a + n(seas[s]?.delivEur), 0);
      const p = price.get(`${r.acode}|${r.color}|${r.size}`) ?? null;
      const parties = assigned.get(skuIdx) ?? [];
      const modelParties = partiesByModel.get(modelCode) ?? [];
      const unitModel = !parties.length && modelParties.length ? avgOf(modelParties.map((x) => ({ q: x.qty, p: x }))) : null;
      const unitAvg = avgOf(parties) ?? unitModel;
      const lvlQ: Record<Level, number> = { size: 0, color: 0, model: 0 }; for (const x of parties) lvlQ[x.level] += x.q;
      const topLevel: Level = lvlQ.size >= lvlQ.color && lvlQ.size >= lvlQ.model ? "size" : lvlQ.color >= lvlQ.model ? "color" : "model";
      const unitRep = deliv > 0 && delivEur > 0 ? (delivEur / deliv) * RETAIL_RATE : null;
      const flags: string[] = [];
      if (stock < 0) flags.push("продано сверх прихода отчёта");
      if (!parties.length) flags.push(unitModel ? "своей партии ТЗ нет: средняя по модели" : "нет ТЗ для закупки");
      if (unitAvg && unitRep && Math.abs(unitAvg - unitRep) > unitRep * 0.05) flags.push("закупка по ТЗ и по отчёту расходится > 5 % (справочно)");
      if (stock > 0 && p === null) flags.push("нет цены в прайсе");

      const sku = await tx.dmSku.create({ data: {
        organizationId: orgId, modelCode, acode: r.acode, color: r.color, size: r.size, skuKey: skuKeyOf(r.acode, canonOf(r.color).canon, r.size), colorRefId: canonOf(r.color).refId, colorCanon: canonOf(r.color).canon, cls: r.cls, fur: r.fur ?? null, cat1: r.l2 ?? null, cat2: r.l4 || r.l5 || null, builtAt: now,
        seasons: { create: SEASONS.filter((s) => seas[s]).map((s) => { const c = seas[s]!; return { season: s, conf: confOf(s), deliv: n(c.deliv), confEur: s === "FW26/27" ? n(c.confEur) : n(c.confEur ?? c.delivEur), delivEur: n(c.delivEur), soldAll: n(c.soldAll), soldSsn: n(c.soldSsn), soldOld: n(c.soldOld), rubAll: n(c.rubAll), discAll: n(c.discAll), scAll: n(c.scAll) }; }) },
        stock: { create: { deliv, sold, stock, retailPrice: p, stockRetailRub: p ? stock * p : 0, unitCostAvgRub: unitAvg, unitCostReportRub: unitRep, stockCostAvgRub: unitAvg ? Math.max(0, stock) * unitAvg : null, stockCostReportRub: unitRep ? Math.max(0, stock) * unitRep : null, costSource: parties.length ? `ТЗ, средневзвешенно (сопоставлено по: ${topLevel === "size" ? "модели, цвету и размеру" : topLevel === "color" ? "модели и цвету" : "модели"})`   : unitModel ? "ТЗ, средняя по модели (своей партии нет)" : null, flags } },
      }, select: { id: true } });
      skuCount++;
      if (parties.length) {
        await tx.dmCostParty.createMany({ data: parties.map((x) => ({ organizationId: orgId, skuId: sku.id, orderId: x.p.id, orderNumber: x.p.number, qty: x.q, unitCostRub: x.p.unit, workRub: x.p.work, estimated: x.level !== "size", matchLevel: x.level })) });
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
        await tx.dmMovement.createMany({ data: lines.slice(i, i + 2000).map((l) => ({ organizationId: orgId, modelCode: normCode(l.modelCode ?? ""), acode: l.article, color: l.colorId ?? "", colorKey: `${normCode(l.modelCode ?? "")}|${canonOf(l.colorId).canon}`, kind: l.kind, date: l.date, season: l.season, pcs: l.pcs ?? 0, retailRub: n(l.retailRub) })) });
      }
    }

    // Розничные цены из присланного прайса: по единому ключу изделия
    const priceState = await loadRetailPricesState(orgId);
    const priceAsOf = ((priceState?.value as { asOf?: string } | undefined)?.asOf) ?? null;
    if (priceRows.length) {
      const data = priceRows.map((x) => ({ organizationId: orgId, skuKey: skuKeyOf(x.acode, canonOf(x.color).canon, x.size), acode: x.acode, color: x.color, size: String(x.size), price: x.price, asOf: priceAsOf, source: priceState?.key ?? "retail-prices" }));
      for (let i = 0; i < data.length; i += 2000) await tx.dmRetailPrice.createMany({ data: data.slice(i, i + 2000) });
    }
    // Синонимы цветов: весь справочник + всё, что встретилось в источниках
    for (const c of colorRefs) { canonOf(c.name); for (const al of c.aliases) canonOf(al); }
    if (aliasRows.size) await tx.dmColorAlias.createMany({ data: [...aliasRows.values()].map((x) => ({ organizationId: orgId, ...x })) });
    const plan = await buildPlanTables(tx, orgId, { normCode, canonOf });
    chainRef.v = await buildChainTables(tx, orgId, canonOf);
    const chain = chainRef.v;
    // Журнал загрузок: какие версии источников разложены в массив
    const sizesState = await loadReportSizesState(orgId);
    await tx.dmLoad.createMany({ data: [
      { organizationId: orgId, source: "report-sizes", sourceKey: sizesState?.key ?? "sales-report-sizes", asOf: ((sizesState?.value as { asOf?: string } | undefined)?.asOf) ?? null, rows: sizes.length, note: "отчёт «заказ и продажи» по модель · цвет · размер · сезон" },
      { organizationId: orgId, source: "retail-prices", sourceKey: priceState?.key ?? "retail-prices", asOf: priceAsOf, rows: priceRows.length, note: "розничный прайс по размерам" },
      { organizationId: orgId, source: "receipt-lines", sourceKey: "SalesReceiptLine", asOf: null, rows: lines.length, note: "приходы и продажи по датам" },
      { organizationId: orgId, source: "plan-budget", sourceKey: "budget-pcs:*", asOf: null, rows: plan.planLines, note: `бюджет штук; параметров ${plan.planParams}` },
      { organizationId: orgId, source: "presentation", sourceKey: "SystemState: FW27 presentation", asOf: null, rows: plan.presentationItems, note: "позиции презентации сезона" },
      { organizationId: orgId, source: "shipment-zi", sourceKey: "shipment-zi:*", asOf: null, rows: plan.shipmentLines, note: "строки зачётов по отгрузке" },
      { organizationId: orgId, source: "owner-decisions", sourceKey: "owner-decision:*", asOf: null, rows: plan.decisions, note: "решения владельца" },
      { organizationId: orgId, source: "raw-chain", sourceKey: "Purchase/RawMaterialLot/ProductionMaterialUsage", asOf: null, rows: chain ? chain.lots : 0, note: chain ? `закупок ${chain.purchases}, лотов ${chain.lots}, расходов лота в ТЗ ${chain.lotUses}` : null },
      { organizationId: orgId, source: "payments", sourceKey: "Payment/ProductionPayment/PaymentAllocation", asOf: null, rows: chain ? chain.payments : 0, note: chain ? `распределений ${chain.allocations}, расходов ТЗ ${chain.expenses}` : null },
      { organizationId: orgId, source: "tz-parties", sourceKey: "ProductionOrder", asOf: null, rows: tzParties.length, note: "партии себестоимости по ТЗ" },
    ] });
  }, { timeout: 300_000, maxWait: 20_000 });

  const mq = { size: 0, color: 0, model: 0 }; for (const arr of assigned.values()) for (const x of arr) mq[x.level] += x.q;
  const mqSum = mq.size + mq.color + mq.model || 1;
  const matchShare = { size: mq.size / mqSum, color: mq.color / mqSum, model: mq.model / mqSum };
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
    { key: "noTz", label: "Остаток без ТЗ для закупки, шт.", expected: 0, actual: noTzUnits, status: noTz === 0 ? "ok" : "warn", note: noTz ? `${noTz} размеров: своей партии ТЗ нет, берём среднюю ТЗ по модели (если ТЗ модели нет совсем, закупка не считается)` : null },
    { key: "costAvgVsReport", label: "Закупка остатка по ТЗ (эталон) и по отчёту (справка), ₽", expected: sumCostRep, actual: sumCostAvg, status: "info", note: sumCostRep > 0 ? `разница ${(((sumCostAvg - sumCostRep) / sumCostRep) * 100).toFixed(1)} %; партии сопоставлены по размеру ${Math.round(matchShare.size * 100)} %, по цвету ${Math.round(matchShare.color * 100)} %, по модели ${Math.round(matchShare.model * 100)} % штук` : null },
  ];
  const [orphanPrices] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM "DmRetailPrice" WHERE "organizationId" = ${orgId} AND "skuKey" NOT IN (SELECT "skuKey" FROM "DmSku" WHERE "organizationId" = ${orgId})`;
  const [orphanMov] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM "DmMovement" WHERE "organizationId" = ${orgId} AND "colorKey" NOT IN (SELECT "modelCode" || '|' || "colorCanon" FROM "DmSku" WHERE "organizationId" = ${orgId})`;
  const [dupKeys] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM (SELECT "skuKey" FROM "DmSku" WHERE "organizationId" = ${orgId} GROUP BY 1 HAVING count(*) > 1) d`;
  const [shipOrphan] = await db.$queryRaw<{ n: number; total: number }[]>`SELECT count(*) FILTER (WHERE "colorKey" NOT IN (SELECT "modelCode" || '|' || "colorCanon" FROM "DmSku" WHERE "organizationId" = ${orgId}))::int n, count(*)::int total FROM "DmShipmentLine" WHERE "organizationId" = ${orgId}`;
  const [planSum] = await db.$queryRaw<{ pcs: number | null }[]>`SELECT sum(pcs)::int pcs FROM "DmPlanLine" WHERE "organizationId" = ${orgId}`;
  const [purchMis] = await db.$queryRaw<{ n: number; delta: string | null }[]>`SELECT count(*)::int n, sum("lotsCostSum" - "itemsGross" - "expensesSum")::text delta FROM "DmPurchase" WHERE "organizationId" = ${orgId} AND currency = 'RUB' AND status = 'RECEIVED' AND abs("lotsCostSum" - "itemsGross" - "expensesSum") > 1`;
  const chain = chainRef.v;
  if (chain) checks.push(
    { key: "lotNoPurchase", label: "Лоты без закупки", expected: 0, actual: chain.lotsNoPurchase, status: chain.lotsNoPurchase === 0 ? "ok" : "warn", note: chain.lotsNoPurchase ? "лот не привязан к закупке: нет документа и оплаты" : null },
    { key: "lotQtyBalance", label: "Лоты: получено − израсходовано ≠ остаток", expected: 0, actual: chain.lotQtyMismatch, status: chain.lotQtyMismatch === 0 ? "ok" : "warn", note: chain.lotQtyMismatch ? "остаток лота не равен получено минус расход в ТЗ" : null },
    { key: "payOverAlloc", label: "Платежи за работу, распределённые больше суммы", expected: 0, actual: chain.overAllocated, status: chain.overAllocated === 0 ? "ok" : "warn", note: null },
    { key: "purchaseVsLots", label: "Закупки (₽, получены): стоимость лотов не равна позициям с НДС", expected: 0, actual: purchMis?.n ?? 0, status: (purchMis?.n ?? 0) === 0 ? "ok" : "warn", note: purchMis?.n ? `${purchMis.n} закупок: позиции с НДС + расходы ≠ стоимость лотов (разница ${Math.round(Number(purchMis.delta ?? 0)).toLocaleString("ru-RU")} ₽)` : null },
    { key: "usageVsMaterial", label: "Расход лотов в ТЗ и материальная часть ТЗ, ₽", expected: chain.useVsOrderMaterial.orders, actual: chain.useVsOrderMaterial.used, status: "info", note: "расход лотов по строкам против поля materialCost в ТЗ" },
  );
  checks.push(
    { key: "keyDup", label: "Повторы единого ключа изделия", expected: 0, actual: dupKeys?.n ?? 0, status: (dupKeys?.n ?? 0) === 0 ? "ok" : "fail", note: null },
    { key: "priceOrphans", label: "Цены прайса без изделия в отчёте", expected: 0, actual: orphanPrices?.n ?? 0, status: (orphanPrices?.n ?? 0) === 0 ? "ok" : "warn", note: orphanPrices?.n ? "цена есть, а изделия (артикул · цвет · размер) в отчёте нет" : null },
    { key: "shipmentOrphans", label: "Строки зачётов отгрузки без изделия в отчёте", expected: 0, actual: shipOrphan?.n ?? 0, status: (shipOrphan?.n ?? 0) === 0 ? "ok" : "info", note: shipOrphan?.n ? `${shipOrphan.n} из ${shipOrphan.total}: модель и цвет зачёта не совпали с изделиями отчёта (другой сезон, мех или написание цвета)` : null },
    { key: "planPcs", label: "Бюджет штук, всего", expected: null, actual: planSum?.pcs ?? 0, status: "info", note: "сумма строк плана из присланного бюджета" },
    { key: "movementOrphans", label: "Движения файла без изделия в отчёте", expected: 0, actual: orphanMov?.n ?? 0, status: (orphanMov?.n ?? 0) === 0 ? "ok" : "warn", note: null },
  );
  await db.dmCheck.createMany({ data: checks.map((c) => ({ organizationId: orgId, key: c.key, label: c.label, expected: c.expected, actual: c.actual, status: c.status, note: c.note, builtAt: now })) });
  return { skus: skuCount, parties: partyCount, movements: lines.length, checks };
}
