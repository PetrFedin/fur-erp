import { r2 } from "../data";
import type { Violation } from "../types";

import { CheckDef, fmt, money } from "../checks-base";

/** Проверки раздела «ТЗ и себестоимость». */
export const ORDER_CHECKS: CheckDef[] = [
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

];
