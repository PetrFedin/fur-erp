// Проверка расчёта поставщика на реальных файлах Веллмеха (m_research) и формул. Ничего не пишет.
import "./stubs/server-only-shim";
import { readFile } from "node:fs/promises";
import { parseTableFile } from "../src/lib/table-file";
import { calcAll, emptyPayload, evalNum, missingRates, newId, payloadFromTable, type CalcPayload } from "../src/lib/supplier-calc";
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
  err("процент", "5%", /%/);
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
  console.log(bad ? `ПРОВАЛОВ: ${bad}` : "всё сходится");
  process.exit(bad ? 1 : 0);
})();
