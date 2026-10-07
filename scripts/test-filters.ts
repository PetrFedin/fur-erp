// Проверки разбора фильтров (src/lib/filters): npx tsx scripts/test-filters.ts
import assert from "node:assert/strict";
import { NONE, activeChips, activeCount, defineFilters, filterHref, matchesMulti, parseFilters, pick, resetHref, splitNone, toWhere } from "../src/lib/filters";

const F = defineFilters({
  ...pick(["auction", "pyear", "status", "q", "from", "to", "tab", "vat"], { status: { allowed: ["A", "B"] } }),
});

// повтор параметра и псевдонимы
const f = parseFilters(F, { auction: ["СП 09-26", "РП 04-26, с запятой"], auc: "SAGA 03-26", py: ["2026", "abc"], status: ["A", "X"], nds: "20", dq: " поиск ", from: "2026-02-30", to: "2026-03-01", tab: "lots" });
assert.deepEqual(f.auction, ["СП 09-26", "РП 04-26, с запятой", "SAGA 03-26"]);
assert.deepEqual(f.pyear, ["2026"]); // «abc» отброшен шаблоном
assert.deepEqual(f.status, ["A"]); // «X» не из списка
assert.deepEqual(f.vat, ["20"]); // старое имя nds
assert.equal(f.q, "поиск"); // старое имя dq
assert.equal(f.from, ""); // несуществующая дата
assert.equal(f.to, "2026-03-01");
assert.equal(activeCount(F, f), 8); // auction 3, pyear 1, status 1, vat 1, q 1, to 1 (tab — параметр вида)

// ссылка: канонические имена, сброс page/limit при смене фильтра, сохранение вида
const withPage = parseFilters(F, { tab: "x", page: "3", limit: "100", status: "A" });
const href = filterHref(F, "/p", withPage, { status: ["A", "B"] });
assert.equal(href, "/p?status=A&status=B&tab=x"); // page и limit сброшены, tab сохранён
assert.equal(filterHref(F, "/p", withPage, { page: "4" }), "/p?page=4&limit=100&status=A&tab=x"); // смена страницы фильтры не трогает
assert.equal(resetHref(F, "/p", parseFilters(F, { tab: "summary", status: "A", page: "2" })), "/p?tab=summary");

// чипы: клик снимает одно значение
const chips = activeChips(F, parseFilters(F, { status: ["A", "B"], q: "x" }), { path: "/p", labels: { status: { A: "Альфа" } } });
assert.equal(chips.length, 3);
assert.equal(chips[0].text, "Альфа");
assert.equal(chips[0].href, "/p?status=B&q=x");

// toWhere: пустые фильтры пропускаются
const w = toWhere(parseFilters(F, { status: "A" }), { status: (v) => ({ s: v }), auction: (v) => ({ a: v }) });
assert.deepEqual(w, [{ s: ["A"] }]);

// none
assert.deepEqual(splitNone(["a", NONE]), { none: true, rest: ["a"] });
assert.equal(matchesMulti([], "x"), true);
assert.equal(matchesMulti([NONE], null), true);
assert.equal(matchesMulti(["a"], null), false);
assert.equal(matchesMulti(["a"], "a"), true);

console.log("filters: ok");
