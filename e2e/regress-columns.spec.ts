import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { watchErrors } from "./helpers";

// Регрессия «своих столбцов» таблицы лотов (/lots?auction=…): гонки server actions, границы значений,
// мусорные аргументы, лимит 20 столбцов, итоги и мобильная вёрстка.
// Самодостаточно: свои аукционы «RG-…» и столбцы «RG-…» создаются и удаляются.
// Стенд: scripts/e2e.sh up reg3 3291; E2E_BASE_URL=http://localhost:3291 npx playwright test -c e2e/playwright.config.ts e2e/regress-columns.spec.ts
const DB = process.env.E2E_DB ?? "fur_erp_e2e_reg3";
const PW = "TestPass123!";
const HASH = "$2b$10$4GjnSssJqUQKMd1CV4W48.ElNt4xt63QzGqtRFKhIb6GnMVT89.0G"; // TestPass123!

function sql(q: string): string {
  return execSync(`docker exec -i fur-erp-db-1 psql -U fur_erp -d ${DB} -At -F '|' -v ON_ERROR_STOP=1`, { encoding: "utf8", input: q }).trim();
}
const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const ORG = sql(`select "organizationId" from "User" where email='anna@qa-test.ru'`);
const SUP = sql(`select id from "Supplier" where "organizationId"='${ORG}' order by "createdAt" limit 1`);
const WH = sql(`select id from "Warehouse" where "organizationId"='${ORG}' order by id limit 1`);
const MAT = sql(`select id from "RawMaterial" where "organizationId"='${ORG}' order by id limit 1`);
const enc = (a: string) => encodeURIComponent(a);
const lotsUrl = (a: string) => `/lots?auction=${enc(a)}`;

function actionId(name: string): string {
  const m = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node as Record<string, { exportedName?: string }>;
  const hit = Object.entries(m).find(([, v]) => v.exportedName === name);
  if (!hit) throw new Error("нет server action " + name);
  return hit[0];
}
/** Прямой вызов server action страницы /lots с JSON-аргументами. */
async function act(page: Page, name: string, args: unknown[]) {
  const r = await page.request.post("/lots", {
    headers: { "Next-Action": actionId(name), accept: "text/x-component", "content-type": "text/plain;charset=UTF-8" },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
  const text = await r.text();
  const body = (text.match(/\n1:(\{[^\n]*\})/)?.[1] ?? "").replace(/\s+/g, " ");
  return { status: r.status(), text: body || text.slice(0, 200).replace(/\s+/g, " "), json: body ? (JSON.parse(body) as { ok?: boolean; id?: string; error?: string; value?: unknown }) : null };
}

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(PW);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}
const setVat = async (page: Page, mode: "incl" | "excl") => {
  const u = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3291");
  await page.context().addCookies([{ name: "vatDisplay", value: mode, url: u.origin }]);
};

// ---------- данные ----------
const slug = (n: string) => n.replace(/[^A-Za-z0-9]/g, "_");
type Lot = { lot: string; qty: number; price: number };
/** Аукцион «RG-…» из одной закупки с лотами (НДС 20 %, курс rate, валюта cur). Возвращает id закупки и позиций. */
function mkAuction(name: string, lots: Lot[], o: { cur?: string; rate?: number; suffix?: string; auction?: string } = {}) {
  const s = slug(name) + (o.suffix ?? "");
  const pid = `rgc_p_${s}`;
  sql(`insert into "Purchase"(id,"organizationId",number,"supplierId","warehouseId",currency,"exchangeRate","auctionSession","invoiceNumber","orderDate","updatedAt")
       values ('${pid}','${ORG}','RGC-${s}','${SUP}','${WH}','${o.cur ?? "USD"}',${o.rate ?? 90},'${o.auction ?? name}','${s}', now(), now())`);
  const items = lots.map((l, i) => {
    const id = `${pid}_i${i}`;
    sql(`insert into "PurchaseItem"(id,"purchaseId","rawMaterialId",quantity,"unitPrice",subtotal,"vatRate","lotNumber")
         values ('${id}','${pid}','${MAT}',${l.qty},${l.price},${l.qty * l.price},20,'${l.lot}')`);
    return id;
  });
  return { pid, items };
}
function cleanRg() {
  sql(`update "PurchaseItem" set extra=null where "purchaseId" like 'rgc%\\_p\\_%'`);
  sql(`delete from "PurchaseItem" where "purchaseId" like 'rgc%\\_p\\_%'`);
  sql(`delete from "Purchase" where id like 'rgc%\\_p\\_%'`);
  sql(`update "PurchaseItem" set extra = NULLIF(extra - (select coalesce(array_agg(id),'{}') from "CustomField" where name like 'RG-%'), '{}'::jsonb) where extra is not null`);
  sql(`delete from "CustomField" where name ilike 'RG-%' or name ilike 'RGX%'`);
}
const extraOf = (item: string) => JSON.parse(sql(`select coalesce(extra::text,'{}') from "PurchaseItem" where id='${item}'`)) as Record<string, unknown>;
const mkField = async (page: Page, name: string, type: "TEXT" | "NUMBER" | "BOOLEAN") => {
  const r = await act(page, "createCustomField", [{ name, type }]);
  expect(r.json?.ok, `createCustomField ${name}: ${r.text}`).toBe(true);
  return r.json!.id!;
};

test.describe.configure({ mode: "default" });
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });
test.setTimeout(180_000);

test.beforeAll(() => {
  sql(`insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('rg_viewer','${ORG}','viewer@qa-test.ru','${HASH}','QA viewer','VIEWER',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash","isActive"=true`);
  cleanRg();
});
test.afterAll(() => cleanRg());

// =====================================================================================
test("гонка setCustomValue: 3 параллельных вызова на разные столбцы одного лота — все значения сохранены (10 раундов)", async ({ page }) => {
  cleanRg();
  const { items } = mkAuction("RG-RACE", [{ lot: "R1", qty: 10, price: 5 }, { lot: "R2", qty: 10, price: 5 }]);
  await loginAs(page, "anna@qa-test.ru");
  const fNum = await mkField(page, "RG-num", "NUMBER");
  const fTxt = await mkField(page, "RG-txt", "TEXT");
  const fBool = await mkField(page, "RG-bool", "BOOLEAN");
  for (let round = 0; round < 10; round++) {
    const item = items[round % 2];
    const rs = await Promise.all([
      act(page, "setCustomValue", [item, fNum, `${round + 1},5`]),
      act(page, "setCustomValue", [item, fTxt, `t${round}`]),
      act(page, "setCustomValue", [item, fBool, round % 2 === 0]),
    ]);
    for (const r of rs) expect(r.json?.ok, r.text).toBe(true);
    const x = extraOf(item);
    expect(x, `раунд ${round}`).toEqual({ [fNum]: round + 1.5, [fTxt]: `t${round}`, [fBool]: round % 2 === 0 });
  }
  // очистка одного значения не трогает соседние
  const item = items[0];
  const r = await act(page, "setCustomValue", [item, fTxt, ""]);
  expect(r.json?.ok).toBe(true);
  expect(Object.keys(extraOf(item)).sort()).toEqual([fNum, fBool].sort());
  // 3 вызова с очисткой и записью одновременно
  await Promise.all([act(page, "setCustomValue", [item, fNum, null]), act(page, "setCustomValue", [item, fTxt, "again"]), act(page, "setCustomValue", [item, fBool, null])]);
  expect(extraOf(item)).toEqual({ [fTxt]: "again" });
});

test("deleteCustomField в гонке с записью значений: столбец удалён, «осиротевших» значений нет, без 500 (10 раундов)", async ({ page }) => {
  cleanRg();
  const { items } = mkAuction("RG-DEL", [{ lot: "D1", qty: 1, price: 1 }, { lot: "D2", qty: 1, price: 1 }, { lot: "D3", qty: 1, price: 1 }]);
  await loginAs(page, "anna@qa-test.ru");
  const keep = await mkField(page, "RG-keep", "TEXT");
  for (const it of items) await act(page, "setCustomValue", [it, keep, "k"]);
  for (let round = 0; round < 10; round++) {
    const f = await mkField(page, `RG-tmp${round}`, "NUMBER");
    const calls = [
      act(page, "deleteCustomField", [f]),
      ...items.map((it, i) => act(page, "setCustomValue", [it, f, `${i + 1}`])),
      ...items.map((it) => act(page, "setCustomValue", [it, f, "7"])),
    ];
    const rs = await Promise.all(calls);
    for (const r of rs) {
      expect(r.status, r.text).toBeLessThan(500);
      expect(r.json?.ok === true || /не найден|удалён/i.test(r.json?.error ?? ""), r.text).toBe(true);
    }
    expect(sql(`select count(*) from "CustomField" where id='${f}'`)).toBe("0");
    expect(sql(`select count(*) from "PurchaseItem" where extra ? '${f}'`), `раунд ${round}: значения удалённого столбца остались`).toBe("0");
  }
  for (const it of items) expect(extraOf(it)).toEqual({ [keep]: "k" });
  expect(sql(`select string_agg(position::text, ',' order by position) from "CustomField" where "organizationId"='${ORG}'`)).toBe("0");
});

test("лимит 20 столбцов при 20+ параллельных createCustomField; позиции 0..N-1 без дублей; уникальность имён", async ({ page }) => {
  cleanRg();
  await loginAs(page, "anna@qa-test.ru");
  const k0 = Number(sql(`select count(*) from "CustomField" where "organizationId"='${ORG}'`));
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => act(page, "createCustomField", [{ name: `RGX${i}`, type: i % 3 === 0 ? "NUMBER" : i % 3 === 1 ? "TEXT" : "BOOLEAN" }])));
  for (const r of rs) expect(r.status, r.text).toBeLessThan(500);
  const ok = rs.filter((r) => r.json?.ok).length;
  expect(ok, "создано ровно до лимита").toBe(20 - k0);
  expect(rs.filter((r) => !r.json?.ok).every((r) => /Не больше 20/.test(r.json?.error ?? ""))).toBe(true);
  expect(Number(sql(`select count(*) from "CustomField" where "organizationId"='${ORG}'`))).toBe(20);
  expect(sql(`select string_agg(position::text, ',' order by position) from "CustomField" where "organizationId"='${ORG}'`)).toBe(Array.from({ length: 20 }, (_, i) => i).join(","));
  // ещё одна — отказ; дубль имени без учёта регистра — отказ
  const more = await act(page, "createCustomField", [{ name: "RGX-ещё", type: "TEXT" }]);
  expect(more.json?.error).toMatch(/Не больше 20/);
  await Promise.all(Array.from({ length: 5 }, () => act(page, "deleteCustomField", [sql(`select id from "CustomField" where name='RGX0'`) || "x"])));
  const dup = await Promise.all([act(page, "createCustomField", [{ name: "rgx-dup", type: "TEXT" }]), act(page, "createCustomField", [{ name: "RGX-DUP", type: "TEXT" }]), act(page, "createCustomField", [{ name: " rgx-Dup ", type: "TEXT" }])]);
  expect(dup.filter((r) => r.json?.ok).length, "из трёх одноимённых создан один").toBe(1);
  expect(sql(`select count(*) from "CustomField" where lower(name)='rgx-dup'`)).toBe("1");
  expect(sql(`select string_agg(position::text, ',' order by position) from "CustomField" where "organizationId"='${ORG}'`)).toBe(
    Array.from({ length: Number(sql(`select count(*) from "CustomField" where "organizationId"='${ORG}'`)) }, (_, i) => i).join(","),
  );
});

test("значения: 999999999999 и «-0», границы, текст в числовом и число в текстовом столбце, запятая и пробелы", async ({ page }) => {
  cleanRg();
  const { items } = mkAuction("RG-VAL", [{ lot: "V1", qty: 3, price: 2 }]);
  const item = items[0];
  await loginAs(page, "anna@qa-test.ru");
  const fNum = await mkField(page, "RG-n", "NUMBER");
  const fTxt = await mkField(page, "RG-t", "TEXT");
  const fBool = await mkField(page, "RG-b", "BOOLEAN");
  const val = async (f: string, raw: unknown) => {
    const r = await act(page, "setCustomValue", [item, f, raw]);
    expect(r.status, `${JSON.stringify(raw)} -> ${r.text}`).toBeLessThan(500);
    return r;
  };
  let r = await val(fNum, "999999999999");
  expect(r.json?.ok).toBe(true);
  expect(extraOf(item)[fNum]).toBe(999999999999);
  r = await val(fNum, "-999999999999");
  expect(r.json?.ok).toBe(true);
  expect(extraOf(item)[fNum]).toBe(-999999999999);
  r = await val(fNum, "-0");
  expect(r.json?.ok).toBe(true);
  expect(Object.is(extraOf(item)[fNum], -0), "«-0» не должен сохраняться как -0").toBe(false);
  expect(sql(`select extra->>'${fNum}' from "PurchaseItem" where id='${item}'`)).toBe("0");
  r = await val(fNum, "-0,0000001");
  expect(r.json?.ok).toBe(true);
  expect(sql(`select extra->>'${fNum}' from "PurchaseItem" where id='${item}'`)).toBe("0");
  r = await val(fNum, "1 234,5678");
  expect(sql(`select extra->>'${fNum}' from "PurchaseItem" where id='${item}'`)).toBe("1234.5678");
  r = await val(fNum, 12.5);
  expect(r.json?.ok).toBe(true);
  for (const bad of ["1000000000000", "-1000000000000", "abc", "1e3", "Infinity", "NaN", "1,2,3", "--1", "٣", "1 000 000 000 000"]) {
    r = await val(fNum, bad);
    expect(r.json?.error, `«${bad}»`).toMatch(/[А-Яа-яЁё]/);
  }
  expect(extraOf(item)[fNum], "после ошибок значение прежнее").toBe(12.5);
  // число в текстовом столбце: как строка — можно; как JSON-число — ошибка
  r = await val(fTxt, "12345");
  expect(r.json?.ok).toBe(true);
  r = await val(fTxt, 12345);
  expect(r.json?.error).toMatch(/ожидается текст/);
  expect(extraOf(item)[fTxt]).toBe("12345");
  r = await val(fTxt, "x".repeat(201));
  expect(r.json?.error).toMatch(/не длиннее 200/);
  // текст в числовом столбце — ошибка (нетронутое значение)
  r = await val(fNum, "двенадцать");
  expect(r.json?.error).toMatch(/укажите число/);
  // булев
  r = await val(fBool, "maybe");
  expect(r.json?.error).toMatch(/Да|Нет/);
  r = await val(fBool, 1);
  expect(r.json?.error).toBeTruthy();
  r = await val(fBool, true);
  expect(r.json?.ok).toBe(true);
  expect(extraOf(item)[fBool]).toBe(true);
});

test("мусорные аргументы (null, объекты, массивы, чужие/пустые id) — русская ошибка, без 500, без изменений данных", async ({ page }) => {
  cleanRg();
  const { items } = mkAuction("RG-BAD", [{ lot: "B1", qty: 1, price: 1 }]);
  const item = items[0];
  await loginAs(page, "anna@qa-test.ru");
  const f1 = await mkField(page, "RG-b1", "TEXT");
  const f2 = await mkField(page, "RG-b2", "NUMBER");
  await act(page, "setCustomValue", [item, f1, "keep"]);
  const posBefore = sql(`select string_agg(id||':'||position::text||':'||name||':'||type, ',' order by position) from "CustomField" where "organizationId"='${ORG}'`);
  const calls: [string, unknown[]][] = [
    ["createCustomField", [null]], ["createCustomField", []], ["createCustomField", ["строка"]], ["createCustomField", [{}]],
    ["createCustomField", [{ name: 123, type: {} }]], ["createCustomField", [{ name: "RG-x", type: "DATE" }]], ["createCustomField", [{ name: "RG-x", type: null }]],
    ["createCustomField", [{ name: "", type: "TEXT" }]], ["createCustomField", [{ name: "a".repeat(41), type: "TEXT" }]],
    ["createCustomField", [{ name: "RG-x", type: "TEXT", beforeId: { a: 1 } }]], ["createCustomField", [{ name: "RG-x", type: "TEXT", beforeId: "x".repeat(101) }]],
    ["renameCustomField", [null, null]], ["renameCustomField", [f1, null]], ["renameCustomField", [f1, 5]], ["renameCustomField", [f1, ""]], ["renameCustomField", ["нет", "RG-z"]], ["renameCustomField", [[], {}]],
    ["moveCustomField", [f1, "up"]], ["moveCustomField", [f1, null]], ["moveCustomField", [null, "left"]], ["moveCustomField", ["", "right"]], ["moveCustomField", [f1, "LEFT"]], ["moveCustomField", [f1, ["left"]]], ["moveCustomField", [{ id: f1 }, "left"]],
    ["deleteCustomField", [null]], ["deleteCustomField", [""]], ["deleteCustomField", [{}]], ["deleteCustomField", [["x"]]], ["deleteCustomField", ["не-существует"]], ["deleteCustomField", ["x".repeat(101)]],
    ["setCustomValue", [null, null, null]], ["setCustomValue", []], ["setCustomValue", [item, f1]], ["setCustomValue", [item, f1, {}]], ["setCustomValue", [item, f1, []]], ["setCustomValue", [item, f2, {}]], ["setCustomValue", [item, f2, true]],
    ["setCustomValue", [item, "нет", "x"]], ["setCustomValue", ["нет", f1, "x"]], ["setCustomValue", [{ a: 1 }, f1, "x"]], ["setCustomValue", [item, f2, "\u0000"]],
  ];
  for (const [name, args] of calls) {
    const r = await act(page, name, args);
    expect(r.status, `${name}(${JSON.stringify(args)}) -> ${r.text}`).toBeLessThan(500);
    if (r.json && !r.json.ok) expect(r.json.error, `${name}(${JSON.stringify(args)})`).toMatch(/[А-Яа-яЁё]/);
  }
  // ничего не сломано
  expect(extraOf(item)[f1], "значение не затёрто").toBe("keep");
  // только управляющие символы = пустое значение: очищает ячейку, но не падает
  const ctl = await act(page, "setCustomValue", [item, f1, "\u0000\u0001"]);
  expect(ctl.status).toBeLessThan(500);
  await act(page, "setCustomValue", [item, f1, "keep"]);
  const posAfter = sql(`select string_agg(id||':'||position::text||':'||name||':'||type, ',' order by position) from "CustomField" where "organizationId"='${ORG}'`);
  expect(posAfter).toBe(posBefore);
  // moveCustomField: только left/right — реальное перемещение работает и крайние позиции безопасны
  const order = () => sql(`select string_agg(id, ',' order by position) from "CustomField" where "organizationId"='${ORG}'`).split(",");
  expect(order()).toEqual([f1, f2]);
  expect((await act(page, "moveCustomField", [f1, "right"])).json?.ok).toBe(true);
  expect(order()).toEqual([f2, f1]);
  expect((await act(page, "moveCustomField", [f1, "right"])).json?.ok).toBe(true); // крайний — ничего не меняет
  expect(order()).toEqual([f2, f1]);
  expect((await act(page, "moveCustomField", [f1, "left"])).json?.ok).toBe(true);
  expect(order()).toEqual([f1, f2]);
  // права: наблюдатель не может менять
  const cv = await page.context().browser()!.newContext({ baseURL: process.env.E2E_BASE_URL, locale: "ru-RU" });
  const pv = await cv.newPage();
  await loginAs(pv, "viewer@qa-test.ru");
  await act(pv, "setCustomValue", [item, f1, "viewer-hack"]);
  await act(pv, "createCustomField", [{ name: "RG-viewer", type: "TEXT" }]);
  await act(pv, "deleteCustomField", [f2]);
  expect(extraOf(item)[f1]).toBe("keep");
  expect(sql(`select count(*) from "CustomField" where name='RG-viewer' or id='${f2}'`)).toBe("1");
  await cv.close();
});

// =====================================================================================
// UI: таблица лотов в режиме «Аукцион»
test.describe("UI таблицы лотов", () => {
  const SEL = {
    totalsRow: "tfoot tr[data-totals-row]",
  };
  const lots6: Lot[] = [
    { lot: "U1", qty: 10, price: 100 },
    { lot: "U2", qty: 20, price: 100 },
    { lot: "U3", qty: 30, price: 100 },
    { lot: "U4", qty: 10, price: 100 },
    { lot: "U5", qty: 20, price: 100 },
    { lot: "U6", qty: 30, price: 100 },
  ];

  test("итоги: «ср.» не длиннее 3 знаков, булев «Да X / Нет Y», выбор/скрытие фильтром и «Снять выбор», красная подсветка «от/до», 0 лотов «Σ 0» (оба режима НДС)", async ({ page }) => {
    cleanRg();
    const { items } = mkAuction("RG-UI", lots6);
    const errors = watchErrors(page);
    await loginAs(page, "anna@qa-test.ru");
    const fNum = await mkField(page, "RG-средн", "NUMBER");
    const fBool = await mkField(page, "RG-флаг", "BOOLEAN");
    // значения: средневзвешенное нетривиально (0,3333333 × qty …)
    const vals = [0.3333333, 0.6666667, 1.23456789, 2, 0.1, 0.2];
    for (let i = 0; i < 6; i++) await act(page, "setCustomValue", [items[i], fNum, String(vals[i]).replace(".", ",")]);
    for (let i = 0; i < 5; i++) await act(page, "setCustomValue", [items[i], fBool, i < 3]); // 3 Да, 2 Нет, 1 пусто
    const exp = (() => {
      const st = lots6.map((l, i) => ({ q: l.qty, v: Number(Number(vals[i].toFixed(6))) }));
      const sumq = st.reduce((s, x) => s + x.q, 0);
      return { wavg: st.reduce((s, x) => s + x.v * x.q, 0) / sumq, sum: st.reduce((s, x) => s + x.v, 0) };
    })();

    for (const mode of ["incl", "excl"] as const) {
      await setVat(page, mode);
      await page.goto(lotsUrl("RG-UI"));
      const tot = page.locator("section[data-auction-totals]");
      await expect(tot).toBeVisible();
      const row = tot.locator(SEL.totalsRow);
      const cells = (await row.locator(":scope > td").allInnerTexts()).map(norm);
      // «ср.» числового столбца
      const numCell = cells.find((c) => c.includes("заполнено у 6 из 6") && /ср\./i.test(c))!;
      expect(numCell, "числовой столбец в итоге").toBeTruthy();
      const avg = numCell.match(/ср\.\s*(-?[\d  ]+(?:,\d+)?)/i)![1];
      const frac = (avg.split(",")[1] ?? "").length;
      expect(frac, `«ср.» ${avg} — не больше 3 знаков`).toBeLessThanOrEqual(3);
      expect(Math.abs(Number(avg.replace(/\s/g, "").replace(",", ".")) - exp.wavg)).toBeLessThan(0.0006);
      const boolCell = cells.find((c) => /Да \d+ \/ Нет \d+/.test(c))!;
      expect(boolCell).toContain("Да 3 / Нет 2");
      expect(boolCell).toContain("заполнено у 5 из 6");

      // выбор 3 лотов, затем фильтр по № лота скрывает 2 из них
      await tot.getByRole("button", { name: "Выбрать все" }).click();
      await expect(tot.locator("[data-selection-label]")).toContainText("Выбрано 6 из 6");
      await tot.getByRole("button", { name: "Снять выбор" }).first().click();
      const purchase = page.locator("details[data-auction-purchase]").first();
      const lotChecks = purchase.locator("tbody input[type=checkbox]");
      for (const i of [0, 1, 2]) await lotChecks.nth(i).check();
      await tot.getByRole("button", { name: /^Фильтр/ }).click();
      await tot.getByPlaceholder("Часть номера").fill("U1");
      const hid = tot.locator("[data-hidden-selection]");
      await expect(hid).toContainText("Выбрано 3 (из них скрыто фильтром 2)");
      await hid.getByRole("button", { name: "Снять выбор" }).click();
      await expect(hid).toHaveCount(0);
      await tot.getByRole("button", { name: "Сбросить", exact: true }).click();

      // красная подсветка некорректного «от/до»
      const qty = tot.locator("label, div").filter({ hasText: /^Кол-во/ }).first();
      void qty;
      const from = tot.locator('input[placeholder="от"]').first();
      await from.fill("abc");
      await expect(from).toHaveAttribute("aria-invalid", "true");
      await expect(from, "красная подсветка").toHaveClass(/border-red-500/);
      expect(await from.evaluate((e) => getComputedStyle(e).borderColor), "цвет рамки отличается от обычного").not.toBe(await tot.locator('input[placeholder="до"]').first().evaluate((e) => getComputedStyle(e).borderColor));
      await expect(tot.getByText("Некорректное число — фильтр не действует").first()).toBeVisible();
      await expect(tot.getByRole("button", { name: /^Фильтр \(\d+\)/ }), "некорректная граница не считается активным фильтром").toHaveCount(0);
      await from.fill("1,5");
      await expect(from).toHaveAttribute("aria-invalid", "false");

      // 0 лотов: «Σ 0»
      await from.fill("999999");
      await expect(tot.locator("[data-selection-label]")).toContainText("Отфильтровано 0 лотов из 6");
      const row0 = (await tot.locator(SEL.totalsRow).locator(":scope > td").allInnerTexts()).map(norm);
      expect(row0.filter((c) => /^Σ\s*0$/.test(c)).length, `итог при 0 лотов: ${row0.join(" | ")}`).toBeGreaterThanOrEqual(2);
      expect(norm((await tot.locator("[data-totals-summary]").textContent()) ?? "")).toMatch(/Итого: Σ 0/);
      expect(norm(await page.locator("body").innerText())).not.toMatch(/NaN|undefined|Infinity/);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("смешанные валюты: «разные валюты» в итогах и сводке телефона", async ({ page }) => {
    cleanRg();
    mkAuction("RG-CUR", [{ lot: "C1", qty: 10, price: 100 }, { lot: "C2", qty: 5, price: 50 }], { cur: "USD", rate: 90 });
    // копия закупки в EUR внутри того же аукциона
    mkAuction("RG-CUR", [{ lot: "C3", qty: 4, price: 80 }], { cur: "EUR", rate: 100, suffix: "_eur" });
    const errors = watchErrors(page);
    await loginAs(page, "anna@qa-test.ru");
    await page.goto(lotsUrl("RG-CUR"));
    const tot = page.locator("section[data-auction-totals]");
    await expect(tot).toBeVisible();
    const row = (await tot.locator("tfoot tr[data-totals-row] > td").allInnerTexts()).map(norm);
    expect(row.filter((c) => c.includes("разные валюты")).length, `итог: ${row.join(" | ")}`).toBeGreaterThanOrEqual(1);
    await expect(tot.locator("thead")).toContainText("вал.");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    const sum = norm(await page.locator("section[data-auction-totals] [data-totals-summary]").innerText());
    expect(sum).toMatch(/Итого/);
    expect(sum).toMatch(/разные валюты/);
    // выбрав лоты одной валюты, видим средний курс
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    const t2 = page.locator("section[data-auction-totals]");
    await t2.getByRole("button", { name: /^Фильтр/ }).click();
    await t2.getByPlaceholder("Часть номера").fill("C3");
    const r2 = (await t2.locator("tfoot tr[data-totals-row] > td").allInnerTexts()).map(norm);
    expect(r2.join(" | ")).not.toMatch(/разные валюты/);
    expect(r2.join(" | ")).toMatch(/ср\.\s*100/i);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("мобильная вёрстка 375×812: нет горизонтального скролла при открытой панели «Фильтр»; «Итого» в сводке; цели нажатия ≥ 32 px", async ({ page }) => {
    cleanRg();
    const { items } = mkAuction("RG-MOB", lots6);
    const errors = watchErrors(page);
    await loginAs(page, "anna@qa-test.ru");
    const fNum = await mkField(page, "RG-мобильный-числовой-столбец", "NUMBER");
    await mkField(page, "RG-мобильный-текст", "TEXT");
    await act(page, "setCustomValue", [items[0], fNum, "12,5"]);
    await page.setViewportSize({ width: 375, height: 812 });
    for (const mode of ["incl", "excl"] as const) {
      await setVat(page, mode);
      await page.goto(lotsUrl("RG-MOB"));
      const tot = page.locator("section[data-auction-totals]");
      await expect(tot).toBeVisible();
      const noHScroll = () => page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, cw: document.documentElement.clientWidth }));
      let m = await noHScroll();
      expect(m.sw, `без панели: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.cw);
      await tot.getByRole("button", { name: /^Фильтр/ }).click();
      await expect(tot.getByPlaceholder("Часть номера")).toBeVisible();
      m = await noHScroll();
      expect(m.sw, `с панелью «Фильтр»: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.cw);
      // открыта и панель счёта
      const d = page.locator("details[data-auction-purchase]").first();
      await d.getByRole("button", { name: /^Фильтр/ }).click();
      m = await noHScroll();
      expect(m.sw, `панели аукциона и счёта: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.cw);
      // состояние с выбором и фильтром: появляются «Снять выбор (N)», «Сбросить», строка про скрытый выбор
      const ch = d.locator("tbody input[type=checkbox]");
      for (const i of [0, 1, 2]) await ch.nth(i).check();
      await tot.getByPlaceholder("Часть номера").fill("U1");
      await expect(tot.locator("[data-hidden-selection]")).toBeVisible();
      m = await noHScroll();
      expect(m.sw, `с выбором и фильтром: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.cw);
      // свёрнутый MobileSummary с «Итого»
      const sm = norm(await tot.locator("[data-totals-summary]").first().innerText());
      expect(sm).toMatch(/^Итого:/);
      expect(sm).toMatch(/шкур/);
      await expect(tot.locator("[data-totals-summary]").first()).toBeVisible();
      // цели нажатия: все видимые кнопки/ссылки/чекбоксы/селекты панели управления
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const roots = Array.from(document.querySelectorAll("section[data-auction-totals], details[data-auction-purchase][open]"));
        for (const root of roots) {
          for (const e of Array.from(root.querySelectorAll("button, a[href], select, input:not([type=hidden]), summary"))) {
            const el = e as HTMLElement;
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            let r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // чекбокс: нажимаемая область — оборачивающий label
            if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
              const l = el.closest("label");
              if (l) r = l.getBoundingClientRect();
            }
            if (r.height < 31.5 || r.width < 31.5) out.push(`${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 30)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return out;
      });
      expect.soft(small, `[${mode}] цели нажатия меньше 32 px`).toEqual([]);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("«Не разложено» скрыто при |остатке| < 1 ₽ (СП 03.25, «С НДС»); показывается, когда остаток ≥ 1 ₽", async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, "anna@qa-test.ru");
    const unresolved = async (mode: "incl" | "excl") => {
      await setVat(page, mode);
      await page.goto(lotsUrl("СП 03.25"));
      await expect(page.locator("section[data-auction-totals]")).toBeVisible();
      const parts = page.locator("[data-cost-parts]");
      const n = await parts.count();
      expect(n).toBeGreaterThan(0);
      const found: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = norm((await parts.nth(i).textContent()) ?? "");
        expect(t, `[${mode}] блок ${i}`).toMatch(/Сумма частей .* = итогу/);
        const m = t.match(/Не разложено.*?остаток до полной стоимости(-?[\d  ]+,\d\d) ₽/);
        if (m) found.push(Number(m[1].replace(/[\s]/g, "").replace(",", ".")));
      }
      return found;
    };
    const incl = await unresolved("incl");
    expect(incl, "«С НДС»: остаток < 1 ₽ не показывается").toEqual([]);
    const excl = await unresolved("excl");
    for (const v of excl) expect(Math.abs(v), `«Без НДС»: показан «Не разложено» ${v} ₽ — допустимо только при |остатке| ≥ 1 ₽`).toBeGreaterThanOrEqual(1);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
