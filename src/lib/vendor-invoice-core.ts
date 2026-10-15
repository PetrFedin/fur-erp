/**
 * Счёт на оплату Веллмеха (аванс / окончательный платёж / доплата по спецификации к Договору купли-продажи) в Excel.
 * Вёрстка и тексты — как в счетах, которые Веллмех присылает PDF: банковский блок, «Счет на оплату № … от …», поставщик, покупатель,
 * основание, одна строка «Аванс … за шкурки … по спецификации №… от …», «В том числе НДС», сумма прописью, «Оплатить не позднее».
 * Чистая часть без Excel (выбор вида платежа, сумма по умолчанию, тексты, прописью) — работает и в браузере; сборка файла — vendor-invoice.ts.
 * Цена, сумма, НДС и итоги — формулы Excel. Сумма по умолчанию берётся из расчёта аукциона («К оплате: аванс 1»), НДС выделяется из суммы.
 * Номер счёта, дата, спецификация вводит Веллмех (это его нумерация); цен продажи и себестоимости наших изделий в документе нет.
 */
import { calcAll, rowFilled, type CalcPayload } from "@/lib/supplier-calc";
import type { VendorReq } from "@/lib/vendor-requisites";

export const PAYMENT_KINDS = ["Аванс", "Аванс 2", "Аванс 3", "Окончательный платеж", "Доплата"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export type InvoiceInput = {
  kind: PaymentKind; number: string; date: string; specNumber: string; specDate: string; description: string; amount: number; vatPct: number; dueDate: string;
};

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** «2026-05-15» → «15 мая 2026 г.» */
export function ruLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]} г.` : iso;
}
/** «2026-04-13» → «13.04.26г.» (так в основании счёта) */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}г.` : iso;
}

// ——— сумма прописью (рубли и копейки)
const ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
function triad(n: number, fem: boolean): string {
  const o = fem ? ONES_F : ONES_M;
  const parts = [HUNDS[Math.floor(n / 100)]];
  const r = n % 100;
  if (r >= 10 && r < 20) parts.push(TEENS[r - 10]);
  else parts.push(TENS[Math.floor(r / 10)], o[r % 10]);
  return parts.filter(Boolean).join(" ");
}
const plural = (n: number, f: [string, string, string]) => { const a = n % 100, b = n % 10; return a >= 11 && a <= 19 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; };
export function rubWords(sum: number): string {
  const cents = Math.round(sum * 100);
  const rubInt = Math.floor(cents / 100), kop = cents % 100;
  let rub = rubInt;
  const groups: string[] = [];
  const units: [string, string, string, boolean][] = [["", "", "", false], ["тысяча", "тысячи", "тысяч", true], ["миллион", "миллиона", "миллионов", false], ["миллиард", "миллиарда", "миллиардов", false]];
  for (let k = 0; rub > 0 && k < units.length; k++) {
    const t = rub % 1000;
    if (t) groups.unshift([triad(t, units[k][3]), k ? plural(t, [units[k][0], units[k][1], units[k][2]]) : ""].filter(Boolean).join(" "));
    rub = Math.floor(rub / 1000);
  }
  const rubText = rubInt === 0 ? "ноль" : groups.join(" ");
  const words = `${rubText} ${plural(rubInt, ["рубль", "рубля", "рублей"])} ${String(kop).padStart(2, "0")} ${plural(kop, ["копейка", "копейки", "копеек"])}`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Сумма по умолчанию для вида платежа из расчёта: «К оплате…» итог, аванс из шапки, остаток. */
export function suggestAmount(kind: PaymentKind, p: CalcPayload): number {
  const t = calcAll(p);
  const toPay = t.sheet.cols.filter((c) => /^к оплате/i.test(c.title)).map((c) => t.sheet.sums[c.id]?.v).find((v) => v != null && v > 0);
  if (kind === "Окончательный платеж" || kind === "Доплата") return Math.round((t.advance > 0 || t.interim > 0 ? t.rest : t.totalRub) * 100) / 100;
  return Math.round(((toPay ?? (t.advance > 0 ? t.advance : t.totalRub)) as number) * 100) / 100;
}
/** Названия меха из лотов расчёта: «Sable wild raw Barguzinsky, Лиса красная». */
export function furList(p: CalcPayload): string {
  return [...new Set(p.rows.filter(rowFilled).map((r) => (r.fur ?? "").trim()).filter(Boolean))].join(", ");
}
export function defaultDescription(kind: PaymentKind, p: CalcPayload, specNumber: string, specDate: string, req: VendorReq): string {
  const fur = furList(p);
  const spec = specNumber ? ` по спецификации №${specNumber}${specDate ? ` от ${shortDate(specDate)}` : ""}` : "";
  const base = kind === "Доплата" ? "Доплата за шкурки" : kind === "Окончательный платеж" ? "Окончательный платеж за шкурки" : `${kind} за шкурки`;
  return `${base}${fur ? ` ${fur}` : ""}${spec} к Договору №${req.contract.number} от ${req.contract.date}`;
}

