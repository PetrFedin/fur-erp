// Плитки оплат («Общая стоимость», «Оплачено всего», «К оплате всего») в целых рублях, сходящихся на экране (правило — src/lib/money-round.ts).
// Чистая функция без React: её вызывает PayTiles, а scripts/test-rounding-rule.ts проверяет на реальных данных.
import { alignColumn, alignKindsTop, flowCell, lrAllocate } from "@/lib/money-round";
import type { FlowFigures } from "@/lib/fur-table";

export type PayInput = {
  raw: { fur: { incl: FlowFigures }; lining: { incl: FlowFigures } };
  paidByItem: { fur: number; lining: number; services: number; work: number };
  left: { fur: number; lining: number; services: number; prod: number };
  /** Аванс подрядчику (неразнесённый): входит в «Оплачено» за работу, в «К оплате» и «Общую стоимость» — нет (отдельная строка). */
  advance: number;
};
type Item = "fur" | "lining" | "services" | "work";

/**
 * «К доплате после зачёта аванса» — единый показ «К оплате всего» (Главная, Оплаты, Cashflow): брутто (долг до зачёта аванса) − аванс подрядчику, не меньше нуля.
 * Брутто остаётся в расчётах и тождествах (долг = документы − оплаты); показ главным числом — нетто. Если аванс больше долга — «К доплате 0, аванс остаётся в зачёте X».
 */
export function payDue(gross: number, advance: number) {
  const adv = Math.max(0, advance);
  const net = Math.max(0, gross - adv);
  return { gross, adv, net, creditLeft: Math.max(0, adv - gross) };
}
export const DUE_LABEL = "К доплате после зачёта аванса";
/** Текст подсказки «i» (одинаковый везде, где есть этот показ). */
export const dueHint = (grossText: string, workText: string) => `${grossText} — долг до зачёта аванса; если аванс окажется оплатой будущих изделий, а не текущих ТЗ, доплата за текущие ТЗ остаётся ${workText}; привязка авансов к ТЗ ждёт документов.`;

/**
 * ГОД ПЛАТЕЖА = ГОД ДАТЫ ОПЛАТЫ (решение владельца 2026-10-20). Единая функция для «Оплат по годам», Главной, сводки закупок и Cashflow.
 * Дата оплаты хранится как 00:00 UTC (03:00 МСК того же дня), поэтому UTC-год совпадает с московским. Год закупки остаётся только в разрезе закупок (долг по аукциону).
 */
export function paymentYear(paidAt: Date | string): number {
  return typeof paidAt === "string" ? Number(paidAt.slice(0, 4)) : paidAt.getUTCFullYear();
}

export function payNumbers(d: PayInput, c4Mode: "on" | "off", only?: "fur" | "lining" | "raw") {
  const prodPaid = d.paidByItem.work;
  const bo = c4Mode === "on";
  const top = alignKindsTop(flowCell(d.raw.fur.incl, bo), flowCell(d.raw.lining.incl, bo));
  // Детализация меха и подкладки: остаток на складе, использовано (без 4%) и надбавка 4% (оплачена в составе оплат ТЗ, доплаты нет).
  const detail = (c: typeof top.fur) => ({ stock: c.m, used: c.u, c4: Math.abs(c.w - c.u) });
  const furD = detail(top.fur), linD = detail(top.lin);
  // Оплачено и к оплате делятся на «за использованное» и «за остаток на складе» пропорционально их стоимости; 4% оплачены в составе оплат ТЗ (доплаты нет).
  const split = (D: ReturnType<typeof detail>, exact: number, shown: number) => {
    const base = D.used + D.stock;
    const u = base > 0 ? D.used / base : 0;
    const [used, stock] = lrAllocate([exact * u, exact * (1 - u)], shown);
    return { used, stock };
  };

  const inFur = only !== "lining", inLin = only !== "fur", inWork = !only;
  // Услуги по УПД (закупки без позиций сырья) — отдельная статья; только когда они есть, и не в срезах «только мех» / «только подкладка».
  const inServ = (only === undefined || only === "raw") && (Math.abs(d.paidByItem.services) >= 0.5 || Math.abs(d.left.services) >= 0.5);
  const items: Item[] = [...(inFur ? ["fur" as const] : []), ...(inLin ? ["lining" as const] : []), ...(inServ ? ["services" as const] : []), ...(inWork ? ["work" as const] : [])];
  const paidEx: Record<Item, number> = { fur: d.paidByItem.fur, lining: d.paidByItem.lining, services: d.paidByItem.services, work: prodPaid };
  const leftEx: Record<Item, number> = { fur: d.left.fur, lining: d.left.lining, services: d.left.services, work: d.left.prod };
  const alPaid = alignColumn(items.map((k) => paidEx[k]));
  const alLeft = alignColumn(items.map((k) => leftEx[k]));
  const P = { fur: 0, lining: 0, services: 0, work: 0 }, L = { fur: 0, lining: 0, services: 0, work: 0 };
  items.forEach((k, i) => { P[k] = alPaid.values[i]; L[k] = alLeft.values[i]; });
  const paidAll = alPaid.total, leftAll = alLeft.total;
  // Общая стоимость по статье: сырьё — как «Куплено» на Главной (сумма лотов), если оно сходится с документами до пяти рублей (копеечное округление цен лотов);
  // иначе (фильтры, неполученный мех) и для работы — оплачено + к оплате. Разницу «лоты ↔ документы» показываем строкой «округление».
  const recvTotal = (k: "fur" | "lining") => {
    const exact = k === "fur" ? d.raw.fur.incl.recvValue : d.raw.lining.incl.recvValue;
    const diff = exact - (paidEx[k] + leftEx[k]);
    return Math.abs(diff) < 0.005 || Math.abs(diff) > 5 ? null : (k === "fur" ? top.fur.r : top.lin.r);
  };
  // Работа: «Общая стоимость» = работа по ТЗ = разнесённое + остаток; неразнесённый аванс — предоплата будущих ТЗ, в стоимость не входит (отдельная строка).
  const adv = inWork ? Math.max(0, Math.min(Math.round(d.advance), P.work)) : 0;
  const T = { fur: recvTotal("fur") ?? P.fur + L.fur, lining: recvTotal("lining") ?? P.lining + L.lining, services: P.services + L.services, work: P.work - adv + L.work };
  const roundAll = (inFur ? T.fur - P.fur - L.fur : 0) + (inLin ? T.lining - P.lining - L.lining : 0);
  const totalAll = items.reduce((a, k) => a + T[k], 0);
  const furPaidD = split(furD, paidEx.fur, P.fur), linPaidD = split(linD, paidEx.lining, P.lining);
  const furLeftD = split(furD, leftEx.fur, L.fur), linLeftD = split(linD, leftEx.lining, L.lining);
  const due = payDue(leftAll, adv);
  return { due, top, furD, linD, inFur, inLin, inWork, inServ, adv, items, P, L, T, paidAll, leftAll, roundAll, totalAll, furPaidD, linPaidD, furLeftD, linLeftD };
}
