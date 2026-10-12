// Типы и сумма строк таблицы закупок: общий модуль (не "use client"), чтобы aggregate() можно было вызывать и на сервере.

export type TreeUsage = { orderId: string; number: string; qty: number; sum: number };
export type TreeItem = {
  id: string; lotId: string | null; material: string; unit: "шт." | "м"; qty: number; lot: string | null;
  color: string | null; size: string | null; grade: string | null;
  sum: number; priceRub: number | null; priceUsd: number | null;
  /** Данные лота склада (нет у закупок, где лот ещё не создан). */
  recv: number | null; used: number; rem: number; usages: TreeUsage[];
};
export type TreeExpense = { id: string; label: string; sum: number };
export type TreePay = { id: string; date: string; amount: number; doc: string | null };
export type PurchaseStatus = "RECEIVED" | "DRAFT" | "CANCELLED";
export type TreePurchase = {
  id: string; number: string; date: string; year: number; batchKey: string; batchLabel: string; auction: string | null;
  supplier: string; invoice: string | null; status: PurchaseStatus;
  total: number; totalExcl: number; paid: number; rest: number;
  /** Часть «Оплачено», пришедшая из оплат партии целиком (не привязанных к закупке). */
  paidBatch: number;
  lots: number; fur: number; lining: number;
  /** Использовано / куплено по лотам, ₽ (для процента) и остаток по лотам: шкур и метров. Лотов нет (черновик) — hasLots = false. */
  usedValue: number; recvValue: number; hasLots: boolean; remFur: number; remLining: number;
  items: TreeItem[]; expenses: TreeExpense[]; pays: TreePay[];
};
export type TreeBatch = { key: string; label: string; title?: string; href?: string; docsHref?: string; purchases: TreePurchase[] };
export type TreeYear = { year: number; batches: TreeBatch[] };

export type Agg = {
  purchases: number; draft: number; lots: number; fur: number; lining: number; total: number; totalExcl: number; paid: number; rest: number;
  usedValue: number; recvValue: number; hasLots: boolean; remFur: number; remLining: number; suppliers: string[];
};
const live = (list: TreePurchase[]) => list.filter((p) => p.status !== "CANCELLED");
export function aggregate(list: TreePurchase[]): Agg {
  const a: Agg = { purchases: 0, draft: 0, lots: 0, fur: 0, lining: 0, total: 0, totalExcl: 0, paid: 0, rest: 0, usedValue: 0, recvValue: 0, hasLots: false, remFur: 0, remLining: 0, suppliers: [] };
  for (const p of live(list)) {
    a.purchases += 1;
    if (p.status === "DRAFT") a.draft += 1;
    a.lots += p.lots; a.fur += p.fur; a.lining += p.lining;
    a.total += p.total; a.totalExcl += p.totalExcl; a.paid += p.paid; a.rest += p.rest;
    if (p.hasLots) { a.hasLots = true; a.usedValue += p.usedValue; a.recvValue += p.recvValue; a.remFur += p.remFur; a.remLining += p.remLining; }
    if (!a.suppliers.includes(p.supplier)) a.suppliers.push(p.supplier);
  }
  return a;
}

