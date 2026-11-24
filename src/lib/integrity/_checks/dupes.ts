import { auctionName } from "../../auction-names";

import { r2 } from "../data";
import type { Violation } from "../types";

import { CheckDef, money } from "../checks-base";

/** Проверки раздела «Дубли». */
export const DUPE_CHECKS: CheckDef[] = [
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
