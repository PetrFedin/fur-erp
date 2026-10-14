/**
 * Этапы сырья: текущий этап, ожидаемая дата, длительность (чистая логика):
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-raw-stage.ts
 */
import { summarizeStages, summaryLine, summaryChip, stageDuration, sortStages, todayDay } from "../src/lib/raw-stage";

let fails = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const now = new Date(2026, 9, 15, 12, 0, 0); // 15.10.2026, местное время

ok(summarizeStages([], now) === null, "пусто — null");

const chain = [
  { stage: "DRESSING", status: "IN_PROGRESS", place: "МК ЛИС", plannedStart: d("2026-10-02"), plannedEnd: d("2026-10-18"), factStart: d("2026-10-02") },
  { stage: "AUCTION_BOUGHT", status: "DONE", factStart: d("2026-09-01"), factEnd: d("2026-09-03") },
  { stage: "TONING", status: "PLANNED", place: "Москва", plannedStart: d("2026-10-18"), plannedEnd: d("2026-10-25") },
  { stage: "TO_WAREHOUSE", status: "PLANNED", plannedStart: d("2026-10-25"), plannedEnd: d("2026-10-28") },
];
const s = summarizeStages(chain, now)!;
ok(s.state === "now" && s.stage === "DRESSING" && s.place === "МК ЛИС", "текущий — идущий этап (Выделка, МК ЛИС)");
ok(s.eta?.toISOString().slice(0, 10) === "2026-10-28", "ждём к: конец «В пути на склад», не ближайшего этапа");
ok(s.daysLeft === 13 && !s.overdue, `осталось 13 дн.: ${s.daysLeft}`);
ok(summaryLine(s) === "Выделка · МК ЛИС · с 02.10 · ждём к 28.10 (осталось 13 дн.)", summaryLine(s));
ok(summaryChip(s) === "Выделка · ждём к 28.10", summaryChip(s));

ok(sortStages(chain).map((x) => x.stage).join() === "AUCTION_BOUGHT,DRESSING,TONING,TO_WAREHOUSE", "лента по порядку справочника");
ok(stageDuration(chain[0], todayDay(now)) === "в работе 13 дн.", stageDuration(chain[0], todayDay(now)));
ok(stageDuration(chain[1], todayDay(now)) === "заняло 2 дн.", stageDuration(chain[1], todayDay(now)));
ok(stageDuration(chain[2], todayDay(now)) === "план 7 дн.", stageDuration(chain[2], todayDay(now)));

// между этапами: предыдущий готов, следующий не начат
const between = summarizeStages([{ stage: "PAID", status: "DONE", factEnd: d("2026-10-01") }, { stage: "DRESSING", status: "PLANNED", plannedEnd: d("2026-10-20") }], now)!;
ok(between.state === "between" && between.stage === "DRESSING" && summaryLine(between).startsWith("Далее: Выделка"), summaryLine(between));
ok(between.daysLeft === 5, "ждём к 20.10: осталось 5");

// просрочено
const late = summarizeStages([{ stage: "DRESSING", status: "IN_PROGRESS", plannedEnd: d("2026-10-10"), factStart: d("2026-10-01") }], now)!;
ok(late.overdue && late.daysLeft === -5 && /просрочено на 5 дн\./.test(summaryLine(late)), summaryLine(late));

// всё готово
const done = summarizeStages([{ stage: "AT_WAREHOUSE", status: "DONE" }, { stage: "HANDED", status: "DONE" }], now)!;
ok(done.state === "done" && done.eta === null && summaryChip(done) === "Передано нам (УПД)", summaryLine(done));

// без плановых дат: ждём к — нет
const nodate = summarizeStages([{ stage: "CUSTOMS", status: "IN_PROGRESS", factStart: d("2026-10-10") }], now)!;
ok(nodate.eta === null && nodate.daysLeft === null && summaryChip(nodate) === "Таможня", summaryChip(nodate));

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : "\nВсе проверки пройдены");
process.exit(fails ? 1 : 0);
