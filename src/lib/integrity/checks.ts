// ДВИЖОК САМОПРОВЕРКИ: набор инвариантов («что должно сходиться»). Каждая проверка только читает БД и возвращает расхождения
// со ссылкой «где исправлять». Данные не меняются. Известные объяснимые расхождения помечаются отдельно (known.ts).
//
// Допуски: ROUND_TOL_RUB = 50 ₽ — как в src/lib/verification.ts (округление лотов против УПД); остальные — копейки округления колонок БД.
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../purchase-totals";
import { auctionName } from "../auction-names";
import { auctionKey } from "../auction-key";
import recon from "../../data/reconciliation.json";
import { r2, type IntegrityData, type IPurchase, type IOrder } from "./data";
import type { Severity, Violation, EntityRef } from "./types";
import { formatNum } from "@/lib/utils";

/** Допуск на округление лотов против УПД (= ROUND_TOL_RUB из verification.ts). */
export const ROUND_TOL_RUB = 50;

export type Ctx = { d: IntegrityData; helpers: Helpers; prev: Map<string, Violation[]>; supplierDebt?: () => Promise<DebtProbe | null> };
export type DebtProbe = { debt: number; total: number; receivedNet: number; invoiced: number; expected: number; unlinkedAdvances: number };
export type CheckDef = {
  id: string;
  title: string;
  group: string;
  severity: Severity;
  tolerance: string;
  what: string;
  fix: string;
  run: (c: Ctx) => { checked: number; violations: Violation[] } | Promise<{ checked: number; violations: Violation[] }>;
};

// ───────────────────────── справочные функции ─────────────────────────

export type Helpers = ReturnType<typeof makeHelpers>;

export function makeHelpers(d: IntegrityData) {
  const lotById = new Map(d.lots.map((l) => [l.id, l]));
  const orderById = new Map(d.orders.map((o) => [o.id, o]));
  const purchaseById = new Map(d.purchases.map((p) => [p.id, p]));
  const batchById = new Map(d.batches.map((b) => [b.id, b]));
  const modelById = new Map(d.models.map((m) => [m.id, m]));
  const usagesByLot = new Map<string, typeof d.usages>();
  const usagesByOrder = new Map<string, typeof d.usages>();
  for (const u of d.usages) {
    (usagesByLot.get(u.lotId) ?? usagesByLot.set(u.lotId, []).get(u.lotId)!).push(u);
    (usagesByOrder.get(u.orderId) ?? usagesByOrder.set(u.orderId, []).get(u.orderId)!).push(u);
  }
  const lotsByPurchase = new Map<string, typeof d.lots>();
  for (const l of d.lots) if (l.purchaseId) (lotsByPurchase.get(l.purchaseId) ?? lotsByPurchase.set(l.purchaseId, []).get(l.purchaseId)!).push(l);

  const purchaseTotal = (p: IPurchase): number =>
    Number(
      purchaseTotalInclVat({
        exchangeRate: new Decimal(p.exchangeRate) as never,
        items: p.items.map((i) => ({ subtotal: new Decimal(i.subtotal) as never, vatRate: new Decimal(i.vatRate) as never, quantity: new Decimal(i.quantity) as never, costPlan: i.costPlan })),
        expenses: p.expenses.map((e) => ({ amount: new Decimal(e.amount) as never, vatRate: new Decimal(e.vatRate) as never })),
      }).toString(),
    );

  const ref = {
    purchase: (p: IPurchase): EntityRef => ({ kind: "purchase", id: p.id, label: `Закупка ${p.number}` }),
    order: (o: IOrder): EntityRef => ({ kind: "order", id: o.id, label: `ТЗ ${o.workOrderNumber?.trim() || o.number}` }),
    lot: (l: IntegrityData["lots"][number]): EntityRef => ({ kind: "lot", id: l.id, label: `Лот ${l.lotNumber ?? "без номера"} (${l.materialName})` }),
    batch: (b: IntegrityData["batches"][number]): EntityRef => ({ kind: "batch", id: b.id, label: `Партия ${b.number}` }),
  };
  const href = {
    purchase: (id: string) => `/purchases/${id}`,
    lot: (id: string) => `/analytics/raw/lot/${id}`,
    order: (id: string) => `/production/${id}`,
    batch: (n: number) => `/production/batches/${n}`,
    model: (id: string) => `/models/${id}`,
  };

  /** Количество изделий ТЗ для расчёта работы: выпуск у завершённого, план у ТЗ в работе (production-totals.ts). */
  const orderUnits = (o: IOrder) => (o.status === "COMPLETED" ? o.producedQuantity : o.status === "IN_PROGRESS" || o.status === "PLANNED" ? o.plannedQuantity : 0);

  /** Закупки аукциона по нормализованному имени. */
  const purchasesByAuction = new Map<string, IPurchase[]>();
  for (const p of d.purchases) {
    const n = auctionName(p.auctionSession);
    if (n) (purchasesByAuction.get(n) ?? purchasesByAuction.set(n, []).get(n)!).push(p);
  }
  return { lotById, orderById, purchaseById, batchById, modelById, usagesByLot, usagesByOrder, lotsByPurchase, purchaseTotal, ref, href, orderUnits, purchasesByAuction };
}

const fmt = (v: number) => formatNum(v, 1).replace(/[  ]/g, " ");
const money = (v: number) => `${fmt(v)} ₽`;
const sgn = (v: number) => (v > 0 ? "+" : "") + fmt(v);

// ───────────────────────── проверки ─────────────────────────

const CHECKS: CheckDef[] = [
  // ===== Склад сырья =====
  {
    id: "lot-remaining",
    title: "Остаток лота = приход − списания в ТЗ",
    group: "Остатки сырья",
    severity: "error",
    tolerance: "0,001 ед.",
    what: "У каждого лота остаток равен принятому количеству минус всё, что списано в ТЗ; отрицательных остатков нет.",
    fix: "Карточка лота (Аналитика сырья → лот): списания в ТЗ; либо правка списания в самом ТЗ.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      for (const l of d.lots) {
        const used = (h.usagesByLot.get(l.id) ?? []).reduce((s, u) => s + u.quantity, 0);
        const expected = l.quantityReceived - used;
        const delta = r2(l.quantityRemaining - expected);
        if (Math.abs(delta) > 0.001 || l.quantityRemaining < -0.001) {
          v.push({
            key: l.id,
            message: `${h.ref.lot(l).label}: остаток ${fmt(l.quantityRemaining)}, а по приходу и списаниям должен быть ${fmt(expected)}`,
            delta,
            unit: "ед.",
            entity: h.ref.lot(l),
            href: h.href.lot(l.id),
          });
        }
      }
      return { checked: d.lots.length, violations: v };
    },
  },
  {
    id: "lot-total-cost",
    title: "Стоимость лота = цена единицы × принятое количество",
    group: "Остатки сырья",
    severity: "warn",
    tolerance: "до 0,005 ₽ на единицу (округление цены до копеек)",
    what: "RawMaterialLot.totalCost совпадает с unitCost × quantityReceived (кроме округления unitCost до копеек).",
    fix: "Закупка лота: «Править расчёт лота» / позиция закупки; для пула подкладки — скрипт пересчёта пула.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      for (const l of d.lots) {
        const expected = l.unitCost * l.quantityReceived;
        const delta = r2(l.totalCost - expected);
        if (Math.abs(delta) > 0.005 * l.quantityReceived + 0.01) {
          v.push({
            key: l.id,
            message: `${h.ref.lot(l).label}: стоимость лота ${money(l.totalCost)}, а цена × количество = ${money(r2(expected))}`,
            delta,
            unit: "₽",
            entity: h.ref.lot(l),
            href: h.href.lot(l.id),
            tags: [l.unit === "M" ? "lining-pool" : "fur-lot"],
          });
        }
      }
      return { checked: d.lots.length, violations: v };
    },
  },
  {
    id: "usage-lot-cost",
    title: "Списание в ТЗ идёт по текущей цене лота",
    group: "Остатки сырья",
    severity: "error",
    tolerance: "0,01 ₽ на единицу",
    what: "Цена единицы в строке списания равна цене единицы лота, а сумма строки — количеству × цене. Если лот пересчитан после списания, ТЗ остаётся со старой себестоимостью. Пул подкладки (средняя цена) не проверяется: его цена меняется с новыми поступлениями.",
    fix: "Строка списания в ТЗ (удалить и добавить заново либо «Править») — тогда пересчитается себестоимость ТЗ и склад готовой продукции.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      for (const u of d.usages) {
        const l = h.lotById.get(u.lotId);
        const o = h.orderById.get(u.orderId);
        if (!l || !o) continue;
        // Пул подкладки (метры, без номера лота) ведётся по средней цене: при новом поступлении цена пула меняется,
        // а прежние списания остаются по цене на момент списания — это нормально, их не сравниваем с текущей ценой.
        const pooled = l.unit === "M";
        const dUnit = pooled ? 0 : r2(u.unitCost - l.unitCost);
        const dSum = r2(u.totalCost - u.quantity * u.unitCost);
        if (Math.abs(dUnit) > 0.01) {
          v.push({
            key: `${u.id}:unit`,
            message: `${h.ref.order(o).label}: списано из лота ${l.lotNumber ?? "без номера"} по ${money(u.unitCost)}, а цена лота сейчас ${money(l.unitCost)}`,
            delta: r2(dUnit * u.quantity),
            unit: "₽",
            entity: h.ref.order(o),
            href: h.href.order(o.id),
            also: [h.ref.lot(l)],
          });
        } else if (Math.abs(dSum) > 0.005 * u.quantity + 0.01) {
          v.push({
            key: `${u.id}:sum`,
            message: `${h.ref.order(o).label}: сумма списания ${money(u.totalCost)} ≠ количество × цена (${money(r2(u.quantity * u.unitCost))})`,
            delta: dSum,
            unit: "₽",
            entity: h.ref.order(o),
            href: h.href.order(o.id),
            also: [h.ref.lot(l)],
          });
        }
      }
      return { checked: d.usages.length, violations: v };
    },
  },

  // ===== Закупки =====
  {
    id: "item-subtotal",
    title: "Позиция закупки: сумма = количество × цена",
    group: "Закупки",
    severity: "warn",
    tolerance: "до 5 ₽ на позицию (цена хранится с копейками × количество)",
    what: "PurchaseItem.subtotal совпадает с quantity × unitPrice.",
    fix: "Карточка закупки: позиция (количество и цена).",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.purchases) {
        for (const i of p.items) {
          n++;
          const delta = r2(i.subtotal - i.quantity * i.unitPrice);
          if (Math.abs(delta) > 5) {
            v.push({ key: i.id, message: `${h.ref.purchase(p).label}: сумма позиции ${money(i.subtotal)}, а количество × цена = ${money(r2(i.quantity * i.unitPrice))}`, delta, unit: "₽", entity: h.ref.purchase(p), href: h.href.purchase(p.id), tags: [p.number] });
          }
        }
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "item-without-lot",
    title: "Каждая позиция принятой закупки лежит в лоте",
    group: "Закупки",
    severity: "error",
    tolerance: "нет",
    what: "У позиции закупки со статусом «Принята» есть лот на складе.",
    fix: "Карточка закупки: позиция без лота — привязать к лоту/пересчитать приёмку (скрипт, не вручную).",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.purchases) {
        if (p.status !== "RECEIVED") continue;
        for (const i of p.items) {
          n++;
          if (!i.lotId) v.push({ key: i.id, message: `${h.ref.purchase(p).label}: позиция на ${fmt(i.quantity)} ед. принята, но лота на складе нет`, delta: r2(i.subtotal), unit: "₽", entity: h.ref.purchase(p), href: h.href.purchase(p.id), tags: [p.number] });
        }
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "item-lot-qty",
    title: "Количество позиции = количество лота",
    group: "Закупки",
    severity: "error",
    tolerance: "0,001 ед.",
    what: "Если лот питает одна позиция, принятое в лоте количество равно количеству позиции закупки.",
    fix: "Карточка закупки: позиция (количество) — пересчитывает лот, пока он не списан.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const l of d.lots) {
        if (l.items.length !== 1) continue;
        n++;
        const i = l.items[0];
        const delta = r2(l.quantityReceived - i.quantity);
        if (Math.abs(delta) > 0.001) {
          const p = l.purchaseId ? h.purchaseById.get(l.purchaseId) : undefined;
          v.push({ key: l.id, message: `${h.ref.lot(l).label}: принято ${fmt(l.quantityReceived)}, а в позиции закупки ${fmt(i.quantity)}`, delta, unit: "ед.", entity: p ? h.ref.purchase(p) : h.ref.lot(l), href: p ? h.href.purchase(p.id) : h.href.lot(l.id), also: [h.ref.lot(l)] });
        }
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "purchase-lots-sum",
    title: "Σ лотов закупки = стоимость закупки",
    group: "Закупки",
    severity: "error",
    tolerance: `${ROUND_TOL_RUB} ₽ на закупку`,
    what: "Для принятых закупок сумма стоимостей их лотов равна итогу закупки с НДС и расходами (позиции + расходы).",
    fix: "Карточка закупки: позиции, расходы, курс. После правки лоты пересчитываются (если не списаны); списанные — сначала правка в ТЗ.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.purchases) {
        if (p.status !== "RECEIVED") continue;
        n++;
        const lots = h.lotsByPurchase.get(p.id) ?? [];
        const sum = lots.reduce((s, l) => s + l.totalCost, 0);
        const total = h.purchaseTotal(p);
        const delta = r2(sum - total);
        if (Math.abs(delta) > ROUND_TOL_RUB) {
          v.push({ key: p.id, message: `${h.ref.purchase(p).label}: лоты на ${money(r2(sum))}, итог закупки ${money(r2(total))}`, delta, unit: "₽", entity: h.ref.purchase(p), href: h.href.purchase(p.id), tags: [p.number] });
        }
      }
      return { checked: n, violations: v };
    },
  },

  // ===== ТЗ и себестоимость =====
  {
    id: "order-cost-snapshot",
    title: "Себестоимость завершённого ТЗ = Σ списаний + расходы",
    group: "ТЗ и партии",
    severity: "error",
    tolerance: "1 ₽ на ТЗ",
    what: "totalCost завершённого ТЗ равен сумме его списаний сырья и расходов (4% — надбавка при показе, в снимок не входит); materialCost, expenseCost и unitCost согласованы.",
    fix: "Карточка ТЗ: любая правка списаний или расходов пересчитывает снимок; если не помогло — «Количество выпущено».",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const o of d.orders) {
        if (o.status !== "COMPLETED") continue;
        n++;
        const mat = (h.usagesByOrder.get(o.id) ?? []).reduce((s, u) => s + u.totalCost, 0);
        const exp = d.orderExpenses.get(o.id) ?? 0;
        const total = mat + exp;
        const delta = r2((o.totalCost ?? 0) - total);
        const dUnit = o.producedQuantity > 0 && o.unitCost != null ? r2(o.unitCost * o.producedQuantity - (o.totalCost ?? 0)) : 0;
        if (Math.abs(delta) > 1) {
          v.push({ key: `${o.id}:total`, message: `${h.ref.order(o).label}: себестоимость в ТЗ ${money(o.totalCost ?? 0)}, а списания и расходы дают ${money(r2(total))}`, delta, unit: "₽", entity: h.ref.order(o), href: h.href.order(o.id) });
        } else if (Math.abs(dUnit) > 0.005 * Math.max(o.producedQuantity, 1) + 0.01) {
          v.push({ key: `${o.id}:unit`, message: `${h.ref.order(o).label}: цена единицы × выпуск ≠ себестоимость (разница ${money(dUnit)})`, delta: dUnit, unit: "₽", entity: h.ref.order(o), href: h.href.order(o.id) });
        }
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "order-completed-empty",
    title: "Завершённое ТЗ имеет списания и выпуск",
    group: "ТЗ и партии",
    severity: "warn",
    tolerance: "нет",
    what: "У ТЗ в статусе «Завершён» есть хотя бы одно списание сырья и выпуск больше нуля — иначе изделие встаёт на склад с нулевой себестоимостью.",
    fix: "Карточка ТЗ: списания из приложения ТЗ; «Количество выпущено».",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const o of d.orders) {
        if (o.status !== "COMPLETED") continue;
        n++;
        const hasUse = (h.usagesByOrder.get(o.id) ?? []).length > 0;
        if (!hasUse || o.producedQuantity <= 0) {
          v.push({ key: o.id, message: `${h.ref.order(o).label}: ${!hasUse ? "нет списаний сырья" : "выпуск равен нулю"}`, delta: null, unit: "", entity: h.ref.order(o), href: h.href.order(o.id), tags: [o.number] });
        }
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "order-price-model",
    title: "Цена продажи ТЗ = цена артикула",
    group: "ТЗ и партии",
    severity: "info",
    tolerance: "0,01 ₽",
    what: "retailPrice ТЗ совпадает с sellingPrice его изделия (цена правится в одном месте и разносится по ТЗ).",
    fix: "Артикулы → цена продажи (кнопка обновляет и ТЗ) либо карточка ТЗ → цена продажи.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const o of d.orders) {
        const m = h.modelById.get(o.productModelId);
        if (!m || m.sellingPrice == null || o.retailPrice == null) continue;
        n++;
        const delta = r2(o.retailPrice - m.sellingPrice);
        if (Math.abs(delta) > 0.01) v.push({ key: o.id, message: `${h.ref.order(o).label}: цена ТЗ ${money(o.retailPrice)}, цена изделия «${m.name}» ${money(m.sellingPrice)}`, delta, unit: "₽", entity: h.ref.order(o), href: h.href.order(o.id), also: [{ kind: "model", id: m.id, label: `Изделие ${m.name}` }], tags: [o.number] });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "fg-stock-vs-moves",
    title: "Остаток готовой продукции = Σ движений",
    group: "ТЗ и партии",
    severity: "error",
    tolerance: "0,001 шт.",
    what: "Остаток каждого изделия на складе равен приходу минус расход по журналу движений.",
    fix: "Остаток готовой продукции: движения изделия; приход идёт из завершения ТЗ.",
    run: ({ d, helpers: h }) => {
      const sign = (t: string) => (t.endsWith("_IN") ? 1 : -1);
      const sum = new Map<string, number>();
      for (const m of d.fgMoves) sum.set(`${m.warehouseId}:${m.productModelId}`, (sum.get(`${m.warehouseId}:${m.productModelId}`) ?? 0) + sign(m.type) * m.quantity);
      const v: Violation[] = [];
      const seen = new Set<string>();
      for (const s of d.fgStock) {
        const k = `${s.warehouseId}:${s.productModelId}`;
        seen.add(k);
        const delta = r2(s.quantity - (sum.get(k) ?? 0));
        if (Math.abs(delta) > 0.001) {
          const m = h.modelById.get(s.productModelId);
          v.push({ key: k, message: `Изделие «${m?.name ?? s.productModelId}»: на складе ${fmt(s.quantity)}, по движениям ${fmt(sum.get(k) ?? 0)}`, delta, unit: "шт.", entity: { kind: "model", id: s.productModelId, label: `Изделие ${m?.name ?? ""}` }, href: "/finished-stock" });
        }
      }
      for (const [k, q] of sum) {
        if (!seen.has(k) && Math.abs(q) > 0.001) {
          const m = h.modelById.get(k.split(":")[1]);
          v.push({ key: k, message: `Изделие «${m?.name ?? k}»: движения дают ${fmt(q)} шт., а строки остатка на складе нет`, delta: q, unit: "шт.", entity: { kind: "model", id: k.split(":")[1], label: `Изделие ${m?.name ?? ""}` }, href: "/finished-stock" });
        }
      }
      return { checked: d.fgStock.length, violations: v };
    },
  },
  {
    id: "fg-in-vs-orders",
    title: "Приход готовой продукции = выпуск ТЗ",
    group: "ТЗ и партии",
    severity: "error",
    tolerance: "0,001 шт.",
    what: "Приход на склад по каждому завершённому ТЗ (с корректировками) равен его выпуску.",
    fix: "Карточка ТЗ → «Количество выпущено» (создаёт корректировку склада).",
    run: ({ d, helpers: h }) => {
      const byOrder = new Map<string, number>();
      for (const m of d.fgMoves) {
        if (!m.productionOrderId) continue;
        if (m.type === "PRODUCTION_IN" || m.type === "ADJUSTMENT_IN") byOrder.set(m.productionOrderId, (byOrder.get(m.productionOrderId) ?? 0) + m.quantity);
        else if (m.type === "ADJUSTMENT_OUT") byOrder.set(m.productionOrderId, (byOrder.get(m.productionOrderId) ?? 0) - m.quantity);
      }
      const v: Violation[] = [];
      let n = 0;
      for (const o of d.orders) {
        if (o.status !== "COMPLETED") continue;
        n++;
        const got = byOrder.get(o.id) ?? 0;
        const delta = r2(got - o.producedQuantity);
        if (Math.abs(delta) > 0.001) v.push({ key: o.id, message: `${h.ref.order(o).label}: выпуск ${fmt(o.producedQuantity)} шт., на склад оприходовано ${fmt(got)}`, delta, unit: "шт.", entity: h.ref.order(o), href: h.href.order(o.id), tags: [o.number] });
      }
      return { checked: n, violations: v };
    },
  },

  // ===== Оплаты =====
  {
    id: "payment-bucket",
    title: "Оплата поставщику учтена один раз",
    group: "Оплаты и долг",
    severity: "error",
    tolerance: "нет",
    what: "Оплата привязана либо к закупке, либо к аукциону целиком, либо это аванс без привязки — но не к двум сразу (иначе попадёт в долг дважды), и аукцион оплаты существует среди закупок.",
    fix: "Оплаты → строка оплаты: оставить одну привязку; аукцион — как в закупках.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.payments) {
        if (p.status === "CANCELLED") continue;
        n++;
        const a = auctionName(p.auctionSession);
        if (p.purchaseId && a) {
          v.push({ key: `${p.id}:both`, message: `Оплата ${money(p.amount)} от ${p.paidAt.toISOString().slice(0, 10)} привязана и к закупке, и к аукциону «${a}»`, delta: p.amount, unit: "₽", entity: { kind: "payment", id: p.id, label: `Оплата ${money(p.amount)}` }, href: `/purchases/${p.purchaseId}` });
        } else if (!p.purchaseId && a && !h.purchasesByAuction.has(a)) {
          v.push({ key: `${p.id}:void`, message: `Оплата ${money(p.amount)} относится к аукциону «${a}», по которому нет ни одной закупки`, delta: p.amount, unit: "₽", entity: { kind: "payment", id: p.id, label: `Оплата ${money(p.amount)}` }, href: "/payments", tags: [`auction:${a}`] });
        }
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "auction-overpaid",
    title: "Оплачено по аукциону/закупке не больше её стоимости",
    group: "Оплаты и долг",
    severity: "warn",
    tolerance: "1 ₽",
    what: "Σ оплат (проведённых) по аукциону — его оплаты целиком плюс оплаты его закупок — не превышает Σ стоимости его закупок; то же для закупок вне аукционов.",
    fix: "Оплаты / закупка: проверьте сумму и привязку оплаты; зачёт переплаты в счёте другого аукциона — оформить решением владельца.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      const lump = new Map<string, number>();
      for (const p of d.payments) {
        if (p.status !== "COMPLETED" || p.purchaseId) continue;
        const a = auctionName(p.auctionSession);
        if (a) lump.set(a, (lump.get(a) ?? 0) + p.amount);
      }
      for (const [name, ps] of h.purchasesByAuction) {
        n++;
        const live = ps.filter((p) => p.status !== "CANCELLED");
        const total = live.reduce((s, p) => s + h.purchaseTotal(p), 0);
        const paid = ps.reduce((s, p) => s + p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a + x.amount, 0), 0) + (lump.get(name) ?? 0);
        const delta = r2(paid - total);
        if (delta > 1 && live.length) v.push({ key: `auction:${name}`, message: `Аукцион «${name}»: оплачено ${money(r2(paid))}, стоимость закупок ${money(r2(total))}`, delta, unit: "₽", entity: { kind: "auction", id: name, label: `Аукцион ${name}` }, href: h.href.purchase(live[0].id), tags: [`auction:${name}`], also: live.map(h.ref.purchase) });
      }
      for (const p of d.purchases) {
        if (auctionName(p.auctionSession) || p.status === "CANCELLED") continue;
        n++;
        const paid = p.payments.filter((x) => x.status === "COMPLETED").reduce((s, x) => s + x.amount, 0);
        const delta = r2(paid - h.purchaseTotal(p));
        if (delta > 1) v.push({ key: p.id, message: `${h.ref.purchase(p).label}: оплачено ${money(r2(paid))}, стоимость ${money(r2(h.purchaseTotal(p)))}`, delta, unit: "₽", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "supplier-debt",
    title: "Долг поставщику = Σ закупок − оплаты",
    group: "Оплаты и долг",
    severity: "error",
    tolerance: "1 ₽",
    what: "Единый расчёт долга (lib/supplier-debt.ts) совпадает с независимым пересчётом: Σ стоимости закупок − Σ проведённых оплат + переплаты по аукционам и закупкам (они долг не гасят), в сумме не ниже нуля; три части долга складываются в итог.",
    fix: "Оплаты / закупки — расхождение указывает на оплату или закупку, которую единый расчёт не учитывает (например, оплата по отменённой закупке вне аукциона).",
    run: async ({ d, helpers: h, supplierDebt }) => {
      const debt = supplierDebt ? await supplierDebt() : null;
      if (!debt) return { checked: 0, violations: [] };
      const live = d.purchases.filter((p) => p.status !== "CANCELLED");
      const total = live.reduce((s, p) => s + h.purchaseTotal(p), 0);
      // оплаты, которые единый расчёт засчитывает: оплаты закупок (в т.ч. отменённых — только внутри аукциона), оплаты аукционов, авансы
      let paid = 0;
      let overpay = 0;
      const lump = new Map<string, number>();
      let advances = 0;
      for (const p of d.payments) {
        if (p.status !== "COMPLETED" || p.purchaseId) continue;
        const a = auctionName(p.auctionSession);
        if (a) lump.set(a, (lump.get(a) ?? 0) + p.amount);
        else advances += p.amount;
      }
      for (const [name, ps] of h.purchasesByAuction) {
        const t = ps.filter((p) => p.status !== "CANCELLED").reduce((s, p) => s + h.purchaseTotal(p), 0);
        const pd = ps.reduce((s, p) => s + p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a + x.amount, 0), 0) + (lump.get(name) ?? 0);
        paid += pd;
        // Переплата аукциона зачитывается в общий долг (см. computeSupplierDebt) — в пересчёт не добавляется.
      }
      for (const p of live) {
        if (auctionName(p.auctionSession)) continue;
        const pd = p.payments.filter((x) => x.status === "COMPLETED").reduce((s, x) => s + x.amount, 0);
        paid += pd;
        overpay += Math.max(pd - h.purchaseTotal(p), 0);
      }
      const expected = Math.max(total - paid - advances + overpay, 0);
      const v: Violation[] = [];
      const delta = r2(debt.debt - expected);
      if (Math.abs(delta) > 1) v.push({ key: "debt", message: `Долг в Сводке ${money(r2(debt.debt))}, пересчёт Σ закупок − оплаты даёт ${money(r2(expected))}`, delta, unit: "₽", entity: { kind: "system", id: "debt", label: "Долг поставщикам" }, href: "/payments" });
      const parts = r2(debt.receivedNet + debt.invoiced + debt.expected - debt.debt);
      if (Math.abs(parts) > 0.01) v.push({ key: "debt-parts", message: `Части долга (к оплате по УПД, счёт выставлен, ожидаемое) не складываются в итог (разница ${money(parts)})`, delta: parts, unit: "₽", entity: { kind: "system", id: "debt", label: "Долг поставщикам" }, href: "/payments" });
      return { checked: 1, violations: v };
    },
  },
  {
    id: "payment-confirmed-doc",
    title: "Подтверждённая оплата опирается на документ",
    group: "Оплаты и долг",
    severity: "warn",
    tolerance: "нет",
    what: "У оплаты (поставщику и подрядчику), отмеченной «подтверждена», есть платёжный документ (файл, привязка к Drive) либо номер платёжки/счёта.",
    fix: "Контроль → Подтвердить: приложить платёжку или снять подтверждение.",
    run: ({ d }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.payments) {
        if (p.status !== "COMPLETED" || !p.confirmed || !p.confirmedAt) continue;
        n++;
        if (!p.documentId && p.driveDocs === 0 && !p.docRef) v.push({ key: p.id, message: `Оплата ${money(p.amount)} от ${p.paidAt.toISOString().slice(0, 10)} подтверждена, но без документа и номера платёжки`, delta: p.amount, unit: "₽", entity: { kind: "payment", id: p.id, label: `Оплата ${money(p.amount)}` }, href: p.purchaseId ? `/purchases/${p.purchaseId}` : "/verify" });
      }
      for (const p of d.prodPayments) {
        if (p.status !== "COMPLETED" || !p.confirmed || !p.confirmedAt) continue;
        n++;
        if (p.driveDocs === 0 && !p.docRef) v.push({ key: p.id, message: `Оплата подрядчику ${money(p.amount)} от ${p.paidAt.toISOString().slice(0, 10)} подтверждена, но без документа и номера`, delta: p.amount, unit: "₽", entity: { kind: "prodPayment", id: p.id, label: `Оплата подрядчику ${money(p.amount)}` }, href: "/verify" });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "prod-payment-alloc",
    title: "Оплата подрядчику разнесена на ТЗ",
    group: "Оплаты и долг",
    severity: "info",
    tolerance: "нет",
    what: "Каждая проведённая оплата подрядчику привязана хотя бы к одному ТЗ (кроме авансов, которые ждут разнесения).",
    fix: "Производство → ТЗ → оплаты: отметить ТЗ, которые покрывает оплата.",
    run: ({ d }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.prodPayments) {
        if (p.status !== "COMPLETED") continue;
        n++;
        if (p.orders === 0) v.push({ key: p.id, message: `${p.paymentType === "ADVANCE" ? "Аванс" : "Оплата"} подрядчику ${money(p.amount)} от ${p.paidAt.toISOString().slice(0, 10)} не разнесён ни на одно ТЗ`, delta: p.amount, unit: "₽", entity: { kind: "prodPayment", id: p.id, label: `Оплата подрядчику ${money(p.amount)}` }, href: "/payments?tab=clients", tags: [p.paymentType] });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "batch-overpaid",
    title: "Оплата партии не больше работы партии",
    group: "ТЗ и партии",
    severity: "warn",
    tolerance: `${ROUND_TOL_RUB} ₽`,
    what: "Σ сумм, разнесённых на ТЗ партии, не превышает работу подрядчика по партии (цена работы × количество действующих ТЗ).",
    fix: "Производство → партия → оплаты; «шкуры подрядчика» фиксируются явной пометкой в оплате.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      const byBatch = new Map<string, IOrder[]>();
      for (const o of d.orders) if (o.batchId && o.status !== "CANCELLED") (byBatch.get(o.batchId) ?? byBatch.set(o.batchId, []).get(o.batchId)!).push(o);
      for (const b of d.batches) {
        const os = byBatch.get(b.id) ?? [];
        if (!os.length) continue;
        const work = os.reduce((s, o) => s + (o.clientWorkPricePerUnit ?? 0) * h.orderUnits(o), 0);
        // Оплачено по партии = суммы, РАЗНЕСЁННЫЕ на ТЗ партии (а не вся сумма платежа).
        let paid = 0;
        for (const o of os) for (const a of o.allocations) if (a.status !== "CANCELLED") paid += a.allocated;
        const delta = r2(paid - work);
        if (delta > ROUND_TOL_RUB) v.push({ key: `batch:${b.number}`, message: `Партия ${b.number}: оплачено ${money(r2(paid))}, работа ${money(r2(work))}`, delta, unit: "₽", entity: h.ref.batch(b), href: h.href.batch(b.number), tags: [`batch:${b.number}`] });
      }
      return { checked: d.batches.length, violations: v };
    },
  },

  // ===== Справочники и кэш-тексты =====
  {
    id: "cache-auction",
    title: "Аукцион в закупке = запись справочника",
    group: "Справочники",
    severity: "warn",
    tolerance: "нет",
    what: "Purchase.auctionSession (кэш-текст) совпадает с именем аукциона из справочника (или его прежним написанием), а у закупки с аукционом заполнена ссылка на справочник.",
    fix: "Настройки → Аукционы: переименование обновляет закупки, оплаты и документы одной транзакцией; закупка → выбрать аукцион из справочника.",
    run: ({ d, helpers: h }) => {
      const byId = new Map(d.auctions.map((a) => [a.id, a]));
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.purchases) {
        const text = auctionName(p.auctionSession);
        if (!text) continue;
        n++;
        const a = p.auctionId ? byId.get(p.auctionId) : undefined;
        if (!p.auctionId) {
          v.push({ key: `${p.id}:noref`, message: `${h.ref.purchase(p).label}: аукцион «${text}» записан текстом, без ссылки на справочник`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
        } else if (!a) {
          v.push({ key: `${p.id}:gone`, message: `${h.ref.purchase(p).label}: ссылка на аукцион, которого нет в справочнике`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
        } else if (auctionKey(text) !== auctionKey(a.name) && !a.aliases.some((x) => auctionKey(x) === auctionKey(text))) {
          v.push({ key: `${p.id}:stale`, message: `${h.ref.purchase(p).label}: в закупке «${text}», в справочнике аукцион называется «${a.name}»`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
        }
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "cache-color",
    title: "Цвет в лоте, позиции и ТЗ = справочник цветов",
    group: "Справочники",
    severity: "warn",
    tolerance: "нет",
    what: "Если у лота/ТЗ выбран цвет из справочника, текст цвета совпадает с названием в справочнике.",
    fix: "Настройки → Цвета: переименование обновляет все записи; либо правка цвета в лоте/ТЗ.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const l of d.lots) {
        if (!l.colorRefId) continue;
        n++;
        if ((l.color ?? "") !== (l.colorRefName ?? "") && !l.colorRefAliases.includes(l.color ?? "")) v.push({ key: `lot:${l.id}`, message: `${h.ref.lot(l).label}: цвет «${l.color ?? ""}», в справочнике «${l.colorRefName}»`, delta: null, unit: "", entity: h.ref.lot(l), href: h.href.lot(l.id) });
      }
      for (const o of d.orders) {
        if (!o.colorRefId) continue;
        n++;
        if ((o.color ?? "") !== (o.colorRefName ?? "") && !o.colorRefAliases.includes(o.color ?? "") && !(o.color ?? "").includes("×")) v.push({ key: `order:${o.id}`, message: `${h.ref.order(o).label}: цвет «${o.color ?? ""}», в справочнике «${o.colorRefName}»`, delta: null, unit: "", entity: h.ref.order(o), href: h.href.order(o.id) });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "cache-category",
    title: "Категория изделия = справочник категорий",
    group: "Справочники",
    severity: "warn",
    tolerance: "нет",
    what: "ProductModel.category (кэш-текст) совпадает с названием выбранной категории из справочника.",
    fix: "Настройки → Категории: переименование обновляет изделия; либо карточка изделия.",
    run: ({ d }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const m of d.models) {
        if (!m.categoryRefId) continue;
        n++;
        if ((m.category ?? "") !== (m.categoryRefName ?? "")) v.push({ key: m.id, message: `Изделие «${m.name}»: категория «${m.category ?? ""}», в справочнике «${m.categoryRefName}»`, delta: null, unit: "", entity: { kind: "model", id: m.id, label: `Изделие ${m.name}` }, href: `/models/${m.id}` });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "cache-lot-item",
    title: "Лот совпадает с позицией закупки (номер, сорт, цвет)",
    group: "Справочники",
    severity: "warn",
    tolerance: "нет",
    what: "Номер лота, сорт и цвет в лоте и в его единственной позиции закупки одинаковы (правка из любого места обновляет оба).",
    fix: "Лот → «Править» (обновляет и позицию закупки) либо позиция в закупке.",
    run: ({ d, helpers: h }) => {
      const norm = (s: string | null) => (s ?? "").trim();
      const v: Violation[] = [];
      let n = 0;
      for (const l of d.lots) {
        if (l.items.length !== 1) continue;
        n++;
        const i = l.items[0];
        const diffs: string[] = [];
        if (norm(l.lotNumber) !== norm(i.lotNumber)) diffs.push(`номер «${norm(l.lotNumber)}» / «${norm(i.lotNumber)}»`);
        if (norm(l.grade) !== norm(i.grade)) diffs.push(`сорт «${norm(l.grade)}» / «${norm(i.grade)}»`);
        if (norm(l.color) !== norm(i.color)) diffs.push(`цвет «${norm(l.color)}» / «${norm(i.color)}»`);
        if (diffs.length) {
          const p = l.purchaseId ? h.purchaseById.get(l.purchaseId) : undefined;
          v.push({ key: l.id, message: `${h.ref.lot(l).label}: лот и позиция закупки различаются — ${diffs.join("; ")}`, delta: null, unit: "", entity: p ? h.ref.purchase(p) : h.ref.lot(l), href: h.href.lot(l.id), also: [h.ref.lot(l)] });
        }
      }
      return { checked: n, violations: v };
    },
  },

  // ===== Подтверждение и документы =====
  {
    id: "verified-after-edit",
    title: "Подтверждённое не менялось после подтверждения (по журналу)",
    group: "Подтверждение и документы",
    severity: "error",
    tolerance: "1 минута",
    what: "В журнале изменений нет правок закупки, ТЗ или партии (и их позиций, лотов, списаний, оплат) после даты подтверждения — иначе подтверждение устарело.",
    fix: "Контроль → Подтвердить: снять и поставить подтверждение заново после проверки (правка в server actions должна сбрасывать его автоматически).",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      const touched = new Map<string, Date>();
      for (const a of d.auditAfter) {
        const cur = touched.get(a.recordId);
        if (!cur || a.at > cur) touched.set(a.recordId, a.at);
      }
      const later = (ids: string[], since: Date) => ids.some((id) => (touched.get(id)?.getTime() ?? 0) > since.getTime() + 60_000);
      for (const p of d.purchases) {
        if (!p.verifiedAt) continue;
        n++;
        const ids = [p.id, ...p.items.map((i) => i.id), ...p.payments.map((x) => x.id), ...(h.lotsByPurchase.get(p.id) ?? []).map((l) => l.id)];
        if (later(ids, p.verifiedAt)) v.push({ key: p.id, message: `${h.ref.purchase(p).label} подтверждена ${p.verifiedAt.toISOString().slice(0, 10).split("-").reverse().join(".")}, но после этого менялась`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
      }
      for (const o of d.orders) {
        if (!o.verifiedAt) continue;
        n++;
        const ids = [o.id, ...(h.usagesByOrder.get(o.id) ?? []).map((u) => u.id), ...o.allocations.map((a) => a.paymentId)];
        if (later(ids, o.verifiedAt)) v.push({ key: o.id, message: `${h.ref.order(o).label} подтверждено ${o.verifiedAt.toISOString().slice(0, 10)}, но после этого менялось`, delta: null, unit: "", entity: h.ref.order(o), href: h.href.order(o.id) });
      }
      for (const b of d.batches) {
        if (!b.verifiedAt) continue;
        n++;
        if (later([b.id], b.verifiedAt)) v.push({ key: b.id, message: `${h.ref.batch(b).label} подтверждена ${b.verifiedAt.toISOString().slice(0, 10).split("-").reverse().join(".")}, но после этого менялась`, delta: null, unit: "", entity: h.ref.batch(b), href: h.href.batch(b.number) });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "verified-updated-at",
    title: "Подтверждённая запись не обновлялась после подтверждения (метка updatedAt)",
    group: "Подтверждение и документы",
    severity: "warn",
    tolerance: "1 минута",
    what: "У подтверждённой закупки или ТЗ метка updatedAt не позже подтверждения. Если она новее, а в журнале правок нет — запись изменена скриптом/в обход журнала: подтверждение стоит перепроверить.",
    fix: "Контроль → Подтвердить: перепроверить запись и подтвердить заново. Массовые скрипты должны писать журнал и сбрасывать подтверждение.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      const touched = new Map<string, Date>();
      for (const a of d.auditAfter) {
        const cur = touched.get(a.recordId);
        if (!cur || a.at > cur) touched.set(a.recordId, a.at);
      }
      const later = (ids: string[], since: Date) => ids.some((id) => (touched.get(id)?.getTime() ?? 0) > since.getTime() + 60_000);
      for (const p of d.purchases) {
        if (!p.verifiedAt) continue;
        n++;
        const ids = [p.id, ...p.items.map((i) => i.id), ...p.payments.map((x) => x.id), ...(h.lotsByPurchase.get(p.id) ?? []).map((l) => l.id)];
        if (p.updatedAt.getTime() > p.verifiedAt.getTime() + 60_000 && !later(ids, p.verifiedAt)) v.push({ key: p.id, message: `${h.ref.purchase(p).label} подтверждена ${p.verifiedAt.toISOString().slice(0, 10).split("-").reverse().join(".")}, но запись обновлена позже (updatedAt ${p.updatedAt.toISOString().slice(0, 10)}), а в журнале правок нет`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
      }
      for (const o of d.orders) {
        if (!o.verifiedAt) continue;
        n++;
        const ids = [o.id, ...(h.usagesByOrder.get(o.id) ?? []).map((u) => u.id), ...o.allocations.map((a) => a.paymentId)];
        if (o.updatedAt.getTime() > o.verifiedAt.getTime() + 60_000 && !later(ids, o.verifiedAt)) v.push({ key: o.id, message: `${h.ref.order(o).label} подтверждено ${o.verifiedAt.toISOString().slice(0, 10)}, но запись обновлена позже (updatedAt ${o.updatedAt.toISOString().slice(0, 10)}), а в журнале правок нет`, delta: null, unit: "", entity: h.ref.order(o), href: h.href.order(o.id) });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "verified-vs-data",
    title: "Подтверждённая запись не имеет расхождений",
    group: "Подтверждение и документы",
    severity: "error",
    tolerance: "как у соответствующих проверок",
    what: "Закупка/ТЗ/партия со статусом «подтверждено» не фигурируют в других расхождениях (лоты, себестоимость, оплаты, документы).",
    fix: "Открыть запись, исправить расхождение, затем подтвердить заново.",
    run: ({ d, prev, helpers: h }) => {
      const verified = new Map<string, EntityRef>();
      for (const p of d.purchases) if (p.verifiedAt) verified.set(`purchase:${p.id}`, h.ref.purchase(p));
      for (const o of d.orders) if (o.verifiedAt) verified.set(`order:${o.id}`, h.ref.order(o));
      for (const b of d.batches) if (b.verifiedAt) verified.set(`batch:${b.id}`, h.ref.batch(b));
      const skip = new Set(["verified-vs-data", "verified-after-edit", "verified-updated-at", "cache-auction", "cache-color", "cache-category", "cache-lot-item", "order-price-model", "prod-payment-alloc"]);
      const v: Violation[] = [];
      const seen = new Set<string>();
      for (const [cid, list] of prev) {
        if (skip.has(cid)) continue;
        for (const x of list) {
          for (const e of [x.entity, ...(x.also ?? [])]) {
            const k = `${e.kind}:${e.id}`;
            if (!verified.has(k) || seen.has(`${k}:${cid}`)) continue;
            seen.add(`${k}:${cid}`);
            v.push({ key: `${k}:${cid}`, message: `${verified.get(k)!.label} подтверждена, но: ${x.message}`, delta: x.delta, unit: x.unit, entity: verified.get(k)!, href: x.href, tags: [...(x.tags ?? []), `via:${cid}`] });
          }
        }
      }
      return { checked: verified.size, violations: v };
    },
  },
  {
    id: "doc-sum-vs-record",
    title: "Сумма в документах = сумма в записи",
    group: "Подтверждение и документы",
    severity: "warn",
    tolerance: `${ROUND_TOL_RUB} ₽ (ROUND_TOL_RUB)`,
    what: "Для групп реестра сверки (аукцион/закупка и партия) сумма из УПД/расчёта подрядчика совпадает с суммой по записям в базе (закупки с НДС; работа партии).",
    fix: "Контроль → Сверка: группа с расхождением; исправить закупку/ТЗ либо зафиксировать решение владельца в реестре.",
    run: ({ d, helpers: h }) => {
      type G = { id: string; section: string; title: string; doc: { costRub: number | null }; dbLink: { purchases?: string[]; batch?: number } };
      const groups = (recon as unknown as { groups: G[] }).groups;
      const byNo = new Map(d.purchases.map((p) => [p.number, p]));
      const v: Violation[] = [];
      let n = 0;
      for (const g of groups) {
        const docCost = g.doc?.costRub;
        if (docCost == null) continue;
        let live: number | null = null;
        let ent: EntityRef = { kind: "system", id: g.id, label: g.title };
        let href = "/reconciliation";
        if (g.section === "purchase") {
          const ps = (g.dbLink?.purchases ?? []).map((x) => byNo.get(x)).filter((x): x is IPurchase => !!x);
          if (!ps.length) continue;
          live = ps.filter((p) => p.status !== "CANCELLED").reduce((s, p) => s + h.purchaseTotal(p), 0);
          ent = h.ref.purchase(ps[0]);
          href = h.href.purchase(ps[0].id);
        } else if (g.dbLink?.batch != null) {
          const b = d.batches.find((x) => x.number === g.dbLink.batch);
          if (!b) continue;
          const os = d.orders.filter((o) => o.batchId === b.id && o.status !== "CANCELLED");
          if (!os.length) continue;
          live = os.reduce((s, o) => s + (o.clientWorkPricePerUnit ?? 0) * h.orderUnits(o), 0);
          ent = h.ref.batch(b);
          href = h.href.batch(b.number);
        }
        if (live == null) continue;
        n++;
        const delta = r2(live - docCost);
        if (Math.abs(delta) > ROUND_TOL_RUB) v.push({ key: g.id, message: `${g.title}: в документах ${money(docCost)}, в базе ${money(r2(live))}`, delta, unit: "₽", entity: ent, href, tags: [`group:${g.id}`] });
      }
      return { checked: n, violations: v };
    },
  },

  {
    id: "alloc-over-payment",
    title: "Разнесение оплаты подрядчику не больше суммы оплаты",
    group: "Оплаты и долг",
    severity: "error",
    tolerance: "1 ₽",
    what: "Σ разнесений оплаты по ТЗ (PaymentAllocation) не превышает сумму самой оплаты.",
    fix: "Производство → оплаты → «Изменить»: уменьшить доли по ТЗ либо исправить сумму оплаты.",
    run: ({ d }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.prodPayments) {
        const a = d.allocByPayment.get(p.id);
        if (a == null) continue;
        n++;
        const delta = r2(a - p.amount);
        if (delta > 1) v.push({ key: p.id, message: `Оплата подрядчику ${money(p.amount)} от ${p.paidAt.toISOString().slice(0, 10)}: разнесено ${money(r2(a))}, больше суммы оплаты`, delta, unit: "₽", entity: { kind: "prodPayment", id: p.id, label: `Оплата подрядчику ${money(p.amount)}` }, href: "/payments?tab=clients" });
      }
      return { checked: n, violations: v };
    },
  },

  // ===== Дубли =====
  {
    id: "dup-payment",
    title: "Нет дублей оплат",
    group: "Дубли",
    severity: "warn",
    tolerance: "нет",
    what: "Нет двух проведённых оплат с одинаковым поставщиком, суммой, датой и привязкой (закупка/аукцион).",
    fix: "Оплаты: удалить лишнюю запись (удаление — только решением владельца).",
    run: ({ d }) => {
      const seen = new Map<string, string>();
      const v: Violation[] = [];
      for (const p of d.payments) {
        if (p.status !== "COMPLETED") continue;
        const k = [p.supplierId, p.amount.toFixed(2), p.paidAt.toISOString().slice(0, 10), p.purchaseId ?? "", auctionName(p.auctionSession) ?? "", p.docRef ?? ""].join("|");
        if (seen.has(k)) v.push({ key: p.id, message: `Две одинаковые оплаты ${money(p.amount)} от ${p.paidAt.toISOString().slice(0, 10)}${p.docRef ? ` (${p.docRef})` : ""}`, delta: p.amount, unit: "₽", entity: { kind: "payment", id: p.id, label: `Оплата ${money(p.amount)}` }, href: p.purchaseId ? `/purchases/${p.purchaseId}` : "/payments" });
        else seen.set(k, p.id);
      }
      return { checked: d.payments.length, violations: v };
    },
  },
  {
    id: "dup-lot",
    title: "Нет дублей лотов в закупке",
    group: "Дубли",
    severity: "warn",
    tolerance: "нет",
    what: "В одной закупке нет двух лотов одного материала с одинаковым номером, количеством и ценой.",
    fix: "Закупка / лоты: удалить дубль (если он не списан).",
    run: ({ d, helpers: h }) => {
      const seen = new Map<string, string>();
      const v: Violation[] = [];
      for (const l of d.lots) {
        if (!l.purchaseId || !l.lotNumber) continue;
        const k = [l.purchaseId, l.rawMaterialId, l.lotNumber, l.quantityReceived, l.unitCost].join("|");
        if (seen.has(k)) {
          const p = h.purchaseById.get(l.purchaseId);
          v.push({ key: l.id, message: `${h.ref.lot(l).label}: повтор лота в закупке`, delta: r2(l.totalCost), unit: "₽", entity: p ? h.ref.purchase(p) : h.ref.lot(l), href: p ? h.href.purchase(p.id) : h.href.lot(l.id) });
        } else seen.set(k, l.id);
      }
      return { checked: d.lots.length, violations: v };
    },
  },
  {
    id: "dup-doc-link",
    title: "Один документ не приложен дважды к одной записи",
    group: "Дубли",
    severity: "info",
    tolerance: "нет",
    what: "Один и тот же документ не приложен дважды к одной и той же записи.",
    fix: "Документы записи: убрать повторную привязку.",
    run: ({ d }) => {
      const seen = new Map<string, number>();
      for (const x of d.driveLinks) {
        const k = [x.driveFileId, x.purchaseId, x.lotId, x.productionOrderId, x.productionBatchId, x.paymentId, x.productionPaymentId].join("|");
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      const dup = [...seen.entries()].filter(([, c]) => c > 1);
      const v: Violation[] = dup.slice(0, 50).map(([k, c]) => ({ key: k, message: (() => { const owner = (["закупке", "лоту", "ТЗ", "партии", "оплате поставщику", "оплате подрядчику"] as const)[k.split("|").slice(1).findIndex((x) => x !== "" && x !== "null" && x !== "undefined")]; return owner ? `Один документ приложен к одной записи (${owner}) ${c} раза` : `Один документ записан в базе ${c} раза без привязки к записи`; })(), delta: c - 1, unit: "ед." as const, entity: { kind: "system" as const, id: k, label: "Документ" }, href: "/documents" }));
      return { checked: d.driveLinks.length, violations: v };
    },
  },
  {
    id: "dup-model-code",
    title: "Артикул (код продаж) встречается один раз",
    group: "Дубли",
    severity: "warn",
    tolerance: "нет",
    what: "Нет двух изделий с одинаковым кодом продаж.",
    fix: "Настройки → Артикулы: объединить дубли.",
    run: ({ d }) => {
      const seen = new Map<string, string>();
      const v: Violation[] = [];
      for (const m of d.models) {
        const c = (m.salesCode ?? "").trim().toLowerCase();
        if (!c) continue;
        if (seen.has(c)) v.push({ key: m.id, message: `Код продаж «${m.salesCode}» у двух изделий: «${m.name}» и другого`, delta: null, unit: "", entity: { kind: "model", id: m.id, label: `Изделие ${m.name}` }, href: "/settings/articles-ref" });
        else seen.set(c, m.id);
      }
      return { checked: d.models.length, violations: v };
    },
  },
];

export const ALL_CHECKS: readonly CheckDef[] = CHECKS;
export { fmt as fmtNum, money as fmtMoney, sgn as fmtSigned };
