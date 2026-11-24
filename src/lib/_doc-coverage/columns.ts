import "server-only";
import type { DriveDocTypeKey } from "@/lib/drive-docs";
import { type ColKey, type Need, type CellRule, type RowRules, type SectionKey, type Cell, type Gap, type CovDoc } from "./shared";

export const COLUMNS: { key: ColKey; label: string; attach: string; types: DriveDocTypeKey[] }[] = [
  { key: "AUCTION_INVOICE", label: "Счёт аукциона", attach: "Счёт аукциона на лоты закупки", types: ["AUCTION_INVOICE"] },
  { key: "UPD", label: "УПД", attach: "УПД (передаточный документ)", types: ["UPD"] },
  { key: "CALC_SHEET", label: "Расчёт", attach: "Расчёт себестоимости / расчётный лист", types: ["CALC_SHEET"] },
  { key: "SPECIFICATION", label: "Спецификация", attach: "Спецификация к договору", types: ["SPECIFICATION"] },
  { key: "PAYMENT", label: "Оплата / платёжка", attach: "Платёжка или счёт на оплату", types: ["PAYMENT_PROOF", "PAYMENT_INVOICE"] },
  { key: "APPROVAL_EMAIL", label: "Письмо", attach: "Письмо-согласование", types: ["APPROVAL_EMAIL"] },
  { key: "TZ_APPENDIX", label: "ТЗ-приложение", attach: "Приложение к ТЗ (техническое задание заказчика)", types: ["TZ_APPENDIX"] },
  { key: "CONTRACT", label: "Договор", attach: "Договор", types: ["CONTRACT"] },
];

const REQ: CellRule = { need: "required" };

const OPT: CellRule = { need: "optional" };

/**
 * Закупки с «аукционом», у которого счёта аукциона быть не может: ферма (КФХ), подкладка, доп. материалы по спецификации и белая норка по счетам №80/№96 —
 * покупаются напрямую у поставщика. Только для правил покрытия: отображение «Без аукциона» (auction-names.ts) не затрагивается.
 */
const NO_INVOICE_PREFIXES = ["кфх", "подкладка", "доп. материалы", "белая норка"];

 // «Белая норка №80/№96» — прямые закупки по счетам Веллмеха, торгов нет
export function noAuctionInvoice(auction: string | null | undefined): boolean {
  if (!auction) return false;
  const n = auction.replace(/\s+/g, " ").trim().toLowerCase().replace(/ё/g, "е");
  return NO_INVOICE_PREFIXES.some((p) => n.startsWith(p));
}

/** Закупка. Аукцион из заглушек импорта («Нет информации», пусто) — не реальные торги, счёта аукциона у неё быть не может. */
export function purchaseRules(p: { status: string; realAuction: boolean; hasPayments: boolean; contractorRaw?: boolean }): RowRules {
  const auctionInvoice: CellRule = p.realAuction ? REQ : { need: "na" };
  const payment: CellRule = {
    need: p.hasPayments ? "required" : "optional",
    label: "Платёжка / счёт на оплату",
    attach: "Платёжка или счёт на оплату (по оплатам закупки или её аукциона)",
  };
  if (p.contractorRaw) {
    // Сырьё подрядчика: УПД и спецификации поставщика на него быть не может, расчёт — это расчёт доплаты партии (желателен).
    return { AUCTION_INVOICE: auctionInvoice, UPD: { need: "na" }, SPECIFICATION: { need: "na" }, CALC_SHEET: OPT, PAYMENT: payment, APPROVAL_EMAIL: OPT };
  }
  if (p.status === "RECEIVED") {
    // Принятая на склад: счёт аукциона, УПД, расчёт себестоимости, спецификация, документ оплаты
    // (если оплаты есть); письмо-согласование — необязательно.
    return { AUCTION_INVOICE: auctionInvoice, UPD: REQ, CALC_SHEET: REQ, SPECIFICATION: REQ, PAYMENT: payment, APPROVAL_EMAIL: OPT };
  }
  // Черновик: спецификация + счёт; остальное появится после приёмки.
  return { AUCTION_INVOICE: auctionInvoice, SPECIFICATION: REQ, PAYMENT: payment, CALC_SHEET: OPT, APPROVAL_EMAIL: OPT };
}

/** ТЗ: приложение к ТЗ нужно всегда; у завершённого — ещё расчёт партии или УПД (берутся у партии ТЗ). */
export function tzRules(o: { status: string }): RowRules {
  const rules: RowRules = { TZ_APPENDIX: REQ };
  if (o.status === "COMPLETED") {
    rules.CALC_SHEET = {
      need: "required",
      accepts: ["CALC_SHEET", "UPD"],
      label: "Расчёт партии или УПД",
      attach: "Расчёт партии (расчётный лист) или УПД — на партию ТЗ или на само ТЗ",
    };
    rules.UPD = OPT;
  }
  return rules;
}

/** Партия производства: счёт на доплату и расчёт доплаты. Для партий с оплатами — ещё и документ к каждой оплате (см. extras в computeDocCoverage). */
export function batchRules(): RowRules {
  return {
    PAYMENT: { need: "required", accepts: ["PAYMENT_INVOICE"], label: "Счёт на доплату", attach: "Счёт на доплату по партии" },
    CALC_SHEET: { need: "required", label: "Расчёт доплаты", attach: "Расчёт доплаты по партии (расчётный лист)" },
    UPD: OPT,
    APPROVAL_EMAIL: OPT,
  };
}

/** Оплата (за сырьё или за работу): платёжка, счёт, письмо-согласование или УПД — либо номер платёжки в поле «документ». */
export function paymentRules(): RowRules {
  return {
    PAYMENT: {
      need: "required",
      accepts: ["PAYMENT_PROOF", "PAYMENT_INVOICE", "APPROVAL_EMAIL", "UPD"],
      viaRef: true,
      label: "Документ к оплате",
      attach: "Платёжка, счёт или письмо-согласование (либо укажите номер платёжки в поле «документ» оплаты)",
    },
  };
}

/** Поставщик и заказчик: договор. */
export function contractRules(): RowRules {
  return { CONTRACT: REQ };
}

export const SECTION_ORDER: SectionKey[] = ["purchases", "tz", "batches", "payments", "prodPayments", "contracts"];

export const SECTION_TITLES: Record<SectionKey, string> = {
  purchases: "Закупки",
  tz: "ТЗ",
  batches: "Партии",
  payments: "Оплаты поставщику",
  prodPayments: "Оплаты производства",
  contracts: "Договоры",
};

export const normTitle = (s: string) =>
  s.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "").replace(/[^a-zа-яё0-9]+/g, "");

export const PURCHASE_KIND_TO_TYPE: Record<string, DriveDocTypeKey> = {
  AUCTION_INVOICE: "AUCTION_INVOICE",
  SPECIFICATION: "SPECIFICATION",
  ADVANCE_INVOICE: "PAYMENT_INVOICE",
  CALC_SHEET: "CALC_SHEET",
  UPD: "UPD",
  PAYMENT_PROOF: "PAYMENT_PROOF",
  OTHER: "OTHER",
};

/** Один документ — один раз: по типу + названию или по id файла Drive. */
export function uniq(docs: CovDoc[]): CovDoc[] {
  const seen = new Set<string>();
  const out: CovDoc[] = [];
  for (const d of docs) {
    if (d.keys.some((k) => seen.has(k))) continue;
    d.keys.forEach((k) => seen.add(k));
    out.push(d);
  }
  return out;
}

export function evaluate(rules: RowRules, docs: CovDoc[], docRef: boolean, docsFor?: Partial<Record<ColKey, CovDoc[]>>) {
  const cells = {} as Record<ColKey, Cell>;
  const gaps: Gap[] = [];
  let required = 0;
  let have = 0;
  for (const col of COLUMNS) {
    const rule = rules[col.key] ?? { need: "na" as Need };
    if (rule.need === "na") {
      cells[col.key] = { need: "na", count: 0, ok: false, viaRef: false };
      continue;
    }
    const accepts = rule.accepts ?? col.types;
    const count = (docsFor?.[col.key] ?? docs).filter((d) => accepts.includes(d.type)).length;
    const viaRef = count === 0 && !!rule.viaRef && docRef;
    const ok = count > 0 || viaRef;
    cells[col.key] = { need: rule.need, count, ok, viaRef };
    if (rule.need === "required") {
      required++;
      if (ok) have++;
      else gaps.push({ label: rule.label ?? col.label, attach: rule.attach ?? col.attach });
    }
  }
  return { cells, gaps, required, have };
}
