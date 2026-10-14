/**
 * Чистые расчёты раздела «Отгрузки» (без базы и prisma generate):
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-shipment-calc.ts
 */
import { acceptLineError, acceptSummaryText, deliverySummary, dayHeading, groupByOrder, groupEventsByDay, isAcceptanceEvent, sideError, planVsFact, shipmentTotals, shortStamp, wallToDate } from "../src/lib/shipment-calc";

let fails = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };

const lines = [
  { quantity: 50, acceptedQty: 45, returnedQty: 5 },
  { quantity: 27, acceptedQty: 20, returnedQty: null },
  { quantity: 10, acceptedQty: null, returnedQty: null },
];
const t = shipmentTotals(lines);
ok(t.inShipment === 87 && t.accepted === 65 && t.returned === 5 && t.remaining === 7 + 10 && t.filledLines === 2, `итоги: ${JSON.stringify(t)}`);
ok(acceptSummaryText(t) === "Принято 65 из 87, возврат 5", acceptSummaryText(t));
ok(acceptLineError(3, 50, 45, 5) === null && acceptLineError(3, 50, 40, null) === null, "принято + возврат ≤ в отгрузке — можно, меньше — тоже");
ok(/Строка 4: принято \+ возврат \(51\) больше, чем в отгрузке \(50\)/.test(acceptLineError(4, 50, 46, 5) ?? ""), acceptLineError(4, 50, 46, 5) ?? "");
ok(acceptLineError(1, 50, -1, null) !== null && acceptLineError(1, 50, 1.5, null) !== null, "отрицательное и дробное — ошибка");

ok(isAcceptanceEvent({ expected: true, title: "Принято в Коптево", place: null }), "«Принято в Коптево» — приёмка");
ok(isAcceptanceEvent({ expected: true, title: "Приёмка товара", place: null }) && isAcceptanceEvent({ expected: true, title: "Приемка", place: null }), "«Приёмка» / «Приемка»");
ok(isAcceptanceEvent({ expected: true, title: "Выгрузка", place: "Коптево" }), "место «Коптево»");
ok(!isAcceptanceEvent({ expected: false, title: "Принято в Коптево", place: "Коптево" }) && !isAcceptanceEvent({ expected: true, title: "QC", place: null }), "выполненный и посторонний — нет");

const d = (s: string) => wallToDate(s.slice(0, 10), s.slice(11) || null);
ok(planVsFact(d("2026-10-15"), d("2026-10-15")).text === "в срок", "в срок");
ok(planVsFact(d("2026-10-15"), d("2026-10-13")).text === "опережение на 2 дн.", "опережение");
ok(planVsFact(d("2026-10-15"), d("2026-10-18")).text === "задержка на 3 дн.", "задержка");
const st = shortStamp(d("2026-10-09T19:07".replace("T", " ").slice(0, 10) + " 19:07"), true);
ok(st.date === "09.10" && st.time === "19:07" && shortStamp(d("2026-10-05"), false).time === null, "короткая дата и время");

const ev = (id: string, title: string, at: string, time: boolean, n: number) => ({ id, title, occurredAt: wallToDate(at.slice(0, 10), at.slice(11) || null), timeKnown: time, createdAt: new Date(1000 * n), expected: false });
const events = [
  ev("a", "Примерка", "2026-10-05", false, 1),
  ev("b", "Василий прислал первое ТЗ", "2026-10-08 19:32", true, 2),
  ev("c", "Ольга отправила УПД", "2026-10-12 13:06", true, 3),
  ev("d", "Поставщик записался в Коптево на приёмку 15.10", "2026-10-12", false, 4),
  ev("e", "Принято в Коптево", "2026-10-15 16:00", true, 5),
  { ...ev("f", "Ожидаемый", "2026-10-20", false, 6), expected: true },
];
const sum = deliverySummary({ plannedDate: wallToDate("2026-10-15", null), acceptedAt: wallToDate("2026-10-15", "16:00"), acceptEventId: "e", events });
ok(sum.first?.title === "Примерка" && sum.accepted.title === "Принято в Коптево", "первый этап и этап приёмки");
ok(sum.plan.text === "в срок", "план → факт");
ok(sum.chain.map((c) => `${c.from}>${c.to}`).join("|") === "Примерка>Ольга отправила УПД|Ольга отправила УПД>Поставщик записался в Коптево на приёмку 15.10|Поставщик записался в Коптево на приёмку 15.10>Принято в Коптево", `цепочка: ${sum.chain.map((c) => c.text).join(" / ")}`);
const plain = deliverySummary({ plannedDate: wallToDate("2026-10-15", null), acceptedAt: wallToDate("2026-10-16", "10:00"), acceptEventId: "z", events: [ev("a", "Один", "2026-10-10", false, 1), ev("b", "Два", "2026-10-11", false, 2), ev("c", "Три", "2026-10-16 10:00", true, 3)] });
ok(plain.chain.length === 1 && plain.chain[0].from === "Один" && plain.chain[0].to === "Три" && plain.plan.text === "задержка на 1 дн.", "без ключевых названий: «этап 1 → этап N»");

const grp = groupByOrder([
  { orderKey: "o1", label: "ТЗ 169", article: "A", quantity: 10, acceptedQty: 8, returnedQty: 2, comment: "шов" },
  { orderKey: "o1", label: "ТЗ 169", article: "A", quantity: 5, acceptedQty: 5, returnedQty: 0, comment: "не причина" },
  { orderKey: "o2", label: "ТЗ 170", article: "B", quantity: 4, acceptedQty: null, returnedQty: null, comment: null },
]);
ok(grp.length === 2 && grp[0].quantity === 15 && grp[0].accepted === 13 && grp[0].returned === 2 && grp[0].reasons.join() === "шов" && grp[1].waiting === 4, "группировка по ТЗ: суммы, причины только у строк с возвратом");

// «На ком»: только Веллмех / ЦУМ
ok(sideError("") !== null && sideError(null) !== null && sideError("ЧУЖОЙ") !== null && sideError("WELLMEKH") === null && sideError("CUM") === null, "«на ком»: пусто и чужое — ошибка, WELLMEKH / CUM — ок");
ok(sideError("") === "Укажите, на ком этап: Веллмех или ЦУМ", "текст ошибки «на ком»");

// Группировка по дням
ok(dayHeading(d("2026-10-12")) === "Пн, 12 октября 2026" && dayHeading(d("2026-10-04")) === "Вс, 4 октября 2026", "заголовок дня: " + dayHeading(d("2026-10-12")));
const gev = (s: string, expected = false) => ({ occurredAt: d(s), expected });
const grpEv = [gev("2026-10-05"), gev("2026-10-09 19:07"), gev("2026-10-09 20:00"), gev("2026-10-14 10:00"), gev("2026-10-14 18:00", true), gev("2026-10-15", true), gev("2026-10-15 12:00", true)];
const gd = groupEventsByDay(grpEv, "2026-10-14");
ok(gd.map((g) => g.items.length).join() === "1,2,2,2", "группы по дням: " + gd.map((g) => g.items.length).join());
ok(gd.map((g) => g.kind).join() === "past,past,today,upcoming", "виды: " + gd.map((g) => g.kind).join());
ok(gd.flatMap((g) => g.items.map((x) => x.index)).join() === "0,1,2,3,4,5,6", "индексы сохраняют общий порядок");
ok(groupEventsByDay([], "2026-10-14").length === 0, "пусто — нет групп");

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : "\nВсе проверки пройдены");
process.exit(fails ? 1 : 0);
