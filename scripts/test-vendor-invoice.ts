// Счёт на оплату Веллмеха из расчёта: сумма прописью, НДС и тексты сверены с настоящими счетами из переписки (№103/2025, №131/141/121/2026).
import "./stubs/server-only-shim";
import ExcelJS from "exceljs";
import { PAYMENT_KINDS, buildPaymentInvoiceXlsx, defaultDescription, rubWords, ruLongDate, shortDate, suggestAmount } from "../src/lib/vendor-invoice";
import { WELLMEKH_REQ, requisitesByInn } from "../src/lib/vendor-requisites";
import { emptyPayload } from "../src/lib/supplier-calc";

let bad = 0;
const eq = (n: string, got: unknown, want: unknown) => { const ok = got === want; if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${n}: ${got}${ok ? "" : ` (ожидалось ${want})`}`); };
// прописью — тексты из присланных счетов
eq("прописью 158 600", rubWords(158600), "Сто пятьдесят восемь тысяч шестьсот рублей 00 копеек");
eq("прописью 60 271 506,34", rubWords(60271506.34), "Шестьдесят миллионов двести семьдесят одна тысяча пятьсот шесть рублей 34 копейки");
eq("прописью 11 860 870", rubWords(11860870), "Одиннадцать миллионов восемьсот шестьдесят тысяч восемьсот семьдесят рублей 00 копеек");
eq("прописью 1 695 778", rubWords(1695778), "Один миллион шестьсот девяносто пять тысяч семьсот семьдесят восемь рублей 00 копеек");
eq("даты", `${ruLongDate("2026-05-15")} | ${shortDate("2026-04-13")}`, "15 мая 2026 г. | 13.04.26г.");
eq("реквизиты по ИНН", requisitesByInn("9729114877")?.seller.kpp, "772901001");
eq("чужой ИНН — счёт не собираем", requisitesByInn("1234567890"), null);
const p = emptyPayload("SHEET");
p.rows = [{ _id: "a", fur: "соболя", size: "", lot: "1" }];
eq("основание, как в счёте №131", defaultDescription("Аванс 2", p, "10", "2026-04-13", WELLMEKH_REQ), "Аванс 2 за шкурки соболя по спецификации №10 от 13.04.26г. к Договору №2502 от 26.02.2025");
eq("виды платежей", PAYMENT_KINDS.length, 5);
eq("сумма по умолчанию пустого расчёта", suggestAmount("Аванс", p), 0);

async function run() {
  // НДС в счёте — формула, выделяемая из суммы: проверка на настоящих суммах
  for (const [amount, pct, want] of [[11860870, 22, 2138845.41], [60271506.34, 22, 10868632.29], [1695778, 20, 282629.67], [158600, 22, 28600]] as const) {
    const buf = await buildPaymentInvoiceXlsx({ kind: "Аванс", number: "141", date: "2026-05-15", specNumber: "", specDate: "", description: "Тест", amount, vatPct: pct, dueDate: "2026-05-20" }, WELLMEKH_REQ);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const v = ws.getCell("G17").value as { formula: string; result: number };
    eq(`НДС ${pct}% из ${amount}: результат`, v.result, want);
    eq(`НДС: формула в Excel`, /^ROUND\(G16\*/.test(v.formula), true);
    eq("Итого — формула", (ws.getCell("G16").value as { formula: string }).formula, "G14");
  }
  console.log(bad ? `ПРОВАЛОВ: ${bad}` : "счёт на оплату: тексты и суммы совпадают с настоящими счетами");
  process.exit(bad ? 1 : 0);
}
run();
