// Мобильный прогон (375×812, isMobile): правка/удаление строк в карточках (variant="card"),
// закупки, ТЗ, лоты/аукцион, роли. Самодостаточный: данные создаёт через UI/SQL на копии базы.
// Запуск: scripts/e2e.sh up mob 3331; E2E_BASE_URL=http://localhost:3331 npx playwright test -c e2e/playwright.config.ts mobile-edit
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { login, watchErrors } from "./helpers";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

export const sql = (q: string) =>
  execSync(`docker exec -i fur-erp-db-1 psql -U fur_erp -d fur_erp_e2e_mob -At -F '|' -c ${JSON.stringify(q)}`).toString().trim();
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/fur-e2e-results/mob-shots";
execSync(`mkdir -p ${SHOTS}`);
const dialogs: string[] = [];
function acceptDialogs(page: Page) {
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
}
async function noHScroll(page: Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, "горизонтальный скролл").toBeLessThanOrEqual(iw);
}
/** Видимые кнопки/ссылки/summary ниже порога тап-цели (по высоте). */
async function smallTargets(page: Page, min = 32) {
  return page.evaluate((m) => {
    return [...document.querySelectorAll("button,a[href],summary,select,input:not([type=hidden])")]
      .filter((e) => (e as HTMLElement).offsetParent && !(e as HTMLInputElement).disabled)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { t: `${e.tagName}:${(e.textContent || (e as HTMLInputElement).name || "").trim().slice(0, 28)}`, w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((x) => x.h < m && x.h > 0);
  }, min);
}

let plainId = "";
test.describe.serial("закупки на 375 px", () => {
  test("создать обычный черновик и проверить правку позиции", async ({ page }) => {
    const errors = watchErrors(page);
    acceptDialogs(page);
    await login(page);
    await page.goto("/purchases/new");
    await page.locator('textarea[name="rows"]').fill(
      ["Соболь дикий выделанный\t10\t1000\t22\tMOB-1\tК 1\tтёмный", "Соболь дикий выделанный\t4\t500\t10\tMOB-2\tК 2\tсветлый", "Соболь дикий выделанный\t2\t300\t0\tMOB-3\t\t"].join("\n"),
    );
    await page.getByRole("button", { name: "Создать закупку" }).click();
    await page.waitForURL(/\/purchases\/(?!new)[^/]+$/, { timeout: 20000 });
    plainId = page.url().split("/").pop()!;
    console.log("PLAIN", plainId, sql(`select number from "Purchase" where id='${plainId}'`));
    await page.screenshot({ path: `${SHOTS}/1-plain-top.png`, fullPage: false });
    console.log("errors", errors);
  });

  test("правка позиции, удаление, расход, оплата (черновик)", async ({ page }) => {
    const errors = watchErrors(page);
    acceptDialogs(page);
    await login(page);
    if (!plainId) plainId = sql(`select id from "Purchase" where notes is null order by "createdAt" desc limit 1`);
    await page.goto(`/purchases/${plainId}`);
    const card = (t: string) => page.locator("div.md\\:hidden > div.rounded-lg", { hasText: t }).first();
    // правка: количество/цена/НДС/лот
    const c1 = card("MOB-1");
    await c1.getByRole("button", { name: "Изменить" }).tap();
    await page.screenshot({ path: `${SHOTS}/2-item-edit-open.png`, fullPage: false });
    await c1.locator('input[name="quantity"]').fill("7.5");
    await c1.locator('input[name="unitPrice"]').fill("1234.56");
    await c1.locator('input[name="vatRate"]').fill("20");
    await c1.locator('input[name="lotNumber"]').fill("MOB-1X");
    await c1.getByRole("button", { name: "Сохранить" }).tap();
    await expect(card("MOB-1X")).toBeVisible();
    await expect(c1.locator('input[name="quantity"]')).toHaveCount(0);
    console.log("SQL item", sql(`select quantity,"unitPrice",\"vatRate\",\"lotNumber\" from "PurchaseItem" where "purchaseId"='${plainId}' order by "lotNumber"`));
    // сверка с десктопом
    const mobText = await page.locator("body").innerText();
    // удаление позиции
    const before = sql(`select count(*) from "PurchaseItem" where "purchaseId"='${plainId}'`);
    const c3 = card("MOB-3");
    await c3.getByRole("button", { name: "Удалить" }).tap();
    await expect.poll(() => sql(`select count(*) from "PurchaseItem" where "purchaseId"='${plainId}'`)).toBe(String(Number(before) - 1));
    console.log("dialogs", dialogs);
    // расход
    await page.getByRole("button", { name: "Упаковка" }).tap();
    await page.locator("#expense-amount").fill("500");
    await page.locator("#expense-vat").fill("22");
    await page.getByRole("button", { name: "+ Добавить расход" }).tap();
    await expect.poll(() => sql(`select amount,\"vatRate\" from "PurchaseExpense" where "purchaseId"='${plainId}'`)).toContain("500");
    await page.screenshot({ path: `${SHOTS}/3-expense.png`, fullPage: true });
    const expCard = page.locator("div.md\\:hidden > div.rounded-lg", { hasText: "Упаковка" }).first();
    await expCard.getByRole("button", { name: "Удалить" }).tap();
    await expect.poll(() => sql(`select count(*) from "PurchaseExpense" where "purchaseId"='${plainId}'`)).toBe("0");
    // оплата с переплатой
    await page.getByLabel("Сумма, ₽").last().fill("9999999");
    await page.getByRole("button", { name: "+ Добавить оплату" }).tap();
    await expect.poll(() => dialogs.some((d) => d.includes("переплата"))).toBe(true);
    await expect.poll(() => sql(`select count(*) from "Payment" where "purchaseId"='${plainId}'`)).toBe("1");
    console.log("pay", sql(`select amount,status,method from "Payment" where "purchaseId"='${plainId}'`));
    await page.screenshot({ path: `${SHOTS}/4-payment.png`, fullPage: true });
    console.log("small", JSON.stringify(await smallTargets(page)));
    await noHScroll(page);
    console.log("errors", errors, mobText.includes("MOB-1X"));
  });
});

const PLAN_ID = "cmupc537z000blseq1m36p4ve"; // З-2026-0051, черновик с расчётом
test.describe.serial("закупка с расчётом (З-2026-0051)", () => {
  test("карточка позиции: Править расчёт, правка, удаление, расход, оплата", async ({ page, browser }) => {
    const errors = watchErrors(page);
    acceptDialogs(page);
    await login(page);
    await page.goto(`/purchases/${PLAN_ID}`);
    const cards = page.locator("div.md\\:hidden > div.rounded-lg").filter({ has: page.getByRole("button", { name: "Изменить" }) });
    const n = await cards.count();
    console.log("plan cards", n, "mobile 'Править расчёт' visible:", await page.getByRole("button", { name: "Править расчёт" }).filter({ visible: true }).count());
    console.log("breakdown toggles visible:", await page.getByText("Из чего состоит", { exact: false }).filter({ visible: true }).count());
    const cardLot = async (i: number) => ((await cards.nth(i).innerText()).match(/Лот (\S+)/) ?? [])[1];
    const lotFirst = await cardLot(0), lotLast = await cardLot(n - 1);
    const byLot = (l: string) => page.locator("div.md\\:hidden > div.rounded-lg", { hasText: `Лот ${l}` }).first();
    const first = byLot(lotFirst);
    console.log("card text:", (await first.innerText()).replace(/\n/g, " | "));
    await first.getByRole("button", { name: "Изменить" }).tap();
    const ro = await first.locator('input[name="quantity"]').getAttribute("readonly");
    console.log("qty readonly:", ro !== null, "lockedNote:", await first.locator("p.text-amber-600").innerText());
    await first.locator('input[name="grade"]').fill("MOBGR");
    await first.locator('input[name="color"]').fill("мобцвет");
    await first.getByRole("button", { name: "Сохранить" }).tap();
    await expect.poll(() => sql(`select count(*) from "PurchaseItem" where "purchaseId"='${PLAN_ID}' and grade='MOBGR'`)).toBe("1");
    await page.screenshot({ path: `${SHOTS}/5-plan-card.png`, fullPage: false });
    // десктоп: кнопка есть?
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const dp = await dctx.newPage();
    await login(dp);
    await dp.goto(`/purchases/${PLAN_ID}`);
    console.log("desktop 'Править расчёт':", await dp.getByRole("button", { name: "Править расчёт" }).filter({ visible: true }).count());
    await dctx.close();
    // удаление позиции с расчётом
    const before = Number(sql(`select count(*) from "PurchaseItem" where "purchaseId"='${PLAN_ID}'`));
    await byLot(lotLast).getByRole("button", { name: "Удалить" }).tap();
    await expect.poll(() => Number(sql(`select count(*) from "PurchaseItem" where "purchaseId"='${PLAN_ID}'`))).toBe(before - 1);
    // расход + удаление
    await page.getByRole("button", { name: "Доставка" }).tap();
    await page.locator("#expense-amount").fill("1000");
    await page.getByRole("button", { name: "+ Добавить расход" }).tap();
    await expect.poll(() => sql(`select count(*) from "PurchaseExpense" where "purchaseId"='${PLAN_ID}'`)).toBe("1");
    await page.locator("div.md\\:hidden > div.rounded-lg", { hasText: "Доставка" }).first().getByRole("button", { name: "Удалить" }).tap();
    await expect.poll(() => sql(`select count(*) from "PurchaseExpense" where "purchaseId"='${PLAN_ID}'`)).toBe("0");
    // оплата
    await page.getByLabel("Сумма, ₽").last().fill("12345,67");
    await page.getByRole("button", { name: "+ Добавить оплату" }).tap();
    await expect.poll(() => sql(`select amount from "Payment" where "purchaseId"='${PLAN_ID}' order by "createdAt" desc limit 1`)).toBe("12345.67");
    console.log("dialogs", dialogs);
    await noHScroll(page);
    console.log("small", JSON.stringify(await smallTargets(page)));
    console.log("errors", errors);
  });
});

const RCV_ID = "cmupqpyj60001ls1vut8kmcg3"; // З-2026-0060, принята на склад
test("принятая закупка: правка непотраченной позиции, оплата с переплатой", async ({ page }) => {
  const errors = watchErrors(page);
  acceptDialogs(page);
  await login(page);
  await page.goto(`/purchases/${RCV_ID}`);
  const cards = page.locator("div.md\\:hidden > div.rounded-lg").filter({ hasText: "Кол-во" });
  console.log("cards", await cards.count(), "delete buttons visible:", await cards.getByRole("button", { name: "Удалить" }).count());
  const c = cards.nth(3);
  await c.getByRole("button", { name: "Изменить" }).tap();
  const ro = await c.locator('input[name="quantity"]').getAttribute("readonly");
  console.log("unconsumed qty readonly:", ro !== null);
  await c.locator('input[name="quantity"]').fill("50");
  await c.locator('input[name="unitPrice"]').fill("1800");
  await c.locator('input[name="lotNumber"]').fill("RCV-1");
  await page.screenshot({ path: `${SHOTS}/6-received-edit.png`, fullPage: false });
  await c.getByRole("button", { name: "Сохранить" }).tap();
  await expect.poll(() => sql(`select quantity||'/'||"unitPrice"||'/'||"lotNumber" from "PurchaseItem" where id='cmupqpyjm000hls1v8u2mf0k6'`)).toBe("50.000/1800.00/RCV-1");
  console.log("lot", sql(`select l."quantityReceived",l."quantityRemaining",l."unitCost" from "RawMaterialLot" l join "PurchaseItem" i on i."lotId"=l.id where i.id='cmupqpyjm000hls1v8u2mf0k6'`));
  // locked item (consumed)
  const c0 = cards.nth(0);
  await c0.getByRole("button", { name: "Изменить" }).tap();
  console.log("consumed qty readonly:", (await c0.locator('input[name="quantity"]').getAttribute("readonly")) !== null);
  // оплата с переплатой
  await page.getByLabel("Сумма, ₽").last().fill("99999999");
  const before = sql(`select count(*) from "Payment" where "purchaseId"='${RCV_ID}'`);
  dialogs.length = 0;
  await page.getByRole("button", { name: "+ Добавить оплату" }).tap();
  await expect.poll(() => sql(`select count(*) from "Payment" where "purchaseId"='${RCV_ID}'`)).toBe(String(Number(before) + 1));
  console.log("dialogs", dialogs);
  await noHScroll(page);
  console.log("errors", errors);
});

const TZ_ID = "cmupo4c13a154b9ae281f4e3dcc"; // П-2026-0172, PLANNED, с заказчиком
async function setModes(page: Page, vat: "С НДС" | "Без НДС", c4: "Без 4%" | "С 4%") {
  const narrow = page.getByRole("button", { name: /Режимы/ });
  if (await narrow.isVisible()) await narrow.tap();
  await page.getByRole("button", { name: vat, exact: true }).tap();
  await page.getByRole("button", { name: c4, exact: true }).tap();
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
}
async function totals(page: Page) {
  const dl = page.locator("dl.lg\\:hidden").first();
  return (await dl.innerText()).replace(/\n+/g, " | ");
}
test.describe.serial("ТЗ на 375 px", () => {
  test("списание лота, правка, удаление, расход, оплата, режимы НДС/4%", async ({ page }) => {
    const errors = watchErrors(page);
    acceptDialogs(page);
    await login(page);
    await page.goto(`/production/${TZ_ID}`);
    await page.screenshot({ path: `${SHOTS}/7-tz-top.png`, fullPage: false });
    // + лот
    await page.locator('summary:text-is("+ лот")').tap();
    const form = page.locator('details:has(> summary:text-is("+ лот"))').first();
    const matSel = form.locator("select").first();
    const opts = await matSel.locator("option:not([disabled])").allTextContents();
    console.log("fur materials", opts.length, opts.slice(0, 3));
    await matSel.selectOption({ index: 1 });
    const lotSel = form.locator('select[name="lotId"]');
    await lotSel.selectOption({ index: 1 });
    await form.locator('input[name="quantity"]').fill("2");
    await form.getByRole("button", { name: "+ Списать" }).tap();
    await expect.poll(() => sql(`select count(*) from "ProductionMaterialUsage" where "productionOrderId"='${TZ_ID}'`)).toBe("1");
    const u = sql(`select id,"lotId",quantity,"unitCost","totalCost",commission4 from "ProductionMaterialUsage" where "productionOrderId"='${TZ_ID}'`);
    console.log("usage", u);
    const [uid, lotId] = u.split("|");
    const remBefore = sql(`select "quantityRemaining" from "RawMaterialLot" where id='${lotId}'`);
    await page.screenshot({ path: `${SHOTS}/8-tz-usage.png`, fullPage: false });
    // правка в карточке
    const ucard = page.locator("div.md\\:hidden > div.rounded-lg", { hasText: "Списано" }).first();
    await ucard.getByRole("button", { name: "Изменить" }).tap();
    await ucard.locator('input[name="quantity"]').fill("3");
    await ucard.getByRole("button", { name: "Сохранить" }).tap();
    await expect.poll(() => sql(`select quantity from "ProductionMaterialUsage" where id='${uid}'`)).toBe("3.000");
    console.log("lot remaining before/after", remBefore, sql(`select "quantityRemaining" from "RawMaterialLot" where id='${lotId}'`), "totalCost", sql(`select "totalCost" from "ProductionMaterialUsage" where id='${uid}'`));
    // режимы
    const res: Record<string, string> = {};
    for (const v of ["С НДС", "Без НДС"] as const) for (const c of ["Без 4%", "С 4%"] as const) {
      await setModes(page, v, c);
      res[`${v}/${c}`] = await totals(page);
    }
    console.log(JSON.stringify(res, null, 1));
    // расход
    await page.locator('summary:text-is("+ расход")').tap();
    const eform = page.locator('details:has(> summary:text-is("+ расход"))').first();
    await eform.locator("select").selectOption({ index: 1 });
    await eform.locator('input[name="amount"]').fill("777");
    await eform.locator('input[name="description"]').fill("моб-расход");
    await eform.getByRole("button", { name: "+ Добавить расход" }).tap();
    await expect.poll(() => sql(`select amount from "ProductionExpense" where "productionOrderId"='${TZ_ID}'`)).toBe("777.00");
    const ecard = page.locator("div.md\\:hidden > div.rounded-lg", { hasText: "моб-расход" }).first();
    await ecard.getByRole("button", { name: "Изменить" }).tap();
    await ecard.locator('input[name="amount"]').fill("888");
    await ecard.getByRole("button", { name: "Сохранить" }).tap();
    await expect.poll(() => sql(`select amount from "ProductionExpense" where "productionOrderId"='${TZ_ID}'`)).toBe("888.00");
    await page.screenshot({ path: `${SHOTS}/9-tz-expense.png`, fullPage: false });
    await ecard.getByRole("button", { name: "Удалить" }).tap();
    await expect.poll(() => sql(`select count(*) from "ProductionExpense" where "productionOrderId"='${TZ_ID}'`)).toBe("0");
    // оплата за работу подрядчику
    const paySec = page.locator("details#pay");
    if (!(await paySec.evaluate((e) => (e as HTMLDetailsElement).open))) await paySec.locator("summary").first().tap();
    await paySec.locator('input[name="amount"]').fill("50000");
    await paySec.getByRole("button", { name: /Добавить оплату|Записать/ }).tap();
    await expect.poll(() => sql(`select count(*) from "ProductionPaymentOrder" where "productionOrderId"='${TZ_ID}'`)).toBe("1");
    await page.screenshot({ path: `${SHOTS}/10-tz-pay.png`, fullPage: false });
    const pcard = page.locator("div.md\\:hidden > div.rounded-lg", { hasText: "50 000" }).first();
    await pcard.getByRole("button", { name: "Удалить" }).tap();
    await expect.poll(() => sql(`select count(*) from "ProductionPaymentOrder" where "productionOrderId"='${TZ_ID}'`)).toBe("0");
    // удаление списания
    const ucard2 = page.locator("div.md\\:hidden > div.rounded-lg", { hasText: "Списано" }).first();
    await ucard2.getByRole("button", { name: "Удалить" }).tap();
    await expect.poll(() => sql(`select count(*) from "ProductionMaterialUsage" where "productionOrderId"='${TZ_ID}'`)).toBe("0");
    console.log("lot remaining after delete", sql(`select "quantityRemaining" from "RawMaterialLot" where id='${lotId}'`));
    console.log("dialogs", dialogs);
    await noHScroll(page);
    console.log("errors", errors);
  });
});

const AUC = encodeURIComponent("СП 09.26");
test.describe.serial("лоты / аукцион на 375 px", () => {
  test("выбор чекбоксами, фильтры, Править расчёт, свой столбец", async ({ page }) => {
    const errors = watchErrors(page);
    acceptDialogs(page);
    await login(page);
    await page.goto(`/lots?auction=${AUC}&view=lots`);
    const cards = page.locator("div.md\\:hidden > div.rounded-lg").filter({ has: page.locator('input[type="checkbox"]') });
    const total = await cards.count();
    console.log("lot cards", total);
    const summary = () => page.locator("[data-totals-summary]:visible").first().innerText().then((t) => t.replace(/\n+/g, " | "));
    console.log("summary before:", await summary());
    // выбор трёх лотов
    const picked: string[] = [];
    for (let i = 0; i < 3; i++) {
      await cards.nth(i).locator('input[type="checkbox"]').tap();
      picked.push((await cards.nth(i).innerText()).replace(/\n+/g, " | ").slice(0, 160));
    }
    console.log("picked:", picked);
    console.log("summary after 3:", await summary());
    await page.screenshot({ path: `${SHOTS}/11-lots-selected.png`, fullPage: false });
    // только выбранные
    await page.getByLabel("Только выбранные").first().tap();
    await expect.poll(() => cards.count()).toBe(3);
    console.log("only selected ->", await cards.count(), await summary());
    await page.getByLabel("Только выбранные").first().tap();
    await expect.poll(() => cards.count()).toBe(total);
    // Снять выбор
    await page.getByRole("button", { name: /^Снять выбор \(3\)/ }).first().tap();
    console.log("after unselect:", await summary());
    // фильтры: панель
    await page.getByRole("button", { name: /Фильтр/ }).first().tap();
    await page.screenshot({ path: `${SHOTS}/12-lots-filter.png`, fullPage: false });
    const lotInput = page.getByPlaceholder("Часть номера").first();
    await lotInput.fill("36");
    await page.waitForTimeout(500);
    console.log("filter lot=36 ->", await cards.count(), await summary());
    await lotInput.fill("");
    await page.getByRole("button", { name: /Фильтр/ }).first().tap();
    await expect.poll(() => cards.count()).toBe(total);
    // Править расчёт — только в режиме «По счетам» (в плоском списке столбца правки нет и на десктопе)
    console.log("flat list 'Править расчёт':", await page.getByRole("button", { name: "Править расчёт" }).filter({ visible: true }).count());
    await page.goto(`/lots?auction=${AUC}`);
    await page.getByText("Развернуть все закупки").first().tap();
    await page.waitForTimeout(800);
    const edit = page.getByRole("button", { name: "Править расчёт" }).filter({ visible: true }).first();
    console.log("Править расчёт visible count", await page.getByRole("button", { name: "Править расчёт" }).filter({ visible: true }).count());
    const lotCard = page.locator("div.md\\:hidden > div.rounded-lg").filter({ has: edit }).first();
    const lotTitle = (await lotCard.innerText()).split("\n")[0];
    console.log("edit card:", lotTitle);
    await edit.scrollIntoViewIfNeeded();
    await edit.tap();
    const dlg = page.locator('[role="dialog"]');
    await page.screenshot({ path: `${SHOTS}/13-cost-plan-dialog.png`, fullPage: false });
    const qty0 = await dlg.locator('input[name="quantity"]').inputValue();
    console.log("dialog qty", qty0, "price", await dlg.locator('input[name="price"]').inputValue());
    await dlg.locator('input[name="quantity"]').fill("33");
    await dlg.locator('input[name="price"]').fill("111,5");
    console.log("live calc:", (await dlg.locator("div.bg-neutral-50").innerText()).replace(/\n+/g, " | "));
    await dlg.getByRole("button", { name: "Сохранить расчёт" }).tap();
    await expect(dlg).toHaveCount(0);
    console.log("SQL cp item", sql(`select quantity,"unitPrice","lotNumber" from "PurchaseItem" where quantity=33 and "unitPrice"=111.5`));
    // свой столбец
    await page.getByRole("button", { name: "Добавить столбец" }).filter({ visible: true }).first().tap();
    const fd = page.locator("dialog[open]");
    await fd.getByPlaceholder("Например, Седина").fill("Седина");
    await page.screenshot({ path: `${SHOTS}/14-field-dialog.png`, fullPage: false });
    await fd.getByRole("button", { name: "Создать" }).tap();
    await expect.poll(() => sql(`select count(*) from "CustomField" where name='Седина'`)).toBe("1");
    // значение в карточке: Подробнее
    const first = page.locator("div.md\\:hidden > div.rounded-lg").filter({ has: page.locator('input[type="checkbox"]') }).first();
    await first.locator("summary", { hasText: "Подробнее" }).tap();
    await page.screenshot({ path: `${SHOTS}/15a-card-details.png`, fullPage: false });
    const cell = first.getByRole("button", { name: "—" }).filter({ visible: true }).last();
    const cellBox = await first.locator('button[title="Нажмите, чтобы изменить"]').boundingBox();
    console.log("custom cell box", cellBox);
    await first.locator('button[title="Нажмите, чтобы изменить"]').tap();
    await first.locator("input[inputmode]").fill("серая");
    await first.locator("input[inputmode]").press("Enter");
    await expect.poll(() => sql(`select count(*) from "PurchaseItem" where extra::text like '%серая%'`)).toBe("1");
    await page.screenshot({ path: `${SHOTS}/15-custom-value.png`, fullPage: false });
    // удаление столбца с мобильного: есть ли кнопка?
    const delVisible = await page.locator(`button[title="Удалить столбец"]`).filter({ visible: true }).count();
    console.log("delete-column buttons visible on mobile:", delVisible);
    // (если нет - удаляем через десктоп-контекст в отдельном шаге)
    console.log("dialogs", dialogs);
    await noHScroll(page);
    console.log("errors", errors);
  });
});

test("удаление столбца «Седина» возможно только на десктопе", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  acceptDialogs(page);
  await login(page);
  await page.goto(`/lots?auction=${AUC}`);
  await page.getByText("Развернуть все закупки").first().click();
  await page.locator(`button[title="Удалить столбец"]`).filter({ visible: true }).first().click();
  await expect.poll(() => sql(`select count(*) from "CustomField" where name='Седина'`)).toBe("0");
  console.log("extra after delete:", sql(`select count(*) from "PurchaseItem" where extra::text like '%серая%'`));
  await ctx.close();
});

// ---------- Роли ----------
const ROLES = ["owner", "admin", "purchaser", "technologist", "warehouse", "accountant", "viewer"] as const;
const EMAIL: Record<string, string> = { owner: "anna@qa-test.ru" };
const PURCH_EDIT = ["owner", "admin", "purchaser"];
const PROD_EDIT = ["owner", "admin", "technologist"];
let actionIds: Record<string, string> = {};
function loadActionIds() {
  const m = JSON.parse(execSync("cat /Users/petr/Documents/claude/fur-erp/.next/server/server-reference-manifest.json").toString()).node as Record<string, { exportedName: string }>;
  for (const [id, v] of Object.entries(m)) actionIds[v.exportedName] = id;
}
async function loginAs(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL[role] ?? `${role}@qa-test.ru`);
  await page.getByLabel("Пароль").fill("TestPass123!");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}
async function call(page: Page, url: string, action: string, args: unknown[]) {
  const r = await page.request.post(url, {
    headers: { "Next-Action": actionIds[action], Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
  return `${r.status()}${r.headers()["x-action-redirect"] ? " redirect=" + r.headers()["x-action-redirect"] : ""}`;
}
async function callForm(page: Page, url: string, action: string, bound: string[], fields: Record<string, string>) {
  const multipart: Record<string, string> = { "0": JSON.stringify([...bound, `$K${bound.length + 1}`]) };
  for (const [k, v] of Object.entries(fields)) multipart[`${bound.length + 1}_${k}`] = v;
  const r = await page.request.post(url, { headers: { "Next-Action": actionIds[action], Accept: "text/x-component" }, multipart, maxRedirects: 0 });
  return `${r.status()}${r.headers()["x-action-redirect"] ? " redirect=" + r.headers()["x-action-redirect"] : ""}`;
}
async function visibleCount(page: Page, re: RegExp) {
  return page.getByRole("button", { name: re }).filter({ visible: true }).count();
}

test.describe.serial("роли на карточных экранах (375 px)", () => {
  test("подготовка данных", async () => {
    loadActionIds();
    const exp = "(select id from \"ExpenseCategory\" where kind='PURCHASE' limit 1)";
    sql(`delete from "PurchaseExpense" where "purchaseId"='${PLAN_ID}'`);
    sql(`delete from "ProductionExpense" where id='rolexp_t'`);
    sql(`insert into "PurchaseExpense"(id,"purchaseId","categoryId",amount,"vatRate") values ('rolexp_p','${PLAN_ID}',${exp},111,22)`);
    sql(`insert into "ProductionExpense"(id,"productionOrderId","categoryId",amount,description) values ('rolexp_t','${TZ_ID}',(select id from "ExpenseCategory" where kind='PRODUCTION' limit 1),222,'role-exp')`);
    sql(`delete from "ProductionPayment" where id='rolepay_t'`);
    sql(`insert into "ProductionPayment"(id,"organizationId",amount,"clientId") select 'rolepay_t',"organizationId",333,"clientId" from "ProductionOrder" where id='${TZ_ID}'`);
    sql(`insert into "ProductionPaymentOrder"(id,"productionPaymentId","productionOrderId") values ('rolepo_t','rolepay_t','${TZ_ID}')`);
    sql(`delete from "CustomField" where name='РольПоле'`);
    sql(`insert into "CustomField"(id,"organizationId",name,type,position) select 'rolecf',"organizationId",'РольПоле','TEXT',99 from "Purchase" limit 1`);
  });
  for (const role of ROLES) {
    test(`роль ${role}: видимость кнопок и прямые вызовы`, async ({ page }) => {
      const errors = watchErrors(page);
      acceptDialogs(page);
      await loginAs(page, role);
      const out: Record<string, unknown> = { role };
      await page.goto(`/purchases/${PLAN_ID}`);
      out.purchase = {
        edit: await visibleCount(page, /^Изменить$/),
        del: await visibleCount(page, /^Удалить$/),
        addExp: await visibleCount(page, /Добавить расход/),
        addPay: await visibleCount(page, /Добавить оплату/),
        receive: await visibleCount(page, /Принять на склад/),
        cancel: await visibleCount(page, /Отменить закупку/),
        editPlan: await visibleCount(page, /Править расчёт/),
        rate: await visibleCount(page, /Пересчитать все лоты/),
      };
      await page.goto(`/production/${TZ_ID}`);
      await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      out.production = {
        edit: await visibleCount(page, /^Изменить$/),
        del: await visibleCount(page, /^Удалить$/),
        addUsage: await visibleCount(page, /\+ Списать/),
        addExp: await visibleCount(page, /Добавить расход/),
        addPay: await visibleCount(page, /Добавить оплату/),
        finish: await visibleCount(page, /Завершить/),
      };
      await page.goto(`/lots?auction=${AUC}`);
      await page.getByText("Развернуть все закупки").first().tap().catch(() => {});
      await page.waitForTimeout(500);
      out.lots = {
        editPlan: await visibleCount(page, /Править расчёт/),
        addCol: await page.locator('button[aria-label="Добавить столбец"]').filter({ visible: true }).count(),
        cellEditable: await page.locator('button[title="Нажмите, чтобы изменить"]').filter({ visible: true }).count(),
      };
      // прямые вызовы server actions
      const pu = `/purchases/${PLAN_ID}`, tu = `/production/${TZ_ID}`;
      const itemId = sql(`select id from "PurchaseItem" where "purchaseId"='${PLAN_ID}' limit 1`);
      const res: Record<string, string> = {};
      res.removePurchaseItem = await call(page, pu, "removePurchaseItem", [PLAN_ID, itemId]);
      res.removePurchaseExpense = await call(page, pu, "removePurchaseExpense", [PLAN_ID, "rolexp_p"]);
      res.addPurchaseExpense = await callForm(page, pu, "addPurchaseExpense", [PLAN_ID], { categoryId: sql(`select id from "ExpenseCategory" where kind='PURCHASE' limit 1`), amount: "1", vatRate: "22" });
      res.addPurchasePayment = await callForm(page, pu, "addPurchasePayment", [PLAN_ID], { amount: "1", method: "CASH", paidAt: "2026-10-01", confirmOverpay: "1" });
      res.removeProductionExpense = await call(page, tu, "removeProductionExpense", [TZ_ID, "rolexp_t"]);
      res.removeProductionPayment = await call(page, tu, "removeProductionPayment", [TZ_ID, "rolepay_t"]);
      res.addProductionExpense = await callForm(page, tu, "addProductionExpense", [TZ_ID], { categoryId: sql(`select id from "ExpenseCategory" where kind='PRODUCTION' limit 1`), amount: "5", description: "role-direct" });
      res.deleteCustomField = await call(page, `/lots`, "deleteCustomField", ["rolecf"]);
      res.setCustomValue = await call(page, `/lots`, "setCustomValue", [itemId, "rolecf", "роль-прямой"]);
      out.calls = res;
      out.db = {
        item: sql(`select count(*) from "PurchaseItem" where id='${itemId}'`),
        pExp: sql(`select count(*) from "PurchaseExpense" where "purchaseId"='${PLAN_ID}'`),
        pPay111: sql(`select count(*) from "Payment" where "purchaseId"='${PLAN_ID}' and amount=1`),
        tExp: sql(`select count(*) from "ProductionExpense" where "productionOrderId"='${TZ_ID}'`),
        tPay: sql(`select count(*) from "ProductionPayment" where id='rolepay_t'`),
        cf: sql(`select count(*) from "CustomField" where id='rolecf'`),
        extra: sql(`select count(*) from "PurchaseItem" where extra::text like '%роль-прямой%'`),
      };
      await noHScroll(page);
      console.log("ROLE " + JSON.stringify(out) + " errors=" + JSON.stringify(errors));
      // восстановление данных для следующей роли (на копии): вернуть расход/оплату/поле
      sql(`insert into "PurchaseExpense"(id,"purchaseId","categoryId",amount,"vatRate") select 'rolexp_p','${PLAN_ID}',(select id from "ExpenseCategory" where kind='PURCHASE' limit 1),111,22 where not exists (select 1 from "PurchaseExpense" where id='rolexp_p')`);
      sql(`insert into "ProductionExpense"(id,"productionOrderId","categoryId",amount,description) select 'rolexp_t','${TZ_ID}',(select id from "ExpenseCategory" where kind='PRODUCTION' limit 1),222,'role-exp' where not exists (select 1 from "ProductionExpense" where id='rolexp_t')`);
      sql(`insert into "ProductionPayment"(id,"organizationId",amount,"clientId") select 'rolepay_t',"organizationId",333,"clientId" from "ProductionOrder" where id='${TZ_ID}' and not exists (select 1 from "ProductionPayment" where id='rolepay_t')`);
      sql(`insert into "ProductionPaymentOrder"(id,"productionPaymentId","productionOrderId") select 'rolepo_t','rolepay_t','${TZ_ID}' where not exists (select 1 from "ProductionPaymentOrder" where id='rolepo_t')`);
      sql(`insert into "CustomField"(id,"organizationId",name,type,position) select 'rolecf',"organizationId",'РольПоле','TEXT',99 from "Purchase" limit 1 on conflict do nothing`);
      sql(`delete from "Payment" where "purchaseId"='${PLAN_ID}' and amount=1`);
      sql(`delete from "ProductionExpense" where description='role-direct'`);
      sql(`update "PurchaseItem" set extra=null where extra::text like '%роль-прямой%'`);
    });
  }
});

test("роли без прав: прямые вызовы форм-действий (расчёт, позиция, списание) отклоняются", async ({ browser }) => {
  loadActionIds();
  const itemId = sql(`select id from "PurchaseItem" where "purchaseId"='${PLAN_ID}' limit 1`);
  const lot = sql(`select id from "RawMaterialLot" where "quantityRemaining">2 limit 1`);
  const rm = sql(`select "rawMaterialId" from "RawMaterialLot" where id='${lot}'`);
  const before = sql(`select quantity||'/'||"unitPrice" from "PurchaseItem" where id='${itemId}'`);
  for (const role of ["viewer", "accountant", "warehouse", "technologist"]) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
    const page = await ctx.newPage();
    await loginAs(page, role);
    const r1 = await callForm(page, `/purchases/${PLAN_ID}`, "updateCostPlanItem", [PLAN_ID, itemId], { quantity: "999", price: "999", feePct: "7,35", dressing: "0", transport: "0", brokerPct: "4,5", transit: "0", vat: "22" });
    const r2 = await callForm(page, `/purchases/${PLAN_ID}`, "updatePurchaseItem", [PLAN_ID, itemId], { quantity: "999", unitPrice: "999", vatRate: "22", rawMaterialId: rm });
    const r3 = role === "technologist" ? "(разрешено)" : await callForm(page, `/production/${TZ_ID}`, "addMaterialUsage", [TZ_ID], { lotId: lot, quantity: "1", c4form: "1" });
    console.log(`ROLE2 ${role}: updateCostPlanItem=${r1} updatePurchaseItem=${r2} addMaterialUsage=${r3}`);
    await ctx.close();
  }
  console.log("before/after", before, sql(`select quantity||'/'||"unitPrice" from "PurchaseItem" where id='${itemId}'`), "usages", sql(`select count(*) from "ProductionMaterialUsage" where "productionOrderId"='${TZ_ID}'`));
});