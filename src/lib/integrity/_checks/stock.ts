import { r2 } from "../data";
import type { Violation } from "../types";

import { CheckDef, fmt, money } from "../checks-base";

/** Проверки раздела «Склад сырья». */
export const STOCK_CHECKS: CheckDef[] = [
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

];
