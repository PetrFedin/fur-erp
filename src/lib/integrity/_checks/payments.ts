import { auctionName } from "../../auction-names";

import { r2, type IOrder } from "../data";
import type { Violation } from "../types";

import { ROUND_TOL_RUB, CheckDef, money } from "../checks-base";

/** Проверки раздела «Оплаты». */
export const PAYMENT_CHECKS: CheckDef[] = [
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
    what: "У оплаты (поставщику и подрядчику), отмеченной «подтверждена», есть платёжный документ (запись документа или файл) либо номер платёжки/счёта.",
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

];
