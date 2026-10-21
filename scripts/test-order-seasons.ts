// Сезон ТЗ для блока «Производство» на Главной: доли по приходу модели, запасные правила, масштабирование ТЗ (сумма сезонов = «Все»).
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-order-seasons.ts
import "./stubs/server-only-shim";
import { modelSeasonShares, orderSeasonShares } from "../src/lib/order-seasons";
import { ordersForSeason, scaleOrder } from "../src/lib/season-orders";
import type { DrillOrder } from "../src/lib/dashboard-drill";

let fails = 0;
const ok = (what: string, cond: boolean, extra = "") => { if (!cond) fails++; console.log(`${cond ? "ОК " : "НЕТ"} ${what}${extra ? " — " + extra : ""}`); };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const rec = [
  { article: "M012/MINK BGL", iso: "2025-10-02", pcs: 6, kind: "RECEIPT" },   // FW 25/26
  { article: "M012/MINK LVD", iso: "2026-03-10", pcs: 2, kind: "RECEIPT" },   // SS 2026
  { article: "M012/MINK BGL", iso: "2026-09-05", pcs: 4, kind: "RECEIPT" },   // FW 26/27
  { article: "M012/MINK BGL", iso: "2026-09-06", pcs: -1, kind: "RECEIPT" },  // корректировка: тот же сезон, нетто 3
  { article: "M012/MINK BGL", iso: "2026-09-07", pcs: 5, kind: "SALE" },      // продажа в приход не входит
  { article: "MSC-01 TORTORA", iso: "2026-02-01", pcs: -2, kind: "RECEIPT" }, // только минус — доли нет
];
const by = modelSeasonShares(rec);
const m = by.get("M012")!;
ok("доли модели: FW 25/26 6/11, SS 2026 2/11, FW 26/27 3/11", near(m["FW 25/26"], 6 / 11) && near(m["SS 2026"], 2 / 11) && near(m["FW 26/27"], 3 / 11), JSON.stringify(m));
ok("доли модели суммой 1", near(Object.values(m).reduce((a, v) => a + v, 0), 1));
ok("модель без положительного прихода — без долей", !by.has("MSC01"));
ok("ТЗ модели с приходом — по долям прихода", JSON.stringify(orderSeasonShares({ model: "М012", date: null, year: 2026 }, by)) === JSON.stringify(m)); // кириллица «М» нормализуется
ok("нет прихода: сезон по дате ТЗ (сентябрь 2026 → FW 26/27)", JSON.stringify(orderSeasonShares({ model: "MH09", date: "2026-09-25", year: 2026 }, by)) === '{"FW 26/27":1}');
ok("нет прихода и даты: 2025 → FW 25/26, 2026 → SS 2026", JSON.stringify(orderSeasonShares({ model: "MH09", date: null, year: 2025 }, by)) === '{"FW 25/26":1}' && JSON.stringify(orderSeasonShares({ model: "MH09", date: null, year: 2026 }, by)) === '{"SS 2026":1}');

const line = { k: "f" as const, n: "Норка", fu: "Норка", lot: "L", ln: null, au: "A", pid: null, pn: null, q: 10, i: 1000, e: 800, ci: 40, ce: 32 };
const o: DrillOrder = { id: "1", number: "П-1", wo: null, bk: "1", bl: "Партия 1", y: 2026, st: "COMPLETED", cat: "Жакет", grp: "Одежда", mid: "m", ml: "M012 · Жакет", fur: "Норка", qty: 11, work: 110, exp: 22, xs: [{ n: "Фурнитура", a: 22 }], hI: 11, hE: 9, resI: 0, resE: 0, lines: [line], sw: m };
const parts = ["FW 25/26", "SS 2026", "FW 26/27"].map((s) => ordersForSeason([o], s)[0]);
const sum = (f: (x: DrillOrder) => number) => parts.reduce((a, x) => a + f(x), 0);
ok("сумма штук по сезонам = штуки ТЗ", near(sum((x) => x.qty), 11));
ok("сумма работы и расходов по сезонам = ТЗ", near(sum((x) => x.work), 110) && near(sum((x) => x.exp), 22) && near(sum((x) => x.xs![0].a), 22));
ok("сумма строк списания (штуки, суммы, 4 %) по сезонам = ТЗ", near(sum((x) => x.lines[0].q), 10) && near(sum((x) => x.lines[0].i), 1000) && near(sum((x) => x.lines[0].ce), 32));
ok("шкуры подрядчика делятся", near(sum((x) => x.hI), 11) && near(sum((x) => x.hE), 9));
ok("«Все» — те же ТЗ без копий", ordersForSeason([o], "all")[0] === o);
ok("сезон без доли — ТЗ нет", ordersForSeason([{ ...o, sw: { "FW 25/26": 1 } }], "SS 2026").length === 0);
ok("ТЗ без долей считается целиком", ordersForSeason([{ ...o, sw: undefined }], "SS 2026")[0].qty === 11);
ok("scaleOrder не меняет исходный ТЗ", o.qty === 11 && o.lines[0].i === 1000 && scaleOrder(o, 0.5).qty === 5.5);
console.log(fails ? `ПРОВАЛОВ: ${fails}` : "Все проверки пройдены");
process.exitCode = fails ? 1 : 0;
