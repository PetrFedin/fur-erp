import { isServicePurchase } from "../../service-purchase";

import { r2 } from "../data";
import type { Violation } from "../types";

import { ROUND_TOL_RUB, CheckDef, fmt, money } from "../checks-base";

/** Проверки раздела «Закупки». */
export const PURCHASE_CHECKS: CheckDef[] = [
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
        if (isServicePurchase(p)) continue; // закупка-услуга (УПД без позиций сырья): лотов нет по определению
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

];
