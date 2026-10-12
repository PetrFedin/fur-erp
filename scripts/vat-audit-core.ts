/**
 * Общее ядро аудита НДС по датам (только чтение): scripts/audit-vat-2026.ts и scripts/fix-vat-by-date.ts.
 * Правило: документ до 01.01.2026 → 20%, с 01.01.2026 → 22% (src/lib/vat-by-date.ts).
 * Дата лота — дата закупки (Purchase.orderDate); для однозначности сверяются также дата приёмки закупки,
 * даты УПД (DriveDocument docType=UPD) и дата прихода лота: если они по разные стороны 01.01.2026 — случай «неоднозначный».
 */
import { PrismaClient } from "@prisma/client";
import { VAT_CUTOFF, vatRateForDate } from "../src/lib/vat-by-date";

export type Side = "before" | "from";
export const sideOf = (d: Date): Side => (d.getTime() < VAT_CUTOFF.getTime() ? "before" : "from");
export const expectedRate = (s: Side) => (s === "before" ? 20 : 22);
export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
export const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function loadAudit(prisma: PrismaClient) {
  const lots = await prisma.rawMaterialLot.findMany({
    include: {
      rawMaterial: { select: { name: true, unit: true, defaultVatRate: true } },
      purchase: { select: { id: true, number: true, orderDate: true, receivedDate: true, auctionSession: true } },
      purchaseItems: { select: { id: true, vatRate: true, unitPrice: true, quantity: true, purchase: { select: { number: true, orderDate: true } } } },
    },
    orderBy: { receivedDate: "asc" },
  });
  const items = await prisma.purchaseItem.findMany({
    include: {
      rawMaterial: { select: { name: true, unit: true } },
      purchase: { select: { id: true, number: true, orderDate: true, receivedDate: true } },
      lot: { select: { id: true, vatRate: true, lotNumber: true } },
    },
  });
  const upd = await prisma.driveDocument.findMany({
    where: { docType: "UPD", docDate: { not: null }, OR: [{ purchaseId: { not: null } }, { lotId: { not: null } }] },
    select: { purchaseId: true, lotId: true, docDate: true, docNumber: true },
  });
  const usages = await prisma.productionMaterialUsage.findMany({
    include: {
      lot: true,
      rawMaterial: { select: { name: true, unit: true } },
      productionOrder: { select: { id: true, number: true, status: true } },
    },
    orderBy: [{ productionOrderId: "asc" }, { date: "asc" }],
  });
  return { lots, items, upd, usages };
}
export type AuditData = Awaited<ReturnType<typeof loadAudit>>;
type LotRow = AuditData["lots"][number];

/** Все даты, определяющие ставку лота, и вывод: однозначная сторона или null (даты по разные стороны). */
export function lotDates(l: LotRow, upd: AuditData["upd"]) {
  const dates: { label: string; d: Date }[] = [];
  if (l.purchase) {
    dates.push({ label: "закупка", d: l.purchase.orderDate });
    if (l.purchase.receivedDate) dates.push({ label: "приёмка закупки", d: l.purchase.receivedDate });
  }
  dates.push({ label: "приход лота", d: l.receivedDate });
  for (const u of upd) if ((u.lotId === l.id || (l.purchaseId && u.purchaseId === l.purchaseId)) && u.docDate) dates.push({ label: `УПД ${u.docNumber ?? ""}`.trim(), d: u.docDate });
  const sides = new Set(dates.map((x) => sideOf(x.d)));
  const primary = l.purchase ? l.purchase.orderDate : l.receivedDate;
  return { dates, primary, primarySide: sideOf(primary), unambiguous: sides.size === 1 };
}

export type Finding = {
  type: string;
  lotId?: string;
  itemId?: string;
  orderNumber?: string;
  purchase: string;
  lot: string;
  material: string;
  date: string;
  rate: string;
  expected: string;
  note: string;
};

const N = (x: { toString(): string } | number | null | undefined) => (x == null ? 0 : Number(x.toString()));

export function runChecks(data: AuditData) {
  const f: Finding[] = [];
  const lotLabel = (l: LotRow) => l.lotNumber ?? "без номера";
  const lotFixable = new Map<string, { lot: LotRow; to: number; why: string }>();
  const ambiguous = new Map<string, { lot: LotRow; why: string; dates: string; consistentWith: string }>();

  for (const l of data.lots) {
    const { primary, primarySide, unambiguous, dates } = lotDates(l, data.upd);
    const exp = expectedRate(primarySide);
    const rate = N(l.vatRate);
    const base = { lotId: l.id, purchase: l.purchase?.number ?? "—", lot: lotLabel(l), material: l.rawMaterial.name, date: iso(primary), rate: `${rate}%`, expected: `${exp}%` };
    // Согласованность цен лота со ставкой: НДС материала на единицу ≈ без НДС × ставка
    const excl = N(l.materialCostExclVat), vat = N(l.materialVatAmount);
    const vatAt = (r: number) => Math.abs(vat - (excl * r) / 100);
    const consistentWithExp = vatAt(exp) <= 1;
    const consistentWithOwn = vatAt(rate) <= 1;
    // (d) цены не сходятся со ставкой лота
    if (!consistentWithOwn && excl + vat > 0) {
      f.push({ type: "d", ...base, note: `без НДС ${rub(excl)} + НДС ${rub(vat)} за ед.; по ставке ${rate}% НДС должен быть ${rub((excl * rate) / 100)} (расхождение ${rub(vatAt(rate))} ₽/ед.)` });
    }
    const wrong = rate !== exp;
    if (wrong) {
      const type = primarySide === "before" ? "a" : rate === 20 ? "b" : "b2";
      const dnote = dates.map((x) => `${x.label} ${iso(x.d)}`).join("; ");
      if (!unambiguous) {
        f.push({ type: type + "-неоднозначно", ...base, note: `даты по разные стороны 01.01.2026 (${dnote}) — не исправляется автоматически` });
        ambiguous.set(l.id, { lot: l, why: "даты по разные стороны 2026", dates: dnote, consistentWith: consistentWithExp ? `цены сходятся с ${exp}%` : consistentWithOwn ? `цены сходятся с ${rate}%` : "цены не сходятся" });
      } else if (consistentWithExp) {
        f.push({ type, ...base, note: `дата ${iso(primary)} → ${exp}%, цены лота уже согласованы с ${exp}% — меняется только поле ставки (суммы те же)` });
        lotFixable.set(l.id, { lot: l, to: exp, why: `дата ${iso(primary)} (все даты документов по одну сторону), цены согласованы с ${exp}%` });
      } else {
        f.push({ type: type + "-цены", ...base, note: `дата → ${exp}%, но цены лота согласованы со ставкой ${rate}% (НДС ${rub(vat)} за ед.): нужно решение владельца — менять цены или ставку` });
        ambiguous.set(l.id, { lot: l, why: "цены согласованы со старой ставкой", dates: dnote, consistentWith: consistentWithOwn ? `цены сходятся с ${rate}%` : "цены не сходятся" });
      }
    }
    // (c) лот и его позиции закупки
    for (const it of l.purchaseItems) {
      if (N(it.vatRate) !== rate) {
        f.push({ type: "c", ...base, itemId: it.id, purchase: it.purchase.number, rate: `лот ${rate}% / позиция ${N(it.vatRate)}%`, note: `позиция закупки ${it.purchase.number} (${iso(it.purchase.orderDate)}) со ставкой ${N(it.vatRate)}%, лот — ${rate}%` });
      }
    }
    // (f) пул подкладки: поступления до и после 2026 в одном лоте — одна ставка на всё
    if (l.rawMaterial.unit === "M" && l.purchaseItems.length > 1) {
      const sd = new Set(l.purchaseItems.map((i) => sideOf(i.purchase.orderDate)));
      const rs = new Set(l.purchaseItems.map((i) => N(i.vatRate)));
      if (sd.size > 1 || rs.size > 1) f.push({ type: "f-пул", ...base, note: `пул подкладки из ${l.purchaseItems.length} поступлений (${[...sd].join("/")}, ставки ${[...rs].join("/")}) — у лота одна ставка` });
    }
  }
  // позиции закупки без лота: тоже по дате закупки
  for (const it of data.items) {
    const side = sideOf(it.purchase.orderDate);
    const exp = expectedRate(side);
    if (!it.lotId && N(it.vatRate) !== exp) {
      f.push({ type: side === "before" ? "a" : "b", itemId: it.id, purchase: it.purchase.number, lot: it.lotNumber ?? "без номера", material: it.rawMaterial.name, date: iso(it.purchase.orderDate), rate: `${N(it.vatRate)}%`, expected: `${exp}%`, note: "позиция закупки без лота (черновик/не принята)" });
    }
  }
  // (e)/(f) списания
  const byOrder = new Map<string, { number: string; rates: Map<number, { lines: number; incl: number; excl: number }> }>();
  for (const u of data.usages) {
    const own = u.vatRate != null ? N(u.vatRate) : null;
    const lotRate = N(u.lot.vatRate);
    const eff = own ?? lotRate;
    if (own != null && own !== lotRate) {
      f.push({ type: "e", orderNumber: u.productionOrder.number, purchase: "—", lot: u.lot.lotNumber ?? "без номера", material: u.rawMaterial.name, date: iso(u.date), rate: `строка ${own}% / лот ${lotRate}%`, expected: `${lotRate}%`, note: "явная ставка строки списания отличается от ставки лота" });
    }
    const rec = byOrder.get(u.productionOrderId) ?? { number: u.productionOrder.number, rates: new Map() };
    const g = rec.rates.get(eff) ?? { lines: 0, incl: 0, excl: 0 };
    const incl = N(u.totalCost);
    const exclLine = own != null ? incl / (1 + own / 100) : N(u.quantity) * (N(u.lot.materialCostExclVat) + N(u.lot.expenseCostExclVat));
    g.lines += 1; g.incl += incl; g.excl += exclLine;
    rec.rates.set(eff, g);
    byOrder.set(u.productionOrderId, rec);
  }
  // (e) ТЗ с лотами разных ставок
  const mixedOrders: { number: string; rows: { rate: number; lines: number; incl: number; vat: number }[] }[] = [];
  for (const [, rec] of byOrder) {
    if (rec.rates.size > 1) {
      const rows = [...rec.rates.entries()].sort((a, b) => a[0] - b[0]).map(([rate, g]) => ({ rate, lines: g.lines, incl: g.incl, vat: g.incl - g.excl }));
      mixedOrders.push({ number: rec.number, rows });
    }
  }
  // (e2) списания лотов, у которых ставка лота противоречит дате закупки: эффективная ставка строки неверна
  const lotById = new Map(data.lots.map((l) => [l.id, l]));
  const usageWrong: { orderNumber: string; lot: string; material: string; unit: string; rate: number; expected: number; incl: number; lining: boolean }[] = [];
  for (const u of data.usages) {
    const l = lotById.get(u.lotId);
    if (!l) continue;
    const { primarySide } = lotDates(l, data.upd);
    const exp = expectedRate(primarySide);
    const eff = u.vatRate != null ? N(u.vatRate) : N(u.lot.vatRate);
    if (eff !== exp) usageWrong.push({ orderNumber: u.productionOrder.number, lot: u.lot.lotNumber ?? "без номера", material: u.rawMaterial.name, unit: u.rawMaterial.unit, rate: eff, expected: exp, incl: N(u.totalCost), lining: u.rawMaterial.unit === "M" });
  }
  return { findings: f, lotFixable, ambiguous, mixedOrders, usageWrong, byOrder };
}

export { vatRateForDate };
