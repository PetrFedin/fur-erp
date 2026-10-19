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
// ── раскладка по площадкам (матрица) ──
import { readFileSync } from "node:fs";
import { allocFromZi, fmtDelta, lineDiff, sumDiff, validateAlloc, ziBySite, type AllocInput } from "../src/lib/shipment-alloc";
const ctx = { L1: { quantity: 5, accepted: 3, label: "M026 · р. 42" }, L2: { quantity: 1, accepted: 0, label: "M018 · р. 44" } };
const SITES = ["Барвиха", "ЦУМ"];
const V = (i: AllocInput) => validateAlloc({ sites: SITES, ...i }, ctx, "т", "2026-10-19T00:00:00Z");
const ok = (i: AllocInput) => !("error" in V(i));
eq("матрица ок", ok({ cells: { L1: { Барвиха: 2, ЦУМ: "1" } }, sums: { Барвиха: "100,5" } }), true);
eq("пусто = 0", ok({ cells: { L1: { Барвиха: "" } } }), true);
eq("Σ больше принятого", ok({ cells: { L1: { Барвиха: 2, ЦУМ: 2 } } }), false);
eq("не принято входит в Σ", ok({ cells: { L1: { ЦУМ: 3 } }, rej: { L1: [{ size: "44", qty: 1, reason: "брак" }] } }), false);
eq("принято 0 — ничего не разложить", ok({ cells: { L2: { ЦУМ: 1 } } }), false);
eq("отриц. количество", ok({ cells: { L1: { ЦУМ: -1 } } }), false);
eq("дробное количество", ok({ cells: { L1: { ЦУМ: "1.5" } } }), false);
eq("чужая площадка", ok({ cells: { L1: { Тверская: 1 } } }), false);
eq("чужая строка", ok({ cells: { X: { ЦУМ: 1 } } }), false);
eq("дубль столбца", validateAlloc({ sites: ["ЦУМ", "цум"] }, ctx, "т", "t") && "error" in validateAlloc({ sites: ["ЦУМ", "цум"] }, ctx, "т", "t"), true);
eq("пустое имя столбца", "error" in validateAlloc({ sites: ["  "] }, ctx, "т", "t"), true);
eq("лимит столбцов", "error" in validateAlloc({ sites: Array.from({ length: 13 }, (_, i) => "П" + i) }, ctx, "т", "t"), true);
eq("отриц. сумма", ok({ sums: { ЦУМ: -5 } }), false);
eq("не число в сумме", ok({ sums: { ЦУМ: "abc" } }), false);
eq("сумма по чужой площадке", ok({ sums: { Тверская: 5 } }), false);
eq("не принято без причины", ok({ rej: { L1: [{ size: "44", qty: 1, reason: "" }] } }), false);
eq("не принято без размера", ok({ rej: { L1: [{ size: "", qty: 1, reason: "x" }] } }), false);
eq("не принято ок", ok({ cells: { L1: { ЦУМ: 2 } }, rej: { L1: [{ size: "44", qty: 1, reason: "брак" }] } }), true);
const x = V({ cells: { L1: { ЦУМ: 1 } }, rej: { L1: [{ id: "bad id!", site: "<b>x</b>\u0000", size: "44", qty: 1, reason: "r" }] } });
eq("управляющие символы убраны, id перевыпущен", "state" in x && !x.state.lines.L1.rej[0].site.includes("\u0000") && /^[A-Za-z0-9_-]+$/.test(x.state.lines.L1.rej[0].id), true);
const sites = ziBySite([z("M026/X", "42", "белый", "Барвиха"), z("M026/X", "42", "белый", "Барвиха"), z("M026/X", "42", "белый", "ЦУМ")]);
eq("разбивка накладных по площадкам", sites.map((s) => [s.site, s.qty, s.sum]), [["Барвиха", 2, 244], ["ЦУМ", 1, 122]]);
const f = allocFromZi({ L1: { sites, accepted: 3, label: "L1" } }, ["Барвиха", "ЦУМ"], "т", "t");
eq("как в накладных", "state" in f && [f.state.lines.L1.cells.Барвиха, f.state.sums.Барвиха], [2, 244]);
eq("как в накладных: не помещается", "error" in allocFromZi({ L1: { sites, accepted: 2, label: "L1" } }, [], "т", "t"), true);
eq("остаток: сходится", lineDiff(1, 1).ok, true);
eq("остаток: недораспределено", [lineDiff(3, 1).ok, fmtDelta(lineDiff(3, 1).delta)], [false, "+2"]);
eq("остаток: перераспределено", fmtDelta(lineDiff(1, 2).delta), "−1");
eq("суммы: допуск 1 ₽", [sumDiff(100, 100.9).ok, sumDiff(100, 102).ok], [true, false]);
// права: действия раскладки закрыты для подрядчика, «открыть заново» — только владелец/администратор
const act = readFileSync("src/app/(app)/shipments/alloc-actions.ts", "utf8");
eq("раскладка: роли без SUPPLIER", /const ROLES = \["OWNER", "ADMIN", "TECHNOLOGIST"\] as const;/.test(act) && !/SUPPLIER/.test(act), true);
eq("все действия раскладки через ctxOf/requireRole", (act.match(/export async function/g) ?? []).length === (act.match(/await ctxOf\(/g) ?? []).length, true);
const pg = readFileSync("src/app/(app)/shipments/[id]/page.tsx", "utf8");
eq("матрица строится только для нашей стороны", /if \(ziRaw && !isSupplier && ZI_STAFF_ROLES\.includes\(session\.user\.role\)\) \{\s+const mm/.test(pg), true);
const shipAct = readFileSync("src/app/(app)/shipments/actions.ts", "utf8");
eq("открыть заново: только OWNER/ADMIN", /export async function cancelAcceptance[\s\S]{0,200}requireRole\("OWNER", "ADMIN"\)/.test(shipAct), true);
console.log(fail ? `УПАЛО: ${fail}` : "Накладные ЗИ: все проверки прошли");
process.exit(fail ? 1 : 0);
