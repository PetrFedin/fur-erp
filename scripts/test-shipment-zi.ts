// Чистые функции накладных ЗИ: разбор артикула, сопоставление со строками отгрузки, скрытие данных от подрядчика. БД не нужна.
import { articleCode, matchZi, ziForSupplier, ziStatus, parseZi, type ZiLine } from "../src/lib/shipment-zi";
let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log("FAIL", name, JSON.stringify(a), JSON.stringify(b)); } };
eq("код", articleCode("M026/MINK WHITE"), "M026");
eq("код MH", articleCode("MH-06 MINK IRIS"), "MH-06");
eq("кириллица", articleCode("М045/MINK"), "M045");
const z = (article: string, size: string, colorRu: string, boutique = "ЦУМ"): ZiLine => ({ supply: "22М", boutique, article, size, colorRu, sum: 100, vat: 22 });
const plan = [
  { id: "a", code: "M045", size: "44", color: "Бордовый", quantity: 1 },
  { id: "b", code: "M045", size: "44", color: "Бордовый", quantity: 1 },
  { id: "c", code: "MH-06", size: "NS", color: "Серый", quantity: 2 },
  { id: "d", code: "MH-06", size: "NS", color: "Кремовый", quantity: 2 },
  { id: "e", code: "M018", size: "42", color: "Коричневый", quantity: 1 },
];
const r = matchZi([z("M045/MINK BORDEAUX", "44", "бордовый"), z("M045/MINK BORDEAUX", "44", "бордовый"), z("M045/MINK BORDEAUX", "44", "бордовый"), z("MH-06 MINK IRIS", "NS", "Серый"), z("MH-06 MINK LVD", "NS", "Кремовый")], plan);
eq("a", r.byLine.get("a")?.qty, 1); eq("b", r.byLine.get("b")?.qty, 1);
eq("лишняя без пары", r.unmatched.length, 1);
eq("серый", r.byLine.get("c")?.qty, 1); eq("кремовый", r.byLine.get("d")?.qty, 1);
eq("M018 нет", r.byLine.get("e"), undefined);
eq("статусы", [ziStatus(2, 2), ziStatus(2, 1), ziStatus(1, 0)], ["accepted", "partial", "rejected"]);
const d = parseZi({ version: 1, sourceNote: "", supplies: [], lines: [{ ...z("M026/X", "42", "белый"), sheet: "MVST", row: 5 }], files: [{ supply: "21М", fileName: "f.xls", docId: "x" }] })!;
const sup = ziForSupplier(d);
eq("подрядчик: суммы", [sup.lines[0].sum, sup.lines[0].vat, sup.lines[0].boutique], [0, 0, ""]);
eq("подрядчик: файлы и источник строк", [sup.files?.length, sup.lines[0].row], [0, undefined]);
eq("строки накладной у совпавшей", r.byLine.get("a")?.items.length, 1);
eq("мусор", parseZi({ version: 2 }), null);
console.log(fail ? `УПАЛО: ${fail}` : "Накладные ЗИ: все проверки прошли");
process.exit(fail ? 1 : 0);
