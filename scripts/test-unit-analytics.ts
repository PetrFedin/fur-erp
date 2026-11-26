// Аналитика: чистые функции показателей, ключей артикула/ТЗ, плана размеров и сверки сезонов продаж (без базы). node --conditions=react-server node_modules/.bin/tsx scripts/test-unit-analytics.ts
import { articleMetrics, rateOf } from "../src/lib/article-metrics";
import { BASIC_COLS, COL_KEYS, computeMetrics, derived, parseCols, parseSort, ratio, sortItems, type Metrics } from "../src/lib/analytics-metrics";
import { compareSizeLabels, cleanSize, parseCellQty, parsePastedPlan, rowTotal } from "../src/lib/plan-sizes";
import { articleBase, articleKey, candidatesFromList, parseAliases, resolveFromList, salesLabel, searchArticleList, spellingsOf, type ArticleLite } from "../src/lib/article-key";
import { articlesWord, groupByTz, itemsSuffix, orderKey, positionsWord, tzCountText, tzLabel, tzNumber, uniqueLabelCount, uniqueOrderCount } from "../src/lib/tz-key";
import { reconcileSeasonsWithReport } from "../src/lib/sales-reconcile";
import type { DrillLine, DrillOrder } from "../src/lib/dashboard-drill";
import type { OrderRow } from "../src/lib/analytics-orders";

let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what} ${extra}`); } };
const near = (what: string, a: number | null | undefined, b: number, tol = 1e-6) => ok(what, a != null && Math.abs(a - b) <= tol, `(${a} ≠ ${b})`);
const eq = (what: string, a: unknown, b: unknown) => ok(what, JSON.stringify(a) === JSON.stringify(b), `(${JSON.stringify(a)} ≠ ${JSON.stringify(b)})`);

// ───────────────────────────── tz-key ─────────────────────────────
ok("tzNumber: номер из документа с обрезкой пробелов", tzNumber({ number: "П-1", wo: " 12 " }) === "12");
ok("tzNumber: пустой/пробельный/null — null", tzNumber({ number: "П-1", wo: "" }) === null && tzNumber({ number: "П-1", wo: "   " }) === null && tzNumber({ number: "П-1", wo: null }) === null);
ok("tzNumber: без wo берётся workOrderNumber", tzNumber({ number: "П-1", workOrderNumber: "7" }) === "7");
ok("tzNumber: wo=null важнее workOrderNumber (поле задано)", tzNumber({ number: "П-1", wo: null, workOrderNumber: "7" }) === null);
ok("orderKey: tz:/sys:", orderKey({ number: "П-1", wo: "12" }) === "tz:12" && orderKey({ number: "П-1", wo: null }) === "sys:П-1");
ok("orderKey: номер ТЗ «1» и системный «1» не сливаются", orderKey({ number: "1", wo: null }) !== orderKey({ number: "X", wo: "1" }));
ok("tzLabel: номер ТЗ или системный", tzLabel({ number: "П-1", wo: "12" }) === "12" && tzLabel({ number: "П-1", wo: " " }) === "П-1");
// [1, " 1"] → один ТЗ «1»; две записи без номера → два отдельных ТЗ; системный «1» — ещё одно. Итого 4.
ok("uniqueOrderCount", uniqueOrderCount([{ number: "a", wo: "1" }, { number: "b", wo: " 1" }, { number: "c", wo: null }, { number: "d", wo: null }, { number: "1", wo: null }]) === 4);
ok("uniqueOrderCount: пусто — 0", uniqueOrderCount([]) === 0);
ok("uniqueLabelCount: 5,5,без подписи → 2", uniqueLabelCount([{ id: "a", label: "5" }, { id: "b", label: "5" }, { id: "c" }]) === 2);
{
  const g = groupByTz([{ number: "a", wo: "2" }, { number: "b", wo: "1" }, { number: "c", wo: "2" }, { number: "d", wo: null }]);
  eq("groupByTz: порядок по первому появлению", [...g.keys()], ["tz:2", "tz:1", "sys:d"]);
  eq("groupByTz: записи одного ТЗ вместе", g.get("tz:2")!.map((x) => x.number), ["a", "c"]);
}
ok("склонение: 1/2/5", positionsWord(1) === "позиция" && positionsWord(2) === "позиции" && positionsWord(5) === "позиций");
ok("склонение: 11–14 — «позиций»", positionsWord(11) === "позиций" && positionsWord(12) === "позиций" && positionsWord(14) === "позиций");
ok("склонение: 21/22/0/101/111", positionsWord(21) === "позиция" && positionsWord(22) === "позиции" && positionsWord(0) === "позиций" && positionsWord(101) === "позиция" && positionsWord(111) === "позиций");
ok("склонение артикулов", articlesWord(1) === "артикул" && articlesWord(3) === "артикула" && articlesWord(25) === "артикулов");
ok("itemsSuffix: позиций больше — показываем", itemsSuffix(168, 183) === " · 183 позиции");
ok("itemsSuffix: столько же — пусто", itemsSuffix(5, 5) === "");
ok("tzCountText", tzCountText(168, 183) === "168 ТЗ · 183 позиции" && tzCountText(1, 1) === "1 ТЗ");

// ───────────────────────────── article-key ─────────────────────────────
ok("articleKey: кириллица М = латиница M", articleKey("М012") === articleKey("M012") && articleKey("M012") === "m012");
ok("articleKey: кириллица МН-02 = MH-02", articleKey("МН-02") === "mh02" && articleKey("MH-02") === "mh02");
ok("articleKey: регистр, пробелы, дефисы, слэши", articleKey(" m-0/12 ") === "m012" && articleKey("M 0 1 2") === "m012");
ok("articleKey: null/undefined/пусто", articleKey(null) === "" && articleKey(undefined) === "" && articleKey(" - / ") === "");
ok("articleBase: до слэша", articleBase("M012/MINK BGL") === "M012");
ok("articleBase: до пробела", articleBase("MH-02 MINK BGL") === "MH-02");
ok("articleBase: края обрезаны, пусто/null", articleBase("  M012  ") === "M012" && articleBase("") === "" && articleBase(null) === "");
ok("articleBase: слэш в начале — не разделитель", articleBase("/abc def") === "/abc");

const art = (p: Partial<ArticleLite> & { id: string; name: string }): ArticleLite => ({ sku: null, category: null, salesCode: null, salesName: null, aliases: [], isActive: true, ...p });
const A1 = art({ id: "1", name: "M012", sku: "SKU-1", category: "Пальто норка", salesCode: "MH-02", salesName: "Mink coat", aliases: ["Старый 12"] });
const A2 = art({ id: "2", name: "M0123", category: "Жилет" });
{
  const sp = spellingsOf(art({ id: "x", name: "M012", sku: " ", salesCode: "MH-02", aliases: ["  ", "М-012"] }));
  eq("spellingsOf: пустые отброшены, ключи нормализованы", sp.map((s) => `${s.kind}:${s.key}`), ["name:m012", "sales:mh02", "alias:m012"]);
  ok("spellingsOf: текст обрезан", sp[2].text === "М-012");
}
{
  const h = searchArticleList([A2, A1], "м012");
  ok("поиск: точное по коду (кириллица в запросе) — 100, начало — 70", h.length === 2 && h[0].article.id === "1" && h[0].score === 100 && h[1].article.id === "2" && h[1].score === 70);
  ok("поиск: найдено через «наш код»", h[0].via?.kind === "name");
  // точное по коду продаж: 100 − ранг(sales=2)×5 = 90
  const s = searchArticleList([A1, A2], "mh 02");
  ok("поиск: точное по коду продаж = 90", s.length === 1 && s[0].score === 90 && s[0].via?.kind === "sales");
  // подстрока: 50 − 0×3 = 50 у обоих; при равенстве — по названию (числа по значению: 012 < 0123)
  const c = searchArticleList([A2, A1], "012");
  ok("поиск: подстрока 50, равенство — по названию", c.length === 2 && c[0].score === 50 && c[1].score === 50 && c[0].article.id === "1");
  const t = searchArticleList([A1, A2], "норка");
  ok("поиск: по описанию — 20", t.length === 1 && t[0].article.id === "1" && t[0].score === 20 && t[0].via === null);
  ok("поиск: пустой запрос — ничего", searchArticleList([A1], "").length === 0 && searchArticleList([A1], "   ").length === 0);
  ok("поиск: limit", searchArticleList([A1, A2], "m0", 1).length === 1);
  const inactive = art({ id: "3", name: "M012", isActive: false });
  const ia = searchArticleList([inactive, A1], "M012");
  ok("поиск: неактивный при равенстве ниже (−1)", ia[0].article.id === "1" && ia[1].article.id === "3" && ia[1].score === 99);
  ok("поиск: одна буква — только начало, не подстрока", searchArticleList([art({ id: "z", name: "XM1" })], "m").length === 0);
}
ok("resolve: точный код", resolveFromList([A1, A2], "M012")?.id === "1");
ok("resolve: кириллица и дефис", resolveFromList([A1, A2], "М-012")?.id === "1");
ok("resolve: с тканью/цветом — по коду до слэша", resolveFromList([A1, A2], "M012/MINK BGL")?.id === "1");
ok("resolve: с тканью через пробел", resolveFromList([A1, A2], "MH-02 MINK BGL")?.id === "1");
ok("resolve: нет точного — null (префикс не годится)", resolveFromList([A1, A2], "M01") === null);
{
  const A4 = art({ id: "4", name: "M099", aliases: ["MH-02"] });
  ok("resolve: код продаж (ранг 2) важнее alias (ранг 3)", resolveFromList([A4, A1], "MH-02")?.id === "1");
  const A5 = art({ id: "5", name: "M100", aliases: ["OLD"] }), A6 = art({ id: "6", name: "M101", aliases: ["old"] });
  ok("resolve: одинаковый alias у двух — неоднозначно, null", resolveFromList([A5, A6], "Old") === null && candidatesFromList([A5, A6], "Old").length === 2);
  ok("candidates: пусто — []", candidatesFromList([A1], "").length === 0);
}
ok("salesLabel", salesLabel(A1) === "MH-02 — Mink coat" && salesLabel(art({ id: "y", name: "y", salesName: "  " })) === "" && salesLabel(art({ id: "y", name: "y", salesName: "Coat" })) === "Coat");
eq("parseAliases: разделители, пробелы, дубли без учёта регистра", parseAliases("a, b;A\n  c   d ,, "), ["a", "b", "c d"]);
ok("parseAliases: null и слишком длинные", parseAliases(null).length === 0 && parseAliases("x".repeat(121) + ",ok").join() === "ok");

// ───────────────────────────── plan-sizes ─────────────────────────────
ok("cleanSize: пробелы, регистр", cleanSize(" x l ") === "XL" && cleanSize(null) === "" && cleanSize(42) === "42");
ok("cleanSize: максимум 12 знаков", cleanSize("ABCDEFGHIJKLMN") === "ABCDEFGHIJKL");
eq("compareSizeLabels: буквы, затем числа, затем прочее", ["50", "M", "XS", "abc", "38", "XXL", "40,5", "XXS"].sort(compareSizeLabels), ["XXS", "XS", "M", "XXL", "38", "40,5", "50", "abc"]);
ok("compareSizeLabels: числа по значению, не по строке", compareSizeLabels("9", "10") < 0 && compareSizeLabels("XL", "L") > 0 && compareSizeLabels("M", "M") === 0);
ok("rowTotal: 1+2, NaN не считается", rowTotal({ XS: 1, M: 2, L: NaN }) === 3 && rowTotal({}) === 0);
ok("parseCellQty: пусто — null", parseCellQty("") === null && parseCellQty("   ") === null);
ok("parseCellQty: пробелы внутри (и неразрывный)", parseCellQty(" 1 2 ") === 12 && parseCellQty("1 0") === 10);
ok("parseCellQty: дробь/минус/буквы — NaN", Number.isNaN(parseCellQty("1.5")!) && Number.isNaN(parseCellQty("-1")!) && Number.isNaN(parseCellQty("abc")!));
ok("parseCellQty: предел 1 000 000", parseCellQty("1000000") === 1_000_000 && Number.isNaN(parseCellQty("1000001")!));
{
  const p = parsePastedPlan("Артикул\tЦвет\tXS\tS\tM\r\nM012\tчёрный\t1\t\t2\nM013\t\t0\t0\t0\n\tкрасный\t1\t1\t1\nM014\t\tx\t1\t1\n\n");
  eq("вставка (Excel): размеры", p.sizes, ["XS", "S", "M"]);
  ok("вставка: одна годная строка", p.rows.length === 1 && p.rows[0].articleCode === "M012" && p.rows[0].color === "чёрный" && p.rows[0].articleName === undefined);
  eq("вставка: пустая ячейка не попадает в размеры", p.rows[0].sizes, { XS: 1, M: 2 });
  ok("вставка: 3 ошибки (нули, без артикула, мусор)", p.errors.length === 3, JSON.stringify(p.errors));
  ok("вставка: номера строк считаются с заголовка", p.errors[0].startsWith("Строка 3 (M013)") && p.errors[1].startsWith("Строка 4:") && p.errors[2].startsWith("Строка 5, размер XS"));
}
{
  const p = parsePastedPlan("код;S;M;итого\nA1;1;2;3");
  ok("вставка (CSV ;): «итого» не размер", p.sizes.join() === "S,M" && rowTotal(p.rows[0].sizes) === 3 && p.errors.length === 0);
  const q = parsePastedPlan('"Артикул","S"\n"M1","3"');
  ok("вставка (CSV ,): кавычки сняты", q.rows.length === 1 && q.rows[0].articleCode === "M1" && q.rows[0].sizes.S === 3);
  const d = parsePastedPlan("Артикул\tS\ts\nM1\t1\t2");
  ok("вставка: одинаковые размеры суммируются", d.sizes.join() === "S" && d.rows[0].sizes.S === 3);
  const n = parsePastedPlan("M012,1,2,3");
  ok("вставка без заголовка: артикул + XS,S,M", n.sizes.join() === "XS,S,M" && n.rows.length === 1 && JSON.stringify(n.rows[0].sizes) === JSON.stringify({ XS: 1, S: 2, M: 3 }));
  const h = parsePastedPlan("Изделие\t42\t44\nM1\t1\t0");
  ok("вставка: числовые размеры, первый столбец — артикул", h.sizes.join() === "42,44" && h.rows[0].articleCode === "M1" && JSON.stringify(h.rows[0].sizes) === JSON.stringify({ "42": 1, "44": 0 }));
  ok("вставка: пусто — ошибка", parsePastedPlan("  \n ").errors.length === 1 && parsePastedPlan("").rows.length === 0);
  ok("вставка: нет столбцов размеров — ошибка", parsePastedPlan("Артикул\tЦвет\nM1\tred").errors[0] === "Не найдены столбцы размеров в заголовке.");
}

// ───────────────────────────── article-metrics ─────────────────────────────
ok("rateOf: 20/10/22/0", rateOf(12000, 10000) === 20 && rateOf(1100, 1000) === 10 && rateOf(1220, 1000) === 22 && rateOf(1000, 1000) === 0);
ok("rateOf: почти стандартная → целое (20,1 → 20)", rateOf(1201, 1000) === 20);
ok("rateOf: нестандартная → до десятых (10,5)", rateOf(1105, 1000) === 10.5);
ok("rateOf: нули, минус, NaN — null", rateOf(0, 0) === null && rateOf(100, 0) === null && rateOf(-5, 10) === null && rateOf(NaN, 1) === null);

const ln = (p: Partial<DrillLine> & Pick<DrillLine, "k" | "q" | "i" | "e" | "ci" | "ce">): DrillLine => ({ n: "", fu: "", lot: "L", ln: null, au: "", pid: null, pn: null, ...p });
const ord = (p: Partial<DrillOrder> & { id: string }): DrillOrder => ({ number: p.id, wo: null, bk: "none", bl: "", y: 2026, st: "COMPLETED", cat: "Пальто", grp: "Одежда", mid: "m", ml: "M", fur: "", qty: 0, work: 0, exp: 0, hI: 0, hE: 0, resI: 0, resE: 0, lines: [], ...p });
{
  // A и B — одно ТЗ «T1» (два артикула), D — без номера ТЗ, R — ремонт (не считается).
  const A = ord({ id: "P1", wo: "T1", qty: 2, work: 1000, fur: "Норка", lines: [
    ln({ k: "f", fu: "Норка", q: 10, i: 12000, e: 10000, ci: 400, ce: 333 }),
    ln({ k: "l", q: 3, i: 2200, e: 2000, ci: 100, ce: 90 }),
  ] });
  const B = ord({ id: "P2", wo: "T1", qty: 1, work: 500, exp: 300, fur: "Норка + Соболь", lines: [ln({ k: "f", fu: "Соболь", q: 4, i: 6000, e: 5000, ci: 200, ce: 150 })] });
  const D = ord({ id: "P4", qty: 0, fur: "Бобр" });
  const R = ord({ id: "P9", cat: "Ремонт", qty: 5, work: 999, lines: [ln({ k: "f", fu: "Норка", q: 100, i: 99999, e: 88888, ci: 1, ce: 1 })] });
  const m = articleMetrics([A, B, D, R]);
  ok("артикул: 2 ТЗ (T1 и P4), 3 позиции, ремонт исключён", m.orders === 2 && m.items === 3);
  ok("артикул: штук 2+1+0 = 3", m.qty === 3);
  // мех: 10+4 = 14 шкур; с 4%: 12000+6000 = 18000 / 10000+5000 = 15000; без 4%: 18000−600 = 17400 / 15000−483 = 14517
  ok("мех: шкуры и суммы с 4%", m.fur.qty === 14 && m.fur.on.incl === 18000 && m.fur.on.excl === 15000);
  ok("мех: без 4%", m.fur.off.incl === 17400 && m.fur.off.excl === 14517);
  // подкладка: 3 м, 2200/2000, без 4%: 2100/1910
  ok("подкладка", m.lining.qty === 3 && m.lining.on.incl === 2200 && m.lining.on.excl === 2000 && m.lining.off.incl === 2100 && m.lining.off.excl === 1910);
  ok("работа 1000+500, добавка 4% = 400+100+200", m.work === 1500 && m.extra4 === 700);
  // итого с НДС: 12000+2200+6000 (строки, с 4%) + 300 (расходы) + 1500 (работа) = 22000; без НДС: 10000+2000+5000+300+1500 = 18800
  ok("итого с 4%", m.total.on.incl === 22000 && m.total.on.excl === 18800);
  // без 4%: 22000−700 = 21300; 18800−(333+90+150) = 18227
  ok("итого без 4%", m.total.off.incl === 21300 && m.total.off.excl === 18227);
  near("на 1 изделие = итого ÷ 3", m.unit?.on.incl, 22000 / 3);
  near("на 1 изделие без 4% и без НДС", m.unit?.off.excl, 18227 / 3);
  eq("виды меха по сумме, Бобр из ТЗ без списаний", m.furKinds.map((k) => `${k.fur}:${k.qty}:${k.on.incl}`), ["Норка:10:12000", "Соболь:4:6000", "Бобр:0:0"]);
  ok("основной мех — Норка", m.primaryFur === "Норка" && m.furNames.join() === "Норка,Соболь,Бобр");
  ok("Σ видов меха = мех итого", m.furKinds.reduce((s, k) => s + k.qty, 0) === m.fur.qty && m.furKinds.reduce((s, k) => s + k.on.incl, 0) === m.fur.on.incl && m.furKinds.reduce((s, k) => s + k.off.excl, 0) === m.fur.off.excl);
  // НДС: 10% — подкладка 2200 (НДС 200); 20% — мех 12000+6000 = 18000 (НДС 3000)
  eq("строки НДС по ставкам", m.vatRows, [{ rate: 10, incl: 2200, vat: 200 }, { rate: 20, incl: 18000, vat: 3000 }]);
  ok("ставки списком", m.vatRates.join() === "10,20");
  ok("Σ строк НДС = мех + подкладка", m.vatRows.reduce((s, v) => s + v.incl, 0) === m.fur.on.incl + m.lining.on.incl);
  const nm = articleMetrics([ord({ id: "Q", qty: 1, lines: [ln({ k: "f", n: "Лиса", q: 1, i: 1, e: 1, ci: 0, ce: 0 }), ln({ k: "f", q: 1, i: 1, e: 1, ci: 0, ce: 0 })] })]);
  ok("вид меха: без fu — по названию, иначе «Мех»", nm.furNames.join() === "Лиса,Мех");
}
{
  const e = articleMetrics([]);
  ok("пусто: нули, на изделие — null", e.orders === 0 && e.items === 0 && e.qty === 0 && e.unit === null && e.primaryFur === null && e.total.on.incl === 0 && e.vatRows.length === 0);
  const r = articleMetrics([ord({ id: "R", cat: "Ремонт", qty: 3, work: 50 })]);
  ok("только ремонт — как пусто", r.items === 0 && r.qty === 0 && r.work === 0 && r.unit === null);
  const z = articleMetrics([ord({ id: "Z", qty: 0, work: 100 })]);
  ok("0 штук — деление на ноль не делается", z.unit === null && z.total.on.incl === 100);
}

// ───────────────────────────── analytics-metrics ─────────────────────────────
type LineIn = { isLining: boolean; lotId: string; hammerExcl: number | null };
const row = (p: Partial<Omit<OrderRow, "lines">> & { number: string; lines?: LineIn[] }): OrderRow =>
  ({ workOrderNumber: null, qty: 0, costIncl: 0, costExcl: 0, work: 0, furQty: 0, liningQty: 0, furIncl: 0, furExcl: 0, c4FurIncl: 0, c4FurExcl: 0, liningIncl: 0, c4Incl: 0, expenses: 0, hammerIncl: 0, hammerExcl: 0, hammerSkins: 0, lines: [], ...p }) as unknown as OrderRow;
{
  // R1: себестоимость 1000 = мех 700 + подкладка 200 + 4% 36 + расходы 64; R2: 600 = 500 + 0 + 20 + 80; R3 — без себестоимости; R4 — 300 расходов, 0 штук.
  const R1 = row({ number: "P1", workOrderNumber: "A", qty: 2, costIncl: 1000, costExcl: 800, work: 200, furQty: 6, liningQty: 3, furIncl: 700, furExcl: 560, c4FurIncl: 28, c4FurExcl: 22, liningIncl: 200, c4Incl: 36, expenses: 64, hammerIncl: 360, hammerExcl: 300, hammerSkins: 4,
    lines: [{ isLining: false, lotId: "L1", hammerExcl: 50 }, { isLining: false, lotId: "L2", hammerExcl: null }, { isLining: true, lotId: "LIN1", hammerExcl: 9 }] });
  const R2 = row({ number: "P2", workOrderNumber: "A", qty: 1, costIncl: 600, costExcl: 500, furQty: 2, furIncl: 500, furExcl: 420, c4FurIncl: 20, c4FurExcl: 16, c4Incl: 20, expenses: 80, lines: [{ isLining: false, lotId: "L1", hammerExcl: 50 }] });
  const R3 = row({ number: "P3", qty: 4, work: 100, liningQty: 2, lines: [{ isLining: true, lotId: "LIN2", hammerExcl: null }] });
  const R4 = row({ number: "P4", workOrderNumber: "  ", costIncl: 300, costExcl: 250, expenses: 300 });
  const m = computeMetrics([R1, R2, R3, R4]);
  ok("показатели: ТЗ A, P3, P4 = 3; позиций 4; единиц 2+1+4+0 = 7", m.orders === 3 && m.items === 4 && m.units === 7);
  ok("себестоимость по ТЗ с известной: единиц 3, 1000+600+300 / 800+500+250", m.unitsCosted === 3 && m.costIncl === 1900 && m.costExcl === 1550);
  // на единицу: R1 1000/2 = 500 (800/2 = 400), R2 600 (500); R4 без штук в разброс не входит
  ok("разброс себестоимости единицы", m.minCostIncl === 500 && m.maxCostIncl === 600 && m.minCostExcl === 400 && m.maxCostExcl === 500);
  // полная: (1000+200)+(600+0)+(300+0) = 2100; без НДС 1000+500+250 = 1750
  ok("полная себестоимость", m.fullIncl === 2100 && m.fullExcl === 1750);
  // с работой на ед.: R1 1200/2 = 600 и (800+200)/2 = 500; R2 600 и 500
  ok("разброс полной", m.minFullIncl === 600 && m.maxFullIncl === 600 && m.minFullExcl === 500 && m.maxFullExcl === 500);
  ok("работа: 200+100 на 2+4 ед.", m.work === 300 && m.unitsWork === 6);
  // мех: шкуры 6+2, единиц 2+1; стоимость с надбавкой (700+28)+(500+20) = 1248; (560+22)+(420+16) = 1018
  ok("шкуры и мех", m.skins === 8 && m.unitsSkins === 3 && m.furIncl === 1248 && m.furExcl === 1018);
  ok("подкладка: 3+2 м на 2+4 ед.", m.liningM === 5 && m.unitsLin === 6);
  ok("лоты меха: L1, L2 (подкладка не считается); с молотком — L1", m.lots === 2 && m.lotsHammer === 1);
  ok("структура: мех 1200, подкладка 200, 4% 56, расходы 444, работа 200", m.sFur === 1200 && m.sLining === 200 && m.sC4 === 56 && m.sExpenses === 444 && m.sWork === 200);
  ok("Σ структуры = полная себестоимость (с НДС)", m.sFur + m.sLining + m.sC4 + m.sExpenses + m.sWork === m.fullIncl);
  const d = derived(m);
  near("шкур на ед. 8/3", d.skinsPerUnit, 8 / 3);
  near("подкладка на ед. 5/6", d.liningPerUnit, 5 / 6);
  ok("мех за ед. 1248/3 = 416", d.furPerUnit?.incl === 416);
  ok("мех за шкуру 1248/8 = 156, 1018/8 = 127,25", d.furPerSkin?.incl === 156 && d.furPerSkin?.excl === 127.25);
  ok("молоток за шкуру 360/4 = 90, 300/4 = 75", d.hammerPerSkin?.incl === 90 && d.hammerPerSkin?.excl === 75);
  ok("доли молотка: шкур 4/8, лотов 1/2", d.hammerSkinShare === 0.5 && d.hammerLotShare === 0.5);
  ok("работа на ед. 300/6 = 50", d.workPerUnit === 50);
  near("себестоимость на ед. 1900/3", d.costPerUnit?.incl, 1900 / 3);
  ok("полная на ед. 2100/3 = 700", d.fullPerUnit?.incl === 700);
  near("доли структуры в сумме = 1", (d.shFur ?? 0) + (d.shLining ?? 0) + (d.shC4 ?? 0) + (d.shWork ?? 0) + (d.shExpenses ?? 0), 1);
  near("доля меха 1200/2100", d.shFur, 1200 / 2100);
  ok("полная ≥ сырьё на ед. (работа ≥ 0)", d.fullPerUnit!.incl >= d.costPerUnit!.incl);
}
{
  const e = computeMetrics([]);
  ok("пусто: нули и null в разбросе", e.orders === 0 && e.units === 0 && e.costIncl === 0 && e.minCostIncl === null && e.maxFullExcl === null && e.lots === 0);
  const d = derived(e);
  ok("пусто: все средние — null (нет деления на ноль)", Object.values(d).every((v) => v === null));
}
ok("ratio: знаменатель 0/минус — null, 0/5 = 0", ratio(1, 0) === null && ratio(1, -1) === null && ratio(0, 5) === 0 && ratio(6, 4) === 1.5);
ok("колонки: 16 всего, 9 обычных", COL_KEYS.length === 16 && BASIC_COLS.length === 9 && BASIC_COLS.every((k) => COL_KEYS.includes(k)));
ok("parseCols: пусто — обычный набор / все", parseCols([], false).join() === BASIC_COLS.join() && parseCols([], true).join() === COL_KEYS.join());
eq("parseCols: список через запятую, мусор отброшен, порядок колонок", parseCols(["work,orders", "bogus", " units "], false), ["orders", "units", "work"]);
ok("parseCols: только мусор — по умолчанию", parseCols(["bogus"], true).join() === COL_KEYS.join());
eq("parseSort: label/колонка/мусор", [parseSort("label", "x"), parseSort("units", "asc"), parseSort("bogus", "asc")], [{ sort: "label", dir: "desc" }, { sort: "units", dir: "asc" }, { sort: "", dir: "asc" }]);
{
  const base = computeMetrics([]);
  const mk = (p: Partial<Metrics>): Metrics => ({ ...base, ...p });
  const items = [
    { label: "ТЗ 10", m: mk({ units: 5, costIncl: 0 }) },
    { label: "ТЗ 9", m: mk({ units: 5, costIncl: 100 }) },
    { label: "ТЗ 2", m: mk({ units: 8, costIncl: 50 }) },
  ];
  const total = mk({ units: 18 });
  ok("sortItems: без сортировки — тот же массив", sortItems(items, "", "desc", total) === items);
  eq("sortItems: по названию, числа по значению", sortItems(items, "label", "asc", total).map((x) => x.label), ["ТЗ 2", "ТЗ 9", "ТЗ 10"]);
  eq("sortItems: единицы по убыванию, равные — по названию", sortItems(items, "units", "desc", total).map((x) => x.label), ["ТЗ 2", "ТЗ 9", "ТЗ 10"]);
  eq("sortItems: пустая себестоимость в конце (по возрастанию)", sortItems(items, "costSum", "asc", total).map((x) => x.label), ["ТЗ 2", "ТЗ 9", "ТЗ 10"]);
  eq("sortItems: пустая себестоимость в конце (по убыванию)", sortItems(items, "costSum", "desc", total).map((x) => x.label), ["ТЗ 9", "ТЗ 2", "ТЗ 10"]);
  eq("sortItems: доля = единицы ÷ итог", sortItems(items, "share", "asc", total).map((x) => x.label), ["ТЗ 9", "ТЗ 10", "ТЗ 2"]);
  ok("sortItems: исходный массив не меняется", items[0].label === "ТЗ 10");
}

// ───────────────────────────── sales-reconcile ─────────────────────────────
type Ln = { id?: string; kind: string; iso: string; season: string; article: string; colorId: string | null; pcs: number; retailRub: number; retailRubExVat: number; discountRub: number; discountRubExVat: number; retailEur: number; retailEurExVat: number; discountEur: number; discountEurExVat: number };
const sale = (id: string, iso: string, pcs: number, rub: number, season = "FW 25/26", kind = "SALE"): Ln =>
  ({ id, kind, iso, season, article: "MH-03 SABLE", colorId: "blk", pcs, retailRub: rub, retailRubExVat: rub / 1.2, discountRub: 0, discountRubExVat: 0, retailEur: rub / 100, retailEurExVat: 0, discountEur: 0, discountEurExVat: 0 });
const pcsBy = (ls: Ln[], season: string) => ls.filter((l) => l.season === season).reduce((s, l) => s + l.pcs, 0);
const rubAll = (ls: Ln[]) => ls.reduce((s, l) => s + l.retailRub, 0);
{
  const ls = [sale("a", "2026-03-01", 1, 100)];
  ok("сверка: нет отчёта — тот же массив", reconcileSeasonsWithReport(ls, []) === ls);
  const same = [sale("a", "2026-03-01", 2, 100, "SS 2026")];
  ok("сверка: сезон уже совпадает — тот же массив", reconcileSeasonsWithReport(same, [{ acode: "MH-03/SABLE", color: "BLK", seas: { SS26: { soldSsn: 2, rubSsn: 100 } } }]) === same);
}
{
  // Отчёт: SS26 — 2 шт. своего товара на 300 ₽. Продажи весной 2026 по 1 шт.: 100, 200, 150 ₽ (все «старые» FW 25/26).
  // Подборка 2 шт. ближе всего к 300 ₽: 100+200 = 300 (а не 100+150 = 250 или 200+150 = 350).
  const ls = [sale("a", "2026-03-01", 1, 100), sale("b", "2026-04-01", 1, 200), sale("c", "2026-05-01", 1, 150)];
  const out = reconcileSeasonsWithReport(ls, [{ acode: "MH-03/SABLE", color: "BLK", seas: { SS26: { soldSsn: 2, rubSsn: 300 } } }]);
  eq("сверка: подборка по деньгам отчёта", out.map((l) => `${l.id}:${l.season}`), ["a:SS 2026", "b:SS 2026", "c:FW 25/26"]);
  ok("сверка: исходные строки не изменены", ls.every((l) => l.season === "FW 25/26"));
  ok("сверка: артикул/цвет сравниваются без знаков и регистра", pcsBy(out, "SS 2026") === 2);
}
{
  // Одна продажа 3 шт. на 300 ₽, отчёт хочет 1 шт. в SS26 → делим: 1 шт. (100 ₽) в SS 2026, 2 шт. (200 ₽) остаются.
  const ls = [sale("x", "2026-03-10", 3, 300)];
  const out = reconcileSeasonsWithReport(ls, [{ acode: "MH-03 SABLE", color: "blk", seas: { SS26: { soldSsn: 1, rubSsn: 100 } } }]);
  ok("деление: две строки", out.length === 2);
  ok("деление: перенесённая часть", out[0].season === "SS 2026" && out[0].pcs === 1 && out[0].id === "x~r");
  near("деление: деньги пропорционально (300 × 1/3)", out[0].retailRub, 100);
  ok("деление: остаток", out[1].season === "FW 25/26" && out[1].pcs === 2 && out[1].id === "x");
  near("деление: Σ штук и денег сохраняется", rubAll(out) + out.reduce((s, l) => s + l.pcs, 0), 300 + 3);
  near("деление: рубли без НДС тоже делятся", out[0].retailRubExVat + out[1].retailRubExVat, 250);
}
{
  // Разные штуки (не только по 1) → по дате: сначала ранняя продажа 03-01 (2 шт.), делим 1 шт.; поздняя 05-01 не трогается.
  const ls = [sale("late", "2026-05-01", 1, 100), sale("early", "2026-03-01", 2, 200)];
  const out = reconcileSeasonsWithReport(ls, [{ acode: "MH-03/SABLE", color: "BLK", seas: { SS26: { soldSsn: 1, rubSsn: 100 } } }]);
  eq("по дате: сначала ранние", out.map((l) => `${l.id}:${l.season}:${l.pcs}`), ["late:FW 25/26:1", "early~r:SS 2026:1", "early:FW 25/26:1"]);
}
{
  // Возвраты, нулевые штуки и продажи другого календарного сезона не переводятся.
  const ls = [sale("r", "2026-03-01", 1, 100, "FW 25/26", "RETURN"), sale("z", "2026-03-02", 0, 0), sale("f", "2025-10-01", 1, 100)];
  const out = reconcileSeasonsWithReport(ls, [{ acode: "MH-03/SABLE", color: "BLK", seas: { SS26: { soldSsn: 5, rubSsn: 500 } } }]);
  ok("не продажи и чужой календарь — без изменений", out === ls && out.every((l) => l.season === "FW 25/26"));
  const other = reconcileSeasonsWithReport([sale("a", "2026-03-01", 1, 100)], [{ acode: "MH-04", color: "BLK", seas: { SS26: { soldSsn: 1, rubSsn: 100 } } }]);
  ok("другой артикул в отчёте — без изменений", other[0].season === "FW 25/26");
  const neg = reconcileSeasonsWithReport([sale("a", "2026-03-01", 1, 100)], [{ acode: "MH-03/SABLE", color: "BLK", seas: { SS26: { soldSsn: -3 } } }]);
  ok("отрицательное в отчёте — как 0", neg[0].season === "FW 25/26");
}
{
  // FW 26/27: продажа в ноябре 2026 → календарь «FW 26/27»; отчёт 1 шт. → переводится.
  const out = reconcileSeasonsWithReport([sale("n", "2026-11-05", 1, 100, "SS 2026")], [{ acode: "MH-03/SABLE", color: "BLK", seas: { "FW26/27": { soldSsn: 1, rubSsn: 100 } } }]);
  ok("сверка FW 26/27 по ноябрьской продаже", out[0].season === "FW 26/27");
}

// Найденные этими тестами ошибки (исправлены 26.11): имена прототипа из адреса и «ё» в артикуле.
ok("parseCols: «toString» из адреса — не колонка, набор как без параметра", JSON.stringify(parseCols(["toString"], false)) === JSON.stringify(parseCols([], false)));
ok("parseSort: «toString»/«constructor» — не сортировка", (parseSort("toString", "asc").sort as string) !== "toString" && (parseSort("constructor", "desc").sort as string) !== "constructor");
ok("articleKey: «Ёлка» = «Елка», «ёж» = «еж»", articleKey("Ёлка") === articleKey("Елка") && articleKey("ёж") === articleKey("еж"));

console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
process.exit(fails ? 1 : 0);
