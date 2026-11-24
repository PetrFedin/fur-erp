import { formatPercent } from "@/lib/utils";
import { DEFAULT_VAT } from "@/lib/cost-plan";
import { num, parseRuDate, parseMoney } from "./basic-fields";
import { type DocKindKey, type DocFind, type Recon, rub } from "./shared";

const AMOUNT_LABELS: { re: RegExp; rank: number; note: string }[] = [
  { re: /(?:всего|итого)\s+к\s+оплате/gi, rank: 6, note: "«Всего к оплате»" },
  { re: /(?:итого|всего)\s+с\s+ндс/gi, rank: 6, note: "«Итого с НДС»" },
  { re: /всего\s+по\s+сч[её]ту|сумма\s+сч[её]та/gi, rank: 5, note: "«Всего по счёту»" },
  { re: /к\s+оплате/gi, rank: 4, note: "«К оплате»" },
  { re: /(?:grand\s+total|total\s+amount|amount\s+due|total\s+due|invoice\s+total)/gi, rank: 5, note: "«Total»" },
  { re: /стоимость\s+всего\s+с\s+налогом|всего\s+по\s+документу/gi, rank: 5, note: "«Всего с налогом»" },
  { re: /итого/gi, rank: 2, note: "«Итого»" },
  { re: /\btotal\b/gi, rank: 2, note: "«Total»" },
];

const MONEY_AFTER = /[^\d\-]{0,70}?(\d[\d\s .,]*\d|\d)/y;

/** Тип, номер, дата и сумма документа по тексту (PDF/DOCX/XLSX уже превращены в текст). */
export function recognizeFromText(textRaw: string): DocFind {
  const text = textRaw.replace(/ /g, " ");
  const head = text.slice(0, 2500);
  let kind: DocKindKey | null = null;
  if (/универсальн\S*\s+передат/i.test(head) || /\bупд\b/i.test(head)) kind = "UPD";
  else if (/сч[её]т[- ]?фактур/i.test(head)) kind = "UPD";
  else if (/сч[её]т\s+на\s+оплату/i.test(head)) kind = "ADVANCE_INVOICE";
  else if (/\binvoice\b|инвойс/i.test(head)) kind = "AUCTION_INVOICE";
  else if (/сч[её]т\s*(?:№|n)/i.test(head)) kind = "AUCTION_INVOICE";
  else if (/расч[её]тн\S*\s+лист|расч[её]т\s+себестоимост|калькуляц/i.test(head)) kind = "CALC_SHEET";
  else if (/спецификаци/i.test(head)) kind = "SPECIFICATION";

  let number: string | null = null;
  let date: string | null = null;
  const reNumDate = /(?:сч[её]т(?:[- ]фактура)?(?:\s+на\s+оплату)?|универсальный\s+передаточный\s+документ|упд|invoice|инвойс|спецификация|акт)\s*(?:№|N°|No\.?|N|#)\s*([A-Za-zА-Яа-я0-9][\w\-/]*)(?:\s*(?:от|dated?|date:?)\s*([0-9]{1,2}[./][0-9]{1,2}[./][0-9]{2,4}|[0-9]{1,2}\s+[а-яё]+\s+[0-9]{4}))?/i;
  const m = reNumDate.exec(head);
  if (m) {
    number = m[1].replace(/[._-]+$/, "");
    if (m[2]) date = parseRuDate(m[2]);
  }
  if (!date) {
    const dm = /(?:от|date:?|dated)\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}\s+[а-яё]+\s+\d{4})/i.exec(head);
    if (dm) date = parseRuDate(dm[1]);
  }

  let best: { v: number; rank: number; note: string; at: number } | null = null;
  for (const lab of AMOUNT_LABELS) {
    lab.re.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = lab.re.exec(text))) {
      MONEY_AFTER.lastIndex = mm.index + mm[0].length;
      const am = MONEY_AFTER.exec(text);
      if (!am) continue;
      const v = parseMoney(am[1]);
      if (v === null || v < 100) continue;
      if (!best || lab.rank > best.rank || (lab.rank === best.rank && mm.index > best.at)) best = { v, rank: lab.rank, note: lab.note, at: mm.index };
    }
  }
  return { kind, number, date, amount: best?.v ?? null, amountNote: best?.note ?? null };
}

// ======================================================================= сверка суммы документа

export const DOC_TOLERANCE_RUB = 50;

export type ReconTotals = {
  inclVat: number;
  exclVat: number;
  currency: string;
  rate: number;
  /** Σ количество × цена в валюте закупки, без НДС. */
  foreignExcl: number;
  vatRates: number[];
  /** Часть суммы, которую выставляет аукцион (товар + сбор + НДС на сбор), ₽ — для сверки счёта аукциона. */
  auctionPart?: number | null;
};

/** Сверка суммы документа с суммой лотов. Допуск — 50 ₽; расхождение объясняется: 4%, НДС, курс, валюта. */
export function reconcileAmount(docAmount: number, t: ReconTotals, tol = DOC_TOLERANCE_RUB, kind?: DocKindKey): Recon {
  // Счёт аукциона выставляет только товар + сбор + НДС на сбор: выделка, транспорт, брокерский и НДС на товар в него не входят.
  if (kind === "AUCTION_INVOICE" && t.auctionPart != null && Math.abs(docAmount - t.auctionPart) <= tol) {
    return {
      ok: true,
      diff: Math.round((docAmount - t.auctionPart) * 100) / 100,
      message: `Сумма счёта аукциона ${rub(docAmount)} совпадает с частью лотов, которую выставляет аукцион (товар + сбор + НДС на сбор): ${rub(t.auctionPart)}. Полная себестоимость лотов ${rub(t.inclVat)} включает ещё выделку, транспорт, брокерский и НДС на товар.`,
      reasons: [],
    };
  }
  const diff = Math.round((docAmount - t.inclVat) * 100) / 100;
  if (Math.abs(diff) <= tol) {
    return { ok: true, diff, message: `Сумма документа ${rub(docAmount)} совпадает с суммой лотов ${rub(t.inclVat)}${Math.abs(diff) > 0.005 ? ` (разница ${rub(diff)} в пределах допуска ${tol} ₽)` : ""}.`, reasons: [] };
  }
  const reasons: string[] = [];
  const near = (a: number, b: number, rel = 0.0008) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * rel);
  if (near(docAmount, t.inclVat * 1.04)) reasons.push(`4%: документ больше суммы лотов на 4% (${rub(diff)}) — похоже, в нём учтена надбавка 4%. Поставщику её не платят и в закупку она не входит: 4% начисляется только при списании сырья в ТЗ.`);
  else if (near(docAmount, t.inclVat / 1.04)) reasons.push(`4%: документ меньше суммы лотов примерно на 4% (${rub(diff)}) — проверьте, не вычтена ли скидка или надбавка 4%.`);
  if (near(docAmount, t.exclVat)) reasons.push(`НДС: сумма документа ${rub(docAmount)} равна сумме лотов БЕЗ НДС — в документе, похоже, цены без НДС.`);
  else {
    const mainVat = t.vatRates.length === 1 ? t.vatRates[0] : null;
    for (const r of [0, 10, 20, 22]) {
      if (mainVat !== null && r === mainVat) continue;
      if (near(docAmount, t.exclVat * (1 + r / 100))) {
        reasons.push(`НДС: в документе, похоже, ставка ${r}%${mainVat !== null ? `, в лотах — ${mainVat}%` : ""}. Проверьте ставку НДС в таблице лотов.`);
        break;
      }
    }
  }
  if (t.currency !== "RUB") {
    if (near(docAmount, t.foreignExcl, 0.0002) || near(docAmount, t.foreignExcl * 1.22, 0.0002)) {
      reasons.push(`Валюта: сумма документа совпадает с суммой лотов в ${t.currency} (${t.foreignExcl.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}). Это документ в валюте — сравнивайте его с рублёвым счётом.`);
    } else if (t.foreignExcl > 0 && t.exclVat > 0) {
      const implied = (docAmount / t.inclVat) * t.rate;
      const dev = Math.abs(implied - t.rate) / t.rate;
      if (dev <= 0.04) reasons.push(`Курс: если разница только в курсе, то по документу курс ≈ ${implied.toFixed(4)} вместо ${t.rate} (отклонение ${(dev * 100).toFixed(2)}%). Сверьте курс на дату счёта.`);
    }
  }
  const pct = t.inclVat > 0 ? (diff / t.inclVat) * 100 : 0;
  if (reasons.length === 0) reasons.push(`Причина неясна: разница ${rub(diff)} (${formatPercent(pct)}). Проверьте количество и цены лотов, не пропущен ли лот, и ставку НДС.`);
  return {
    ok: false,
    diff,
    message: `Сумма документа ${rub(docAmount)} ${diff > 0 ? "больше" : "меньше"} суммы лотов ${rub(t.inclVat)} на ${rub(Math.abs(diff))} (допуск ${tol} ₽).`,
    reasons,
  };
}

// ======================================================================= прочее

export const DEFAULT_VAT_RATE = DEFAULT_VAT;

/** Ставка НДС на сборы аукциона и выделку: 22% с 01.01.2026, до того 20% (по дате закупки). */
export function serviceVatPctFor(orderDate: string, override?: string): number {
  if (override && override.trim() !== "") {
    const v = num(override);
    if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(orderDate) && orderDate < "2026-01-01" ? 20 : 22;
}
