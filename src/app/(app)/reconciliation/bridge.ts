import "server-only";
// Мост «Реестр документов → разница по статьям → Главная». Только чтение, ничего не пишет.
// Реестр = Σ счетов Веллмех из документов (src/data/reconciliation.json). Главная = «Общая стоимость» сырья и работы: оплачено + к оплате
// (loadPaymentsOverview / loadPaymentsLeft — те же числа, что в виджетах Главной и в «Оплатах»). Мост строится по ВСЕМ годам.
import { prisma } from "@/lib/prisma";
import { loadPaymentsLeft, loadPaymentsOverview } from "@/lib/payments-overview";
import { loadDebtInputs, supplierDebtFromInputs } from "@/lib/supplier-debt";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import type { Live } from "./live";
import { ALL_GROUPS, ALL_INVOICES, calcInvoice, groupInvoices, totalsOf } from "./model";

export type BridgeRow = { label: string; value: number; note?: string };
export type ReconBridge = {
  registry: { total: number; purchase: number; production: number };
  main: { total: number; raw: number; work: number; hides: number };
  /** Главная − реестр, закупки сырья: строки по группам, ниже мелочи, закупки вне реестра и шкуры подрядчика. */
  purchase: BridgeRow[];
  /** Главная − реестр, производство (работа). */
  production: BridgeRow[];
  /** «Есть в документах, нет в базе» — это про ОПЛАТЫ, на суммы счетов и на Главную не влияет. */
  missingInDb: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const SMALL = 500;

export async function loadReconBridge(orgId: string, live: Live): Promise<ReconBridge> {
  const [ov, left, inp, dash] = await Promise.all([loadPaymentsOverview(orgId), loadPaymentsLeft(orgId), loadDebtInputs(prisma, orgId), loadDashboard(orgId, "all", parseDashFilters({}), "off")]);
  const sum = (k: "fur" | "lining" | "work" | "hides") => ov.reduce((a, r) => a + r[k], 0);
  const mainRawDocs = sum("fur") + sum("lining") + Array.from(left.byYear.values()).reduce((a, v) => a + v.raw, 0);
  // Сырьё «Главной» = «Куплено» мех + подкладка (сумма лотов). Документы отличаются от лотов на копейки (цена за единицу в лоте округлена): это отдельная строка «Прочее (округление)».
  // Больше пяти рублей — уже не округление (неполученный мех, фильтры): тогда берём документы, как раньше.
  const mainRawLots = dash.raw.fur.incl.recvValue + dash.raw.lining.incl.recvValue;
  const mainRaw = Math.abs(mainRawLots - mainRawDocs) <= 5 ? mainRawLots : mainRawDocs;
  const mainWork = sum("work") + Array.from(left.byYear.values()).reduce((a, v) => a + v.prod, 0);
  const debtTotal = supplierDebtFromInputs(inp, "all").total.toNumber();
  const hides = sum("hides");

  const ids = new Set(ALL_INVOICES.map((i) => i.id));
  const all = ALL_INVOICES.map((i) => calcInvoice(i));
  const regPurchase = totalsOf(all.filter((c) => c.inv.section === "purchase")).amount;
  const regProduction = totalsOf(all.filter((c) => c.inv.section === "production")).amount;

  // Закупки: по группам реестра — Главная (стоимость закупок группы в базе) минус реестр (счета группы).
  const purchase: BridgeRow[] = [];
  let dbGroups = 0, small = 0, smallN = 0;
  for (const g of ALL_GROUPS.filter((x) => x.section === "purchase")) {
    const reg = totalsOf(groupInvoices(g, ids)).amount;
    const db = live.group.get(g.id);
    const cost = db?.cost ?? 0;
    dbGroups += cost;
    const d = r2(cost - reg);
    if (Math.abs(d) < 0.005) continue;
    if (Math.abs(d) < SMALL) { small += d; smallN += 1; continue; }
    purchase.push({
      label: db?.title ?? g.title,
      value: d,
      note: reg === 0 ? "закупка есть в базе, счёта Веллмех в реестре нет" : d > 0 ? "в базе закупка больше, чем по счетам реестра" : "по счетам реестра больше, чем закупка в базе (переплата / счёт на большую сумму)",
    });
  }
  purchase.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (smallN > 0) purchase.push({ label: `Мелкие расхождения до ${SMALL} ₽ (округление), групп: ${smallN}`, value: r2(small) });
  const outside = r2(debtTotal - dbGroups);
  if (Math.abs(outside) >= 0.005) purchase.push({ label: "Закупки в базе вне групп реестра", value: outside, note: "закупки, которые не привязаны ни к одной группе реестра" });
  if (Math.abs(hides) >= 0.005) purchase.push({ label: "Шкуры подрядчика", value: r2(hides), note: "оплачены в составе счетов за пошив; на Главной входят в сырьё («Использовано» меха), в реестре закупок их нет" });
  const purchaseRest = r2(mainRaw - regPurchase - purchase.reduce((a, r) => a + r.value, 0));
  if (Math.abs(purchaseRest) >= 0.005) purchase.push({ label: "Прочее (округление)", value: purchaseRest });

  // Производство: счета вне партий (авансы, аксессуары, дозаказы) и по партиям против работы по ТЗ в базе.
  const prodGroups = ALL_GROUPS.filter((x) => x.section === "production");
  let s1 = 0, s2 = 0, w2 = 0;
  const seenBatch = new Set<number>();
  for (const g of prodGroups) {
    const reg = totalsOf(groupInvoices(g, ids)).amount;
    const b = g.dbLink.batch;
    if (b == null) { s1 += reg; continue; }
    s2 += reg;
    if (!seenBatch.has(b)) { seenBatch.add(b); w2 += live.group.get(g.id)?.cost ?? 0; }
  }
  const production: BridgeRow[] = [
    { label: "Счета вне партий: авансы, аксессуары, кейп, капсула, дозаказы — в Главную не входят", value: r2(-s1), note: "это счета Веллмех на аванс/сумму без ТЗ в базе; на Главной они отражены оплатой (неразнесённые авансы), а не работой" },
    { label: "Партии со счетами: работа по ТЗ в базе минус счета реестра", value: r2(w2 - s2), note: "в базе работа считается по ТЗ (цена за единицу × количество), в реестре — по выставленным счетам (аванс и доплата)" },
  ];
  const prodRest = r2(mainWork - w2);
  if (Math.abs(prodRest) >= 0.005) production.push({ label: "Работа подрядчику по ТЗ в базе вне групп реестра (партии без счёта, ТЗ вне партий)", value: prodRest });
  const check = r2(mainWork - regProduction - production.reduce((a, r) => a + r.value, 0));
  if (Math.abs(check) >= 0.005) production.push({ label: "Прочее (округление)", value: check });

  let missing = 0;
  for (const i of ALL_INVOICES) {
    const docs = i.paid.filter((p) => p.evidence === "fact").reduce((a, p) => a + p.amountRub, 0);
    const d = docs - (live.inv.get(i.id)?.paid ?? 0);
    if (d > 1) missing += d;
  }
  return {
    registry: { total: r2(regPurchase + regProduction), purchase: r2(regPurchase), production: r2(regProduction) },
    main: { total: r2(mainRaw + mainWork), raw: r2(mainRaw), work: r2(mainWork), hides: r2(hides) },
    purchase, production, missingInDb: r2(missing),
  };
}
