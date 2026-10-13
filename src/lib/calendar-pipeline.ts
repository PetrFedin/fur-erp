import { orderLabel } from "@/lib/order-label";
import "server-only";
// «Конвейер» изделий для календаря (режимы «По месяцам» и «Стадии», карточки): одна запись на ТЗ.
// Количество, вид меха, группа, статус и состав сырья — из loadOrdersDrill (те же числа, что на Главной, в «ТЗ», «Партиях», «Изделиях»):
// Σ изделий всех стадий кроме «Ремонт» = «Произведено» Главной (production-totals.ts, orderUnits). Ремонт — отдельно.
// Даты не выдумываются: ожидаемая дата берётся из лучшего доступного источника, иначе null.
import { prisma } from "@/lib/prisma";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { REPAIR_CATEGORY } from "@/lib/dashboard-calc";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { orderYearOf } from "@/lib/year-scope";
import { ymd } from "@/lib/calendar-grid";
import type { Stage } from "@/lib/calendar-actions";
import type { YearFilter } from "@/lib/year-filter";

export type DateSrc = { date: string; source: string };
export type RawSrc = { lotId: string; lotNumber: string | null; purchaseId: string | null; purchaseNumber: string | null; auction: string; material: string; qty: number; receivedDate: string | null; expectedDate: string | null; purchaseStatus: string | null };

export type PipeItem = {
  id: string;
  number: string;
  wo: string | null;
  /** Позиция внутри ТЗ с общим номером («поз. 2/3»); null — ТЗ из одной позиции или без номера. */
  pos: { i: number; n: number } | null;
  articleCode: string;
  articleLabel: string;
  fur: string;
  grp: string;
  cat: string;
  qty: number;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  /** Изделия по стадиям (Σ = qty). У завершённого ТЗ — «готово» и «отгружено», у ремонта — «ремонт». */
  units: Partial<Record<Stage, number>>;
  /** Главная стадия для подписи. */
  stage: Stage;
  stageWord: string;
  batchLabel: string;
  batchNo: string;
  year: number | null;
  startDate: string | null;
  endDate: string | null;
  workOrderDate: string | null;
  /** Ожидаемая (или фактическая у завершённого) дата и источник; null — даты нет. */
  expected: DateSrc | null;
  /** Дата, по которой ТЗ попадает в месяц таблицы (в году ТЗ); null — «без даты». */
  bucket: string | null;
  overdue: boolean;
  raw: RawSrc[];
  rawDate: DateSrc | null;
  eventIds: string[];
};

const dOrNull = (d: Date | null | undefined) => (d ? ymd(d) : null);

/** Все ТЗ организации (без отменённых) за год шапки как «конвейер»; today — для просрочки. */
export async function loadPipeline(orgId: string, year: YearFilter, today: string): Promise<PipeItem[]> {
  const c4 = await getCommission4Mode();
  const drill = await loadOrdersDrill(orgId, year, c4, { hides: false });
  const ids = drill.map((o) => o.id);
  if (ids.length === 0) return [];
  const lotIds = [...new Set(drill.flatMap((o) => o.lines.map((l) => l.lot)))];

  const [orders, shipLines, lots, events, supply] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, id: { in: ids } },
      select: { id: true, productModelId: true, productModel: { select: { name: true } }, startDate: true, endDate: true, workOrderDate: true, batch: { select: { year: true } } },
    }),
    prisma.shipmentLine.groupBy({ by: ["productionOrderId"], where: { productionOrderId: { in: ids }, shipment: { organizationId: orgId, status: "SHIPPED" } }, _sum: { quantity: true } }),
    lotIds.length
      ? prisma.rawMaterialLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, receivedDate: true, purchase: { select: { status: true, expectedDate: true, receivedDate: true } } } })
      : Promise.resolve([]),
    prisma.calendarEvent.findMany({ where: { organizationId: orgId, orderId: { in: ids } }, select: { id: true, orderId: true, date: true, endDate: true, doneAt: true } }),
    prisma.supplyPlanEntry.findMany({ where: { organizationId: orgId, status: { notIn: ["CANCELLED", "PRODUCED"] }, eventDate: { not: null } }, select: { productModelId: true, eventDate: true } }),
  ]);
  const oById = new Map(orders.map((o) => [o.id, o]));
  const shipped = new Map(shipLines.map((s) => [s.productionOrderId, s._sum.quantity ?? 0]));
  const lotBy = new Map(lots.map((l) => [l.id, l]));
  const evBy = new Map<string, typeof events>();
  for (const e of events) if (e.orderId) evBy.set(e.orderId, [...(evBy.get(e.orderId) ?? []), e]);
  const supplyBy = new Map<string, string[]>();
  for (const s of supply) if (s.eventDate) supplyBy.set(s.productModelId, [...(supplyBy.get(s.productModelId) ?? []), ymd(s.eventDate)]);

  const out: PipeItem[] = [];
  for (const d of drill) {
    const o = oById.get(d.id);
    if (!o) continue;
    const startDate = dOrNull(o.startDate);
    const endDate = dOrNull(o.endDate);
    const workOrderDate = dOrNull(o.workOrderDate);
    const repair = d.cat === REPAIR_CATEGORY;

    // Сырьё: лоты, списанные в ТЗ (по строкам Главной), со сроками закупки.
    const rawMap = new Map<string, RawSrc>();
    for (const l of d.lines) {
      if (l.k !== "f") continue;
      const lot = lotBy.get(l.lot);
      const prev = rawMap.get(l.lot);
      if (prev) { prev.qty += l.q; continue; }
      rawMap.set(l.lot, {
        lotId: l.lot, lotNumber: l.ln, purchaseId: l.pid, purchaseNumber: l.pn, auction: l.au, material: l.n, qty: l.q,
        receivedDate: dOrNull(lot?.receivedDate), expectedDate: dOrNull(lot?.purchase?.expectedDate), purchaseStatus: lot?.purchase?.status ?? null,
      });
    }
    const raw = [...rawMap.values()];
    const rawLatest = raw.map((r) => r.receivedDate).filter((x): x is string => !!x).sort().pop();
    const rawExpected = raw.map((r) => r.expectedDate).filter((x): x is string => !!x).sort().pop();
    const rawDate: DateSrc | null = rawLatest ? { date: rawLatest, source: "по поставке лота" } : rawExpected ? { date: rawExpected, source: "по сроку закупки" } : null;

    // Стадии изделий.
    const done = d.st === "COMPLETED";
    const sh = Math.min(shipped.get(d.id) ?? 0, d.qty);
    const units: PipeItem["units"] = {};
    let stage: Stage;
    let stageWord: string;
    if (repair) { stage = "repair"; stageWord = "ремонт"; units.repair = d.qty; }
    else if (done) {
      if (sh > 0) units.shipped = sh;
      if (d.qty - sh > 0) units.ready = d.qty - sh;
      stage = sh >= d.qty && d.qty > 0 ? "shipped" : "ready";
      stageWord = sh >= d.qty && d.qty > 0 ? "отгружено" : sh > 0 ? `отгружено ${sh} из ${d.qty}` : "готово";
    } else if (d.st === "IN_PROGRESS") { stage = "work"; stageWord = "в работе"; units.work = d.qty; }
    else if (raw.length > 0) { stage = "raw"; stageWord = "сырьё есть"; units.raw = d.qty; }
    else { stage = "plan"; stageWord = "план"; units.plan = d.qty; }

    // Ожидаемая / фактическая дата — лучший источник по порядку.
    const evs = (evBy.get(d.id) ?? []).filter((e) => !e.doneAt);
    const evDate = evs.map((e) => ymd(e.endDate ?? e.date)).sort()[0];
    const sup = (supplyBy.get(o.productModelId) ?? []).sort();
    const supDate = sup.find((x) => x >= today) ?? sup[sup.length - 1];
    let expected: DateSrc | null = null;
    if (endDate) expected = { date: endDate, source: done ? "факт: окончание ТЗ" : "по плану ТЗ" };
    else if (evDate && !done) expected = { date: evDate, source: "по событию календаря" };
    else if (rawDate && !done && stage !== "work") expected = { date: rawDate.date, source: rawDate.source };
    else if (supDate && !done) expected = { date: supDate, source: "по плану поставок" };
    else if (workOrderDate) expected = { date: workOrderDate, source: "по дате ТЗ" };
    else if (startDate) expected = { date: startDate, source: "по дате старта ТЗ" };

    // Месяц таблицы: первая из известных дат, лежащая в году ТЗ (год ТЗ — по тому же правилу, что в фильтре года).
    const yr = orderYearOf({ workOrderDate: o.workOrderDate, endDate: o.endDate, startDate: o.startDate, batch: o.batch });
    const cands = [expected?.date, endDate, workOrderDate, startDate].filter((x): x is string => !!x);
    const bucket = (yr == null ? cands[0] : cands.find((x) => Number(x.slice(0, 4)) === yr)) ?? null;

    const overdue = !done && !repair && expected != null && expected.date < today && (expected.source === "по плану ТЗ" || expected.source === "по событию календаря");
    out.push({
      id: d.id, number: d.number, wo: d.wo, pos: null, articleCode: o.productModel.name, articleLabel: d.ml, fur: d.fur, grp: d.grp, cat: d.cat, qty: d.qty, status: d.st,
      units, stage, stageWord, batchLabel: d.bl, batchNo: d.bk, year: d.y, startDate, endDate, workOrderDate, expected, bucket, overdue, raw, rawDate,
      eventIds: (evBy.get(d.id) ?? []).map((e) => e.id),
    });
  }
  // Позиции одного ТЗ (общий номер из документа): «поз. 2/3» по порядку внутренних номеров.
  const byWo = new Map<string, PipeItem[]>();
  for (const p of out) if (p.wo) { const g = byWo.get(p.wo); if (g) g.push(p); else byWo.set(p.wo, [p]); }
  for (const g of byWo.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.number.localeCompare(b.number, "ru"));
    g.forEach((p, i) => { p.pos = { i: i + 1, n: g.length }; });
  }
  return out;
}

/** Единая подпись ТЗ (order-label.ts): «ТЗ 182 · поз. 2/3», «ТЗ 182», без рабочего № — «Заказ П-…». Внутренний «П-2026-…» — только в подсказках (pipeInner). */
export const pipeTitle = (p: PipeItem) => orderLabel({ workOrderNumber: p.wo, number: p.number, posIndex: p.pos?.i, posCount: p.pos?.n });
/** Внутренний номер для title/«i»: « (П-2026-0129)»; пусто, если рабочего номера нет (он и так в заголовке). */
export const pipeInner = (p: PipeItem) => (p.wo ? ` (${p.number})` : "");
