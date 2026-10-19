import "server-only";
import { prisma } from "@/lib/prisma";
import { loadVerifyFlags } from "@/lib/verification";
import { calcInvoice, totalsOf, visibleFor } from "@/app/(app)/reconciliation/model";
import type { DashboardData } from "@/lib/dashboard-data";

/** Надёжность данных: те же числа, что в «Контроль → Сверка» (реестр счетов, все годы) и «Ждёт проверки». Ничего не пересчитывается заново. */
export type ReliabilityData = {
  /** Сумма счетов реестра (₽) и сколько из неё оплачено (по документам и письмом). */
  amount: number;
  paid: number;
  pct: number;
  paidDocs: number;
  paidLetter: number;
  approved: number;
  none: number;
  rowsVerified: number;
  rowsTotal: number;
  decisions: number;
};

export async function loadReliability(orgId: string, d: DashboardData): Promise<ReliabilityData> {
  const t = totalsOf(visibleFor("all").invs.map((i) => calcInvoice(i)));
  const vf = await loadVerifyFlags(prisma, orgId);
  const rows = Object.values(vf.counts).reduce((s, c) => ({ total: s.total + c.total, verified: s.verified + c.verified }), { total: 0, verified: 0 });
  return {
    amount: t.amount, paid: t.paid, pct: t.pct, paidDocs: t.paidDocs, paidLetter: t.paidLetter, approved: t.approvedRub, none: t.noneRub,
    rowsVerified: rows.verified, rowsTotal: rows.total, decisions: d.control?.decisions ?? 0,
  };
}

type Pair = { incl: number; excl: number };
const pair = (incl: number, excl: number): Pair => ({ incl, excl });

/** Числа полосы «Главное»: все взяты из loadDashboard (те же поля, что у плиток блоков «Сырьё», «Производство», «Оплаты»). Деньги — парой «с НДС / без НДС». */
export type StripData = {
  fur: { recvQty: number; recvValue: Pair; usedQty: number; remQty: number };
  lining: { recvQty: number; recvValue: Pair; remQty: number };
  prod: { qty: number; orders: number; cost: Pair; avg: Pair | null; work: number };
  work: { accrued: number; paid: number; left: number; /** Аванс подрядчику (неразнесённый): входит в paid, не входит в accrued и left. */ advance: number };
  supplier: { paid: number; debt: number };
  total: { paid: number; left: number; all: number };
  overdue: { count: number; amount: number; nextDate: string | null; nextAmount: number };
};

const isPastRu = (date: string): boolean => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59).getTime() < Date.now() : false;
};

export function buildStrip(d: DashboardData, c4: "on" | "off"): StripData {
  const sumTwo = (a: number, b: number) => a + b;
  const { done, work, all } = d.prod;
  // Как в ProductionBlock: факт по всем ТЗ (завершённые + в работе); ремонт в «на изделие» не входит; шкуры подрядчика — в себестоимости.
  const qty = sumTwo(done.qty, work.qty);
  const costIncl = done.costIncl + work.costIncl, costExcl = done.costExcl + work.costExcl;
  const repIncl = done.repairCostIncl + work.repairCostIncl, repExcl = done.repairCostExcl + work.repairCostExcl;
  const workSum = done.workSum + work.workSum;
  const matCost = (vat: "incl" | "excl") => (vat === "incl" ? costIncl : costExcl) + d.hides[vat] + workSum;
  const F = d.raw.fur, L = d.raw.lining;
  void c4;
  const rawLeft = d.left.fur + d.left.lining;
  const prodPaid = d.paidByItem.work;
  const paidAll = d.paidByItem.fur + d.paidByItem.lining + d.paidByItem.services + prodPaid;
  // «К оплате» = долг по сырью и услугам + остаток работы по ТЗ (не меньше нуля); неразнесённый аванс подрядчику — отдельно (advance), в «Всего» не входит.
  const leftAll = rawLeft + d.left.services + d.left.prod;
  const late = d.invoiceDeadlines.filter((x) => isPastRu(x.date));
  const next = d.invoiceDeadlines.find((x) => !isPastRu(x.date));
  return {
    fur: { recvQty: F.incl.recvQty, recvValue: pair(F.incl.recvValue, F.excl.recvValue), usedQty: F.incl.usedQty, remQty: F.incl.remQty },
    lining: { recvQty: L.incl.recvQty, recvValue: pair(L.incl.recvValue, L.excl.recvValue), remQty: L.incl.remQty },
    prod: {
      qty, orders: all.orders,
      cost: pair(matCost("incl"), matCost("excl")),
      avg: qty > 0 ? pair((costIncl - repIncl) / qty, (costExcl - repExcl) / qty) : null,
      work: workSum,
    },
    work: { accrued: prodPaid - d.advance + d.left.prod, paid: prodPaid, left: d.left.prod, advance: d.advance },
    supplier: { paid: d.paidByItem.fur + d.paidByItem.lining + d.paidByItem.services, debt: rawLeft + d.left.services },
    total: { paid: paidAll, left: leftAll, all: paidAll + leftAll - d.advance },
    overdue: { count: late.length, amount: late.reduce((a, x) => a + x.amount, 0), nextDate: next?.date ?? null, nextAmount: next?.amount ?? 0 },
  };
}
