// Проверка расчёта поставщика на реальных файлах Веллмеха (m_research) и формул. Ничего не пишет.
import "./stubs/server-only-shim";
import { readFile } from "node:fs/promises";
import { parseTableFile } from "../src/lib/table-file";
import { calcAll, emptyPayload, evalNum, missingRates, newId, payloadFromTable, type CalcPayload } from "../src/lib/supplier-calc";
import { detectFormat, parsePasted, finalFigures } from "../src/lib/supplier-calc-simple";
import { FormulaError, evalSimple, renameColumnRefs } from "../src/lib/calc-formula";

const DIR = "/private/tmp/claude-501/-Users-petr-Documents-claude/d078d416-b2d7-4795-b3e7-4401793187b6/scratchpad/m_research/";
let bad = 0;
const ok = (name: string, got: number, want: number, tol = 0.02) => {
  const pass = Math.abs(got - want) <= tol;
  if (!pass) bad++;
  console.log(`${pass ? "OK " : "FAIL"} ${name}: ${got.toFixed(4)} (ожидалось ${want})`);
};
async function load(f: string) {
  const t = await parseTableFile(await readFile(DIR + f), f);
  const r = payloadFromTable(t);
  if ("error" in r) throw new Error(f + ": " + r.error);
  return r.payload;
}
(async () => {
  ok("evalNum", evalNum("(3,9+6)*1,156+250/91,89"), (3.9 + 6) * 1.156 + 250 / 91.89, 1e-9);
  const sp = await load("12__расчет закупки СП 09-26.xlsx");
  const c = calcAll(sp);
  const i4 = sp.rows.findIndex((r) => r.lot === "4");
  ok("СП 09-26 лот 4, ₽/шкуру", c.calcs[i4].unitRub, 42342.95, 0.05);
  ok("СП 09-26 лот 4, шт", Number(sp.rows[i4].qty), 30, 0);
  const rp = await load("134__закупка РП 04-2026.xlsx");
  const cr = calcAll(rp);
  const j1 = rp.rows.findIndex((r) => r.lot === "1");
  ok("РП 04-2026 лот 1, ₽/шкуру", cr.calcs[j1].unitRub, 32642.69, 0.05);
  const sg = await load("228__Закупка ММ SAGA 03-26.xlsx");
  console.log("SAGA формат:", sg.format, "строк", sg.rows.length);
  const k = sg.rows.findIndex((r) => r.lot === "355159");
  // лист «предварительный расчет» — полный; $ за шкуру со всеми статьями
  console.log("SAGA лот 355159: $", calcAll(sg).calcs[k].unitUsd);
  // Только коэффициент, сбор, упаковка, брокер, корректировка → 93,66 $ (лист invoices)
  const bare = { ...sg, rows: [{ ...sg.rows[k], dressing: "0", customs: "0", air: "0", interestPct: "0" }] };
  ok("SAGA лот 355159, $/шкуру (без выделки/аванса/авиа/интереса)", calcAll(bare).calcs[0].unitUsd ?? 0, 93.66, 0.01);
  const fh = await load("182__расчет закупки.xlsx");
  console.log("FH формат:", fh.format, "строк", fh.rows.length, "первая ₽/шкуру", calcAll(fh).calcs[0].unitRub.toFixed(2));

  // ---- ставки вводит поставщик: без ставок сбор = 0 и предупреждение; со ставками из шапки — цифры из файла
  {
    const e = emptyPayload("SP_RP");
    Object.assign(e.rows[0], { qty: "30", price: "360", lot: "4", dressing: "", transport: "" });
    e.header.cbRate = "84.4075";
    ok("без ставок сбор не подставляется (₽ за шкуру = цена×курс×1,22)", calcAll(e).calcs[0].unitRub, 360 * 84.4075 * 1.22, 0.01);
    if (missingRates(e).length < 4) { bad++; console.log("FAIL предупреждение «ставка не указана»", missingRates(e)); } else console.log("OK  предупреждение о ставках:", missingRates(e).length);
    e.header.rates = { feePct: "7.35" };
    const part = calcAll(e).calcs[0].parts.find((x) => x.label.startsWith("Аукционный сбор"))!.value;
    ok("сбор 7,35 % лот 4 → 2 233,42 ₽ (цена×курс×7,35 %)", part, 360 * 84.4075 * 0.0735, 0.01);
  }
  // ---- формулы
  const f = (s: string, p: Record<string, number> = {}) => evalSimple(s, p);
  ok("приоритеты 2+3*4", f("=2+3*4"), 14, 0);
  ok("скобки и унарный минус", f("-(2+3)*4"), -20, 0);
  ok("запятая и точка", f("0,5+0.25"), 0.75, 1e-12);
  ok("параметры по имени", f("курс*ставка_сбора", { "курс": 84.4075, "ставка_сбора": 0.0735 }), 84.4075 * 0.0735, 1e-9);
  ok("ROUND", f("ROUND(2,345;2)"), 2.35, 0);
  ok("MIN/MAX", f("MIN(5;3;9)+MAX(1;2)"), 5, 0);
  ok("IF истина", f("IF(5>3;10;20)"), 10, 0);
  ok("IF ложь", f("IF(5<=3;10;20)"), 20, 0);
  ok("деление", f("10/4"), 2.5, 0);
  const err = (name: string, src: string, re: RegExp) => { try { f(src); bad++; console.log("FAIL ожидалась ошибка:", name); } catch (e) { const m = e instanceof FormulaError ? e.message : String(e); if (re.test(m)) console.log("OK  ошибка:", name, "→", m); else { bad++; console.log("FAIL текст ошибки", name, m); } } };
  err("деление на ноль", "1/0", /Деление на ноль/);
  err("неизвестный параметр", "x1+1", /Неизвестный параметр/);
  err("скобка", "(1+2", /Ожидалась/);
  err("мусор", "1+*2", /Неожиданный/);
  err("функция", "FOO(1)", /Неизвестная функция/);
  err("аргументы ROUND", "ROUND(1)", /нужно аргументов/);
  ok("процент 4,5% = 0,045", f("4,5%"), 0.045, 1e-12);
  ok("процент в выражении 200*4,5%", f("200*4,5%"), 9, 1e-9);
  ok("процент после скобки (2+3)%", f("(2+3)%"), 0.05, 1e-12);
  err("диапазон вне функции", "A:B", /Диапазон/);
  // ---- столбцы: лот 4, 30 шкур, $360, курс 84,4075, сбор 7,35 %
  {
    const e = emptyPayload("SP_RP");
    Object.assign(e.rows[0], { qty: "30", price: "360", lot: "4" });
    e.header.cbRate = "84.4075"; e.header.rates = { feePct: "7.35" };
    e.rows.push({ ...e.rows[0], _id: newId(), lot: "5", qty: "10", price: "100" });
    // H = Закупка $ (после A..G ввода), курс/ставка_сбора — параметры шапки
    const cc = (id: string, title: string, formula: string) => ({ id, letter: "", title, unit: "₽", formula });
    e.customColumns = [cc("c1", "Сбор ₽", "=H*курс*ставка_сбора/100"), cc("c2", "Сбор ×2", "=R*2"), cc("c3", "Итог сборов", "=SUM(R)")];
    const t = calcAll(e);
    const col = (id: string) => t.sheet.cells[id];
    const letter = (id: string) => t.sheet.cols.find((c) => c.id === id)!.letter;
    if (letter("price") !== "H") { bad++; console.log("FAIL буква Закупка $ =", letter("price")); }
    ok("столбец-формула: сбор лот 4 = 2 233,42 ₽", col("c1")[0].v ?? NaN, 360 * 84.4075 * 0.0735, 0.01);
    ok("зависимый столбец", col("c2")[0].v ?? NaN, 2 * 360 * 84.4075 * 0.0735, 0.02);
    ok("SUM по строкам", col("c3")[0].v ?? NaN, (360 + 100) * 84.4075 * 0.0735, 0.02);
    e.overrides = { [e.rows[0]._id]: { c1: "1000" } };
    const t2 = calcAll(e);
    ok("ручное значение ячейки", t2.sheet.cells.c1[0].v ?? NaN, 1000, 0);
    if (!t2.sheet.cells.c1[0].manual) { bad++; console.log("FAIL пометка «вручную»"); }
    ok("зависимое от ручной ячейки", t2.sheet.cells.c2[0].v ?? NaN, 2000, 0);
    // выбор столбца себестоимости
    const e3: CalcPayload = { ...e, overrides: {}, customColumns: [cc("c1", "С", "=ROUND(" + "unit_x" + ";2)")], params: [{ name: "unit_x", value: "100" }], unitCostColumn: "c1" };
    ok("столбец себестоимости из выбранного", calcAll(e3).calcs[0].unitRub, 100, 0);
    ok("сумма по выбранному столбцу", calcAll(e3).totalRub, 100 * 30 + 100 * 10, 0);
    // ошибки
    const e4: CalcPayload = { ...e, overrides: {}, customColumns: [cc("c1", "A1", "=Z*2"), cc("c2", "A2", "=H/0")] };
    const t4 = calcAll(e4);
    if (!/Неизвестный столбец Z/.test(t4.sheet.cells.c1[0].err ?? "")) { bad++; console.log("FAIL неизвестный столбец", t4.sheet.cells.c1[0]); } else console.log("OK  неизвестный столбец Z");
    if (!/Деление на ноль/.test(t4.sheet.cells.c2[0].err ?? "")) { bad++; console.log("FAIL деление на ноль в столбце"); } else console.log("OK  деление на ноль в столбце");
    // циклы
    const e5: CalcPayload = { ...e, overrides: {}, customColumns: [cc("c1", "X", "=S+1"), cc("c2", "Y", "=R+1")] };
    const t5 = calcAll(e5);
    const lc = letter("c1");
    if (!/Циклическая/.test(t5.sheet.colErrors.c1 ?? "") || !/Циклическая/.test(t5.sheet.colErrors.c2 ?? "")) { bad++; console.log("FAIL цикл", t5.sheet.colErrors, lc); } else console.log("OK  цикл:", t5.sheet.colErrors.c1);
    // старый payload без новых полей
    const old: CalcPayload = { v: 1, format: "SP_RP", header: e.header, rows: e.rows.map((r) => { const { _id, ...x } = r; void _id; return x; }) };
    ok("старый payload без новых полей считается", calcAll(old).calcs[0].unitRub, calcAll({ ...e, customColumns: [] }).calcs[0].unitRub, 1e-9);
    if (renameColumnRefs("=P*2+SUM(Q)+ROUND(R;2)", { P: "O", Q: "P" }) !== "=O*2+SUM(P)+ROUND(R;2)") { bad++; console.log("FAIL renameColumnRefs", renameColumnRefs("=P*2+SUM(Q)+ROUND(R;2)", { P: "O", Q: "P" })); } else console.log("OK  renameColumnRefs");
  }
  // ---- свободная таблица: ячейки H3, диапазоны, AVERAGE, SUBTOTAL, правила для блоков строк, IF, проценты
  {
    const mk = (formulas: { id: string; f: string; rules?: import("../src/lib/supplier-calc").ColRule[] }[]): CalcPayload => {
      const q = emptyPayload("SHEET");
      q.rows = [1, 2, 3, 4].map((n) => ({ _id: newId(), fur: n <= 2 ? "норка" : "свакара", size: "", lot: String(n), a: String(n * 10), b: String(n) }));
      q.customColumns = [
        { id: "a", letter: "", title: "Цена", unit: "$", formula: "", kind: "input" },
        { id: "b", letter: "", title: "Кол-во", unit: "шт", formula: "", kind: "input" },
        ...formulas.map((x) => ({ id: x.id, letter: "", title: x.id, unit: "", formula: x.f, rules: x.rules })),
      ];
      return q;
    };
    // колонки: A=Мех B=Описание C=Лот D=Цена E=Кол-во F.. формулы
    const q = mk([
      { id: "f1", f: "=D*E*4,5%" },          // F
      { id: "f2", f: "=D1+D4" },             // G: ячейки D1 и D4 (10+40)
      { id: "f3", f: "=SUM(D:E)" },          // H: сумма столбцов D..E этой строки
      { id: "f4", f: "=SUM(D)" },            // I: итог по столбцу D
      { id: "f5", f: "=AVERAGE(D)" },        // J
      { id: "f6", f: "=SUBTOTAL(9;D)" },     // K
      { id: "f7", f: "=SUM(D1:E2)" },        // L: прямоугольник 10+1+20+2
      { id: "f8", f: "=IF(D>20;1;0)" },      // M
      { id: "f9", f: "=D*9,2%", rules: [{ rowFrom: 1, rowTo: 2, formula: "=D*7,95%+0,1" }] },  // N: правило для строк 1–2
      { id: "f10", f: "=D*9,2%", rules: [{ whenCol: "fur", op: "=", whenValue: "норка", formula: "=D*7,95%+0,1" }] }, // O: по типу меха
      { id: "f11", f: "=AVERAGE(D:E)" },     // P: среднее по строке
    ]);
    const sh = calcAll(q).sheet;
    const cell = (id: string, i = 0) => sh.cells[id][i].v ?? NaN;
    const L = (id: string) => sh.cols.find((c) => c.id === id)!.letter;
    if (L("f1") !== "F") { bad++; console.log("FAIL буквы свободной таблицы", L("f1")); }
    ok("F = D*E*4,5% (строка 2: 20*2*0,045)", cell("f1", 1), 20 * 2 * 0.045, 1e-9);
    ok("ячейки D1+D4", cell("f2"), 50, 0);
    ok("SUM(D:E) в строке 3 (30+3)", cell("f3", 2), 33, 0);
    ok("SUM(D) итог по столбцу", cell("f4"), 100, 0);
    ok("AVERAGE(D)", cell("f5"), 25, 0);
    ok("SUBTOTAL(9;D)", cell("f6"), 100, 0);
    ok("SUM(D1:E2) прямоугольник", cell("f7"), 33, 0);
    ok("IF истина", cell("f8", 2), 1, 0);
    ok("IF ложь", cell("f8", 0), 0, 0);
    ok("правило строк 1–2 (норка 7,95%+0,1)", cell("f9", 0), 10 * 0.0795 + 0.1, 1e-9);
    ok("вне правила — основная формула (9,2%)", cell("f9", 2), 30 * 0.092, 1e-9);
    ok("правило по меху: норка", cell("f10", 1), 20 * 0.0795 + 0.1, 1e-9);
    ok("правило по меху: свакара", cell("f10", 3), 40 * 0.092, 1e-9);
    ok("AVERAGE(D:E) строка 4 (40;4)", cell("f11", 3), 22, 0);
    ok("итог по столбцу F", sh.sums.f1.v ?? NaN, (10 + 40 + 90 + 160) * 0.045, 1e-9);
    // приём: выбранные столбцы, ошибки
    q.unitCostColumn = "f1"; q.qtyColumn = "b";
    const t = calcAll(q);
    ok("свободная таблица: итого = Σ себестоимость×кол-во", t.totalRub, (10 * 1 * 0.045) * 1 + (20 * 2 * 0.045) * 2 + (30 * 3 * 0.045) * 3 + (40 * 4 * 0.045) * 4, 1e-6);
    if (calcAll(mk([{ id: "z", f: "=D1+" }])).sheet.colErrors.z) console.log("OK  ошибка синтаксиса в столбце"); else { bad++; console.log("FAIL ошибка синтаксиса"); }
    const cyc = calcAll(mk([{ id: "c1", f: "=G*2" }, { id: "c2", f: "=F+1" }])).sheet.colErrors;
    if (/Циклическая/.test(cyc.c1 ?? "")) console.log("OK  цикл в свободной таблице"); else { bad++; console.log("FAIL цикл", cyc); }
    // контрольная разность
    q.checks = [{ id: "k", title: "T−V", a: "F", b: "F", tol: "0,01" }];
    const { checkDiffs } = await import("../src/lib/supplier-calc");
    if (checkDiffs(q, calcAll(q).sheet)[0].ok) console.log("OK  контрольная разность"); else { bad++; console.log("FAIL контрольная разность"); }
  }
  // ---- простой вид: формат по названию, вставка из Excel, финальные цифры
  {
    const eq = (name: string, got: unknown, want: unknown) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) { bad++; console.log("FAIL", name, g, "≠", w); } else console.log("OK ", name); };
    eq("формат СП 09-26", detectFormat("СП 09-26"), "SP_RP");
    eq("формат Русьпушнина", detectFormat("", "Русьпушнина"), "SP_RP");
    eq("формат SAGA", detectFormat("SAGA 03-26"), "SAGA");
    eq("формат FH", detectFormat("FH 06-26"), "FH");
    eq("формат не опознан", detectFormat("Аукцион 5"), null);
    const a = parsePasted("4\tСоболь\tтёмный 1\t30\t360\n5\tСоболь\tсветлый\t1 200\t$100,5\nИтого\t\t\t1230\t");
    if ("error" in a) { bad++; console.log("FAIL вставка без шапки", a.error); } else eq("вставка без шапки", [a.rows.length, a.skipped, a.rows[0].qty, a.rows[1].qty, a.rows[1].price], [2, 1, "30", "1200", "100,5"]);
    const b = parsePasted("Цена\tКол-во\tЛот\tМех\n360\t30\t4\tСоболь");
    if ("error" in b) { bad++; console.log("FAIL вставка по шапке", b.error); } else eq("вставка по шапке", [b.rows[0].lot, b.rows[0].fur, b.rows[0].qty, b.rows[0].price], ["4", "Соболь", "30", "360"]);
    eq("вставка пустая → ошибка", "error" in parsePasted("  "), true);
    const e = emptyPayload("SP_RP");
    Object.assign(e.rows[0], { qty: "30", price: "360", lot: "4" });
    e.header.cbRate = "84.4075"; e.header.rates = { feePct: "7.35" };
    const ff = finalFigures(e, calcAll(e));
    eq("финальные цифры: лотов и шкур", [ff.lots, ff.qty], [1, 30]);
    ok("средняя за шкуру = итого / шкур", ff.avgRub, ff.totalRub / 30, 1e-9);
  }
  console.log(bad ? `ПРОВАЛОВ: ${bad}` : "всё сходится");
  process.exit(bad ? 1 : 0);
})();
