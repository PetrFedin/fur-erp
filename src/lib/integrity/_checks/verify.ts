import { r2, type IPurchase } from "../data";
import type { Violation, EntityRef } from "../types";

import { ROUND_TOL_RUB, CheckDef, money } from "../checks-base";

/** Проверки раздела «Подтверждение и документы». */
export const VERIFY_CHECKS: CheckDef[] = [
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
    title: "Подтверждённая запись не обновлялась после подтверждения",
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
        if (p.updatedAt.getTime() > p.verifiedAt.getTime() + 60_000 && !later(ids, p.verifiedAt)) v.push({ key: p.id, message: `${h.ref.purchase(p).label} подтверждена ${p.verifiedAt.toISOString().slice(0, 10).split("-").reverse().join(".")}, изменена ${p.updatedAt.toISOString().slice(0, 10).split("-").reverse().join(".")} без записи в журнале правок`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
      }
      for (const o of d.orders) {
        if (!o.verifiedAt) continue;
        n++;
        const ids = [o.id, ...(h.usagesByOrder.get(o.id) ?? []).map((u) => u.id), ...o.allocations.map((a) => a.paymentId)];
        if (o.updatedAt.getTime() > o.verifiedAt.getTime() + 60_000 && !later(ids, o.verifiedAt)) v.push({ key: o.id, message: `${h.ref.order(o).label} подтверждено ${o.verifiedAt.toISOString().slice(0, 10).split("-").reverse().join(".")}, изменено ${o.updatedAt.toISOString().slice(0, 10).split("-").reverse().join(".")} без записи в журнале правок`, delta: null, unit: "", entity: h.ref.order(o), href: h.href.order(o.id) });
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
      const groups = d.recon;
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

];
