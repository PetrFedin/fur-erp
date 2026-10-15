/**
 * Данные ТЗ из нашей базы (позиции ProductionOrder с одним номером ТЗ) → TzPayload для Word Веллмеха (tz-docx-vendor.ts).
 * Чистая логика без БД: загрузчик — tz-from-orders-server.ts. Ничего не выдумывается: чего нет в базе, остаётся пустым,
 * как в шаблоне (дата и срок работ без значения, название изделия — из справочника артикулов), а список пустых полей
 * возвращается отдельно (missing) — по нему видно, какие ТЗ получились неполными.
 *
 * Правила (по присланным ТЗ 2026 года):
 *  • Изделия: по строке на размер, если размеров столько же, сколько изделий («42 44 44 46» ×4 — четыре строки по 1 шт.); иначе одна строка.
 *    Составной цвет ТЗ (ProductionOrderColor) — по цвету; размеры и количество берутся из него.
 *  • «Стоимость продукции за ед.» = работа за ед. + списанное сырьё и подкладка позиции (с НДС, с надбавкой 4% там, где она применяется) / количество.
 *    Копейки делятся между строками так, чтобы сумма строк была равна сумме позиции.
 *  • «ЗАКАЗЧИК ПЕРЕДАЛ»: списания сырья по лотам (одинаковый лот разных позиций — одной строкой), цена без НДС за единицу с надбавкой 4%.
 *  • Ремонт: «Стоимость работ» — вся работа, «Стоимость материала» — всё сырьё позиции.
 */
import { Decimal } from "@prisma/client/runtime/library";
import { lineWith4, usageInput } from "@/lib/commission4";
import { effectiveUsageVat } from "@/lib/commission4";
import { orderUnits } from "@/lib/production-totals";
import { defaultTerms, emptyTz, spacedNum, type TzItem, type TzMaterial, type TzPayload } from "@/lib/tz-vendor";

type Dec = Decimal.Value;
export type OrderForTz = {
  id: string;
  number: string;
  status: string;
  plannedQuantity: Dec;
  producedQuantity: Dec;
  color: string | null;
  colorRef: { name: string } | null;
  colors: { quantity: number | null; sizes: string | null; colorRef: { name: string } }[];
  size: string | null;
  materialDescription: string | null;
  lining: string | null;
  contractNumber: string | null;
  workOrderNumber: string | null;
  workOrderDate: Date | null;
  clientWorkPricePerUnit: Dec | null;
  client: { name: string } | null;
  productModel: { name: string; category: string | null; salesName: string | null };
  isRepair: boolean;
  materialUsages: {
    quantity: Dec; totalCost: Dec; commission4: boolean; vatRate: Dec | null;
    rawMaterial: { name: string; unit: string };
    lot: { id: string; lotNumber: string | null; color: string | null; vatRate: Dec | null; unitCost: Dec | null; materialCostExclVat: Dec; expenseCostExclVat: Dec };
  }[];
};

const D = (v: Dec) => new Decimal(v);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const money = (d: Decimal) => r2(d).toFixed(2).replace(".", ",");
const UNIT: Record<string, string> = { PIECE: "Шт.", KG: "Кг", M2: "М²", M: "М.п.", SET: "Компл." };
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** «Договор подряда № 1605 от 16.05.2025 г.» / «№ 1605 от 16.05.2025» → «№ 1605 от 16 мая 2025 г.» (как в ТЗ Веллмеха). */
export function contractLine(raw: string | null | undefined): string {
  let c = clean(raw).replace(/^договор(\s+подряда)?\s*/i, "").replace(/\s*г\.?\s*$/i, "").trim();
  if (!c) return "";
  c = c.replace(/(\d{1,2})\.(\d{2})\.(\d{4})/, (_m, d, m, y) => `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`);
  if (!/^№/.test(c)) c = `№ ${c}`;
  return `${c} г.`;
}

function sizesOf(raw: string | null | undefined): string[] {
  return clean(raw).split(/[\s,;]+/).filter(Boolean);
}

/** Составные части позиции: цвет, размеры, количество. */
function parts(o: OrderForTz, qty: number): { color: string; size: string; qty: number }[] {
  const base = o.colors.length
    ? o.colors.map((c) => ({ color: c.colorRef.name, sizes: c.sizes, qty: c.quantity }))
    : [{ color: o.colorRef?.name ?? clean(o.color), sizes: o.size, qty: null as number | null }];
  const known = base.reduce((s, b) => s + (b.qty ?? 0), 0);
  const out: { color: string; size: string; qty: number }[] = [];
  base.forEach((b, i) => {
    const q = b.qty ?? (base.length === 1 ? qty : Math.max(qty - known, 0) / Math.max(base.filter((x) => x.qty == null).length, 1));
    const sz = sizesOf(b.sizes);
    if (sz.length > 1 && sz.length === q) sz.forEach((s) => out.push({ color: b.color, size: s, qty: 1 }));
    else out.push({ color: b.color, size: clean(b.sizes), qty: q });
    void i;
  });
  return out;
}

export type TzFromOrders = { payload: TzPayload; complete: boolean; missing: string[]; positions: number };

export function payloadFromOrders(all: OrderForTz[]): TzFromOrders {
  const live = all.filter((o) => o.status !== "CANCELLED");
  const orders = live.length ? live : all;
  const first = orders[0];
  const repair = orders.every((o) => o.isRepair);
  const number = clean(first.workOrderNumber) || first.number;
  const date = first.workOrderDate ? first.workOrderDate.toISOString().slice(0, 10) : "";
  const p = emptyTz(repair ? "REPAIR" : "WORK", number, date);
  p.contract = contractLine(first.contractNumber) || p.contract;
  p.customer = clean(first.client?.name) || p.customer;
  p.terms = { ...defaultTerms(p.kind), deadline: "" };
  p.showMatQty = false;
  p.blankDates = true;
  p.items = [];
  const missing: string[] = [];
  if (!date) missing.push("дата ТЗ");
  missing.push("срок завершения работ");

  const matRows = new Map<string, { m: TzMaterial; qty: Decimal; incl: Decimal; excl: Decimal }>();
  for (const o of orders) {
    const units = Number(orderUnits(o)) || Number(D(o.plannedQuantity));
    const work = o.clientWorkPricePerUnit != null ? D(o.clientWorkPricePerUnit) : null;
    let posIncl = new Decimal(0);
    for (const u of o.materialUsages) {
      const l = lineWith4(usageInput({ ...u, lot: u.lot as never }), "on");
      posIncl = posIncl.add(l.incl);
      const key = `${u.rawMaterial.name}|${u.lot.id}|${u.rawMaterial.unit}`;
      const vat = effectiveUsageVat(u);
      const cur = matRows.get(key) ?? {
        m: { name: clean(`${u.rawMaterial.name} ${u.lot.color ?? ""}`), lot: clean(u.lot.lotNumber), unit: UNIT[u.rawMaterial.unit] ?? "", qty: "", priceNet: "", vatPct: String(vat) },
        qty: new Decimal(0), incl: new Decimal(0), excl: new Decimal(0),
      };
      cur.qty = cur.qty.add(D(u.quantity)); cur.incl = cur.incl.add(l.incl); cur.excl = cur.excl.add(l.excl);
      matRows.set(key, cur);
    }
    const rows = parts(o, units);
    const name = clean(o.productModel.salesName) || clean(o.productModel.category) || clean(o.productModel.name);
    if (!name) missing.push(`ТЗ ${number}: у артикула ${o.productModel.name} нет названия изделия`);
    if (work == null) missing.push(`${o.number}: нет цены работы`);
    if (!(units > 0)) missing.push(`${o.number}: нет количества`);
    if (!clean(o.materialDescription) && !repair) missing.push(`${o.number}: нет описания материала продукции`);

    if (repair) {
      // ремонт: одна строка на позицию; «работа» и «материал» — суммы по позиции
      const w = work ? work.mul(units) : new Decimal(0);
      const item: TzItem = { name: clean(o.productModel.name), color: "", model: "", material: clean(o.materialDescription), size: "", lining: "", qty: String(units), pelts: "", work: w.toFixed(2).replace(/\.00$/, ""), price: money(posIncl), total: money(w.add(r2(posIncl))) };
      p.items.push(item);
      continue;
    }
    // деньги позиции делятся по строкам пропорционально количеству; последняя строка забирает остаток копеек
    const totalQty = rows.reduce((s, r) => s + r.qty, 0) || 1;
    const matShare = r2(posIncl);
    let allocated = new Decimal(0);
    rows.forEach((r, k) => {
      const mats = k === rows.length - 1 ? matShare.sub(allocated) : r2(matShare.mul(r.qty).div(totalQty));
      allocated = allocated.add(mats);
      const workRow = work ? work.mul(r.qty) : new Decimal(0);
      const rowTotal = mats.add(workRow);
      p.items.push({
        name, color: r.color, model: clean(o.productModel.name), material: clean(o.materialDescription), size: r.size, lining: clean(o.lining),
        qty: String(r.qty), pelts: "", work: work ? work.toFixed(2).replace(/\.00$/, "") : "", price: r.qty > 0 ? money(rowTotal.div(r.qty)) : "", total: money(rowTotal),
      });
    });
  }
  // «ЗАКАЗЧИК ПЕРЕДАЛ»
  p.materials = [...matRows.values()].map(({ m, qty, incl, excl }) => ({
    ...m, qty: qty.toFixed(3).replace(/\.?0+$/, "").replace(".", ","), priceNet: qty.isZero() ? "" : spacedNum(Number(r2(excl.div(qty)).toString())), total: spacedNum(Number(r2(incl).toString())),
  }));
  if (p.materials.length === 0) missing.push("материалы, переданные Заказчиком (списаний сырья нет)");
  if (!p.items.length) missing.push("изделия");
  const complete = p.items.length > 0 && p.items.every((i) => i.name && Number(i.qty) > 0 && Number(String(i.work).replace(",", ".")) > 0) && p.materials.length > 0;
  return { payload: p, complete, missing, positions: orders.length };
}
