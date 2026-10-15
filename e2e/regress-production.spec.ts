import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, TEST_USER } from "./helpers";

// Регрессия по разделу «ТЗ» (баг-репорт E2E). Самодостаточный спек: данные создаёт
// через интерфейс, а для того, чего из UI не сделать (роли, отмена «из-под» открытой
// страницы), ходит в SQL изолированной копии базы (scripts/e2e.sh up reg2 <порт>).
const DB = process.env.E2E_DB ?? "fur_erp_e2e_reg2";
function sql(q: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "fur-erp-db-1", "psql", "-U", "fur_erp", "-d", DB, "-At", "-c", q],
    { encoding: "utf8" }
  ).trim();
}
const BCRYPT = "$2b$10$4GjnSssJqUQKMd1CV4W48.ElNt4xt63QzGqtRFKhIb6GnMVT89.0G"; // TestPass123!
const num = (s: string) => Number(s.replace(/[\s  ]/g, "").replace("−", "-").replace(/[^\d,.\-]/g, "").replace(",", "."));

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}

type NewOrder = {
  model: string;
  qty?: string;
  lots?: string;
  client?: boolean;
  workPrice?: string;
  woNumber?: string;
  woDate?: string;
  size?: string;
};
async function createOrder(page: Page, o: NewOrder): Promise<string> {
  await page.goto("/production/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#modelText").fill(o.model);
  await page.locator("input[name=plannedQuantity]").fill(o.qty ?? "1");
  if (o.size) await page.locator("input[name=size]").fill(o.size);
  if (o.lots) await page.locator("textarea[name=lots]").fill(o.lots);
  if (o.client) await page.locator("select[name=clientId]").selectOption({ index: 1 });
  if (o.workPrice) await page.locator("input[name=clientWorkPricePerUnit]").fill(o.workPrice);
  if (o.woNumber) await page.locator("input[name=workOrderNumber]").fill(o.woNumber);
  if (o.woDate) await page.locator("summary", { hasText: "Дополнительно" }).click();
  if (o.woDate) await page.locator("input[name=workOrderDate]").fill(o.woDate);
  await page.getByRole("button", { name: "Создать ТЗ" }).click();
  await page.waitForURL(/\/production\/c[a-z0-9]{20,}$/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  return page.url().split("/").pop()!;
}
const statusOf = (id: string) => sql(`select status from "ProductionOrder" where id='${id}'`);

test.describe.serial("ТЗ: регрессия", () => {
  let noPriceModel = "";

  test.beforeAll(() => {
    noPriceModel = sql(`select name from "ProductModel" where "sellingPrice" is null and name ~ '^[A-Za-z0-9-]+$' limit 1`);
    const org = sql(`select "organizationId" from "User" where email='${TEST_USER.email}'`);
    for (const role of ["WAREHOUSE", "PURCHASER", "VIEWER", "ACCOUNTANT", "TECHNOLOGIST"]) {
      sql(
        `insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","createdAt","updatedAt") values ('rg_${role}','${org}','${role.toLowerCase()}@qa-test.ru','${BCRYPT}','${role}',` +
          `'${role}'::"UserRole",true,now(),now()) on conflict (email) do nothing`
      );
    }
  });

  test("(4) новое ТЗ наследует розничную цену модели; без цены — пусто", async ({ page }) => {
    await login(page);
    await page.goto("/production/new");
    await page.locator("#modelText").fill("M002A");
    await expect(page.getByText("Розничная цена модели: 19350000")).toBeVisible();
    const id = await createOrder(page, { model: "M002A", lots: "1 2" });
    expect(sql(`select "retailPrice" from "ProductionOrder" where id='${id}'`)).toBe("19350000.00");
    await expect(page.locator("#retailPrice")).toHaveValue("19350000");
    expect(noPriceModel).not.toBe("");
    const id2 = await createOrder(page, { model: noPriceModel });
    expect(sql(`select coalesce("retailPrice"::text,'NULL') from "ProductionOrder" where id='${id2}'`)).toBe("NULL");
    await expect(page.locator("#retailPrice")).toHaveValue("");
  });

  test("(5) пустая/нулевая/отрицательная розничная цена отклоняется, цена артикула цела", async ({ page }) => {
    await login(page);
    const id = await createOrder(page, { model: "M002A", lots: "1 1" });
    const before = sql(`select "sellingPrice" from "ProductModel" where name='M002A'`);
    await page.locator("#retailPrice").evaluate((i) => i.closest("form")!.setAttribute("novalidate", ""));
    for (const [v, msg] of [["", "Введите розничную цену"], ["0", "больше 0"], ["-5", "больше 0"]] as const) {
      await page.locator("#retailPrice").fill(v);
      await page.getByRole("button", { name: "Сохранить" }).click();
      await expect(page.getByText(msg).first()).toBeVisible();
      expect(sql(`select "sellingPrice" from "ProductModel" where name='M002A'`)).toBe(before);
      expect(sql(`select "retailPrice" from "ProductionOrder" where id='${id}'`)).toBe(before);
    }
  });

  test("(2) ТЗ без списаний можно отменить; кнопки «Завершить» в карточке нет", async ({ page }) => {
    await login(page);
    const dialogs: string[] = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    // ТЗ со списанием -> убираем списание: списаний нет
    const id = await createOrder(page, { model: "M002A", lots: "1 1" });
    await expect(page.getByRole("button", { name: "Завершить" })).toHaveCount(0);
    await page.getByRole("button", { name: "Удалить" }).first().click();
    await expect(page.getByText("Подкладка не указана")).toBeVisible();
    await page.waitForTimeout(800);
    expect(sql(`select count(*) from "ProductionMaterialUsage" where "productionOrderId"='${id}'`)).toBe("0");
    // Отмена
    await page.locator("summary", { hasText: "⋯" }).click();
    await page.getByRole("button", { name: "Отменить ТЗ" }).click();
    await expect(page.getByText("ТЗ отменено — списывать сырьё")).toBeVisible({ timeout: 10_000 });
    expect(statusOf(id)).toBe("CANCELLED");
  });

  test("(1) отменённое ТЗ: UI скрыт, сервер отказывает (сырьё, расход, оплата, пакет)", async ({ page }) => {
    await login(page);
    const id = await createOrder(page, { model: "M002A", client: true, workPrice: "1000" });
    expect(statusOf(id)).toBe("PLANNED");
    // Страница открыта, формы на месте; ТЗ отменяют «из другой вкладки»
    await page.locator("summary", { hasText: "+ расход" }).click();
    await page.locator("summary", { hasText: "+ лот" }).click();
    await page.getByText("Списать сразу несколько лотов").click();
    sql(`update "ProductionOrder" set status='CANCELLED' where id='${id}'`);
    // расход
    await page.locator("select[name=categoryId]").selectOption({ index: 1 });
    await page.locator("input[name=amount]").first().fill("100");
    await page.getByRole("button", { name: "+ Добавить расход" }).click();
    await expect(page.getByText("ТЗ отменено — списывать сырьё, добавлять расходы и оплаты нельзя").first()).toBeVisible();
    expect(sql(`select count(*) from "ProductionExpense" where "productionOrderId"='${id}'`)).toBe("0");
    // оплата
    await page.locator("input[name=amount]").last().fill("100");
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "+ Добавить оплату за работу" }).click();
    await expect(page.getByText("ТЗ отменено — списывать сырьё").nth(1)).toBeVisible();
    expect(sql(`select count(*) from "ProductionPaymentOrder" where "productionOrderId"='${id}'`)).toBe("0");
    // пакетная вставка
    await page.locator("textarea[name=rows]").fill("1 1");
    await page.getByRole("button", { name: "Списать все строки" }).click();
    await expect(page.getByText("ТЗ отменено — списывать сырьё").last()).toBeVisible();
    expect(sql(`select count(*) from "ProductionMaterialUsage" where "productionOrderId"='${id}'`)).toBe("0");
    // Перезагрузка: форм нет
    await page.reload();
    await page.waitForLoadState("networkidle");
    for (const t of ["+ лот", "+ подкладка", "+ расход", "Списать сразу несколько лотов"]) {
      await expect(page.getByText(t, { exact: false })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: "+ Добавить оплату за работу" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Завершить" })).toHaveCount(0);
    await expect(page.getByText("ТЗ отменено — списывать сырьё, добавлять расходы и оплаты нельзя.")).toBeVisible();
  });

  test("(1б) отменённое ТЗ: добавление лота через серверное действие отказывает", async ({ page }) => {
    await login(page);
    const id = await createOrder(page, { model: "M002A" });
    await page.locator("summary", { hasText: "+ лот" }).click();
    sql(`update "ProductionOrder" set status='CANCELLED' where id='${id}'`);
    const form = page.locator("form", { has: page.locator("select[name=lotId]") }).first();
    await form.locator("select").first().selectOption({ index: 1 });
    await form.locator("select[name=lotId]").selectOption({ index: 1 });
    await form.locator("input[name=quantity]").fill("1");
    await form.getByRole("button", { name: "+ Списать" }).click();
    await expect(page.getByText("ТЗ отменено — списывать сырьё").first()).toBeVisible();
    expect(sql(`select count(*) from "ProductionMaterialUsage" where "productionOrderId"='${id}'`)).toBe("0");
  });

  test("(6)(11) маржа и итоги следуют переключателю С НДС / Без НДС; «ТЗ от …»", async ({ page }) => {
    await login(page);
    const id = await createOrder(page, {
      model: "M002A", client: true, workPrice: "500000", lots: "1 2\n106 1", woNumber: "R-777", woDate: "2026-09-15",
    });
    await expect(page.getByText("ТЗ от 15.09.2026")).toBeVisible();
    const read = async () => {
      const total = await page.locator("tr", { hasText: "Итого себестоимость" }).filter({ hasNotText: "за единицу" }).first().innerText();
      const margin = await page.locator("tr", { hasText: /^Маржа/ }).first().innerText();
      return { total: num(total.split("\t").slice(-2)[0] || total), margin: num(margin.split("\t").slice(-2)[0] || margin), totalRaw: total, marginRaw: margin };
    };
    await expect(page.getByText("Маржа (с НДС)")).toBeVisible();
    const inc = await read();
    await page.getByRole("button", { name: "Без НДС" }).click();
    await expect(page.getByText("Маржа (без НДС)")).toBeVisible();
    const exc = await read();
    console.log("CARD incl", inc.totalRaw.replace(/\s+/g, " "), "|", inc.marginRaw.replace(/\s+/g, " "));
    console.log("CARD excl", exc.totalRaw.replace(/\s+/g, " "), "|", exc.marginRaw.replace(/\s+/g, " "));
    expect(exc.total).toBeLessThan(inc.total);
    // без = с − НДС: разница себестоимости равна разнице маржи (с обратным знаком)
    expect(Math.abs((inc.total - exc.total) - (exc.margin - inc.margin))).toBeLessThan(0.02);
    // список (в т.ч. итоговая строка)
    await page.goto("/production");
    await expect(page.getByText("Итого себестоимость (без НДС)").first()).toBeVisible();
    const sumExcl = num((await page.locator("tr", { hasText: "Итого себестоимость по списку" }).innerText()).split("\t").at(-2)!);
    await page.getByRole("button", { name: "С НДС" }).click();
    await expect(page.getByText("Итого себестоимость по списку (с НДС)")).toBeVisible();
    const sumIncl = num((await page.locator("tr", { hasText: "Итого себестоимость по списку" }).innerText()).split("\t").at(-2)!);
    console.log("LIST sum incl", sumIncl, "excl", sumExcl);
    expect(sumExcl).toBeLessThan(sumIncl);
    // проверка строки нашего ТЗ
    const rowTxt = await page.locator("tr", { hasText: "R-777" }).first().innerText();
    console.log("LIST row incl", rowTxt.replace(/\s+/g, " "));
    await page.getByRole("button", { name: "Без НДС" }).click();
    const rowTxtX = await page.locator("tr", { hasText: "R-777" }).first().innerText();
    console.log("LIST row excl", rowTxtX.replace(/\s+/g, " "));
    expect(num(rowTxtX.split("\t").at(-2)!)).toBeLessThan(num(rowTxt.split("\t").at(-2)!));
    await page.getByRole("button", { name: "С НДС" }).click();
    void id;
  });

  test("(8) массовая вставка лотов на карточке: разделители, всё-или-ничего, причины, текст не стирается", async ({ page }) => {
    await login(page);
    const id = await createOrder(page, { model: "M002A" });
    await page.getByText("Списать сразу несколько лотов").click();
    const ta = page.locator("textarea[name=rows]");
    const btn = page.getByRole("button", { name: "Списать все строки" });
    const bad = "1\t1\n106;1\n109 1\nNOPE 1\n111 abc\n112 0\n1 2 3";
    await ta.fill(bad);
    await btn.click();
    await expect(page.locator("ul.list-disc li").first()).toBeVisible();
    const lis = await page.locator("ul.list-disc li").allInnerTexts();
    console.log("BULK errors:\n" + lis.join("\n"));
    expect(lis.length).toBe(4);
    expect(lis.some((l) => l.includes("строка 4") && l.includes("NOPE"))).toBeTruthy();
    expect(lis.some((l) => l.includes("строка 5"))).toBeTruthy();
    expect(lis.some((l) => l.includes("строка 6"))).toBeTruthy();
    expect(lis.some((l) => l.includes("строка 7"))).toBeTruthy();
    await expect(ta).toHaveValue(bad);
    expect(sql(`select count(*) from "ProductionMaterialUsage" where "productionOrderId"='${id}'`)).toBe("0");
    // всё верно: Tab, «;», пробел
    await ta.fill("1\t1\n106;1\n109 1");
    await btn.click();
    await expect(page.getByText("Списано позиций: 3")).toBeVisible();
    expect(sql(`select count(*) from "ProductionMaterialUsage" where "productionOrderId"='${id}'`)).toBe("3");
    expect(statusOf(id)).toBe("IN_PROGRESS");
    await expect(ta).toHaveValue("");
  });

  test("(8б) вставка лотов при создании: все ошибки сразу, текст сохраняется", async ({ page }) => {
    await login(page);
    await page.goto("/production/new");
    await page.waitForLoadState("networkidle");
    await page.locator("#modelText").fill("M002A");
    await page.locator("input[name=plannedQuantity]").fill("1");
    const bad = "1 1\nNOPE 1\n106 x\n109;0";
    await page.locator("textarea[name=lots]").fill(bad);
    await page.getByRole("button", { name: "Создать ТЗ" }).click();
    await expect(page.getByText("NOPE").first()).toBeVisible();
    await expect(page.locator("textarea[name=lots]")).toHaveValue(bad);
    expect(page.url()).toContain("/production/new");
  });

  test("(9) сумма 0 в расходе и оплате — ошибка; confirm при переплате и удалении оплаты", async ({ page }) => {
    await login(page);
    const dialogs: string[] = [];
    let accept = false;
    page.on("dialog", (d) => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
    const id = await createOrder(page, { model: "M002A", client: true, workPrice: "1000", qty: "1", lots: "1 1" });
    await page.locator("summary", { hasText: "+ расход" }).click();
    await page.locator("select[name=categoryId]").selectOption({ index: 1 });
    const amt = page.locator("input[name=amount]");
    await amt.first().evaluate((i) => i.closest("form")!.setAttribute("novalidate", ""));
    await amt.first().fill("0");
    await page.getByRole("button", { name: "+ Добавить расход" }).click();
    await expect(page.getByText("значение должно быть больше 0").first()).toBeVisible();
    expect(sql(`select count(*) from "ProductionExpense" where "productionOrderId"='${id}'`)).toBe("0");
    // оплата 0
    await amt.last().evaluate((i) => i.closest("form")!.setAttribute("novalidate", ""));
    await amt.last().fill("0");
    await page.getByRole("button", { name: "+ Добавить оплату за работу" }).click();
    await expect(page.getByText("значение должно быть больше 0").nth(1)).toBeVisible();
    expect(sql(`select count(*) from "ProductionPaymentOrder" where "productionOrderId"='${id}'`)).toBe("0");
    // переплата: 5000 при к оплате 1000 — отказ в confirm
    await amt.last().fill("5000");
    await page.getByRole("button", { name: "+ Добавить оплату за работу" }).click();
    await page.waitForTimeout(600);
    expect(dialogs.at(-1)).toContain("больше остатка к оплате");
    expect(sql(`select count(*) from "ProductionPaymentOrder" where "productionOrderId"='${id}'`)).toBe("0");
    // согласие
    accept = true;
    await page.getByRole("button", { name: "+ Добавить оплату за работу" }).click();
    await expect(page.locator("tr", { hasText: "5 000,00" })).toBeVisible();
    expect(sql(`select count(*) from "ProductionPaymentOrder" where "productionOrderId"='${id}'`)).toBe("1");
    // удаление: отказ, затем согласие
    accept = false;
    await page.locator("tr", { hasText: "5 000,00" }).getByRole("button", { name: "Удалить" }).click();
    await page.waitForTimeout(600);
    expect(dialogs.at(-1)).toContain("Удалить оплату");
    expect(sql(`select count(*) from "ProductionPaymentOrder" where "productionOrderId"='${id}'`)).toBe("1");
    accept = true;
    await page.locator("tr", { hasText: "5 000,00" }).getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Оплат пока нет")).toBeVisible();
  });

  test("(10) подкладка: ткань без метража и метраж без ткани — ошибки", async ({ page }) => {
    await login(page);
    sql(`select 1`);
    await page.goto("/production/new");
    await page.waitForLoadState("networkidle");
    await page.locator("#modelText").fill("M002A");
    await page.locator("input[name=plannedQuantity]").fill("1");
    const sel = page.locator("select[name=liningMaterialId]");
    const opts = await sel.locator("option").allInnerTexts();
    console.log("LINING options:", opts.join(" | "));
    // метраж без ткани
    await page.locator("input[name=liningQuantity]").fill("2");
    await page.getByRole("button", { name: "Создать ТЗ" }).click();
    await expect(page.getByText("указан метраж, но не выбрана ткань")).toBeVisible();
    // ткань без метража (любая, в т.ч. с нулевым остатком)
    await page.locator("input[name=liningQuantity]").fill("");
    await sel.selectOption({ index: 1 });
    await page.getByRole("button", { name: "Создать ТЗ" }).click();
    await expect(page.getByText("указана ткань, но не указан метраж")).toBeVisible();
    expect(page.url()).toContain("/production/new");
  });

  test("(7) роли без прав не видят кнопок правки; баннер на сводке", async ({ page }) => {
    for (const role of ["warehouse", "purchaser", "viewer", "accountant"]) {
      await loginAs(page, `${role}@qa-test.ru`);
      await page.goto("/production");
      await expect(page.getByRole("link", { name: "+ Новое ТЗ" }), role).toHaveCount(0);
      const id = sql(`select id from "ProductionOrder" where status='COMPLETED' and "clientId" is not null order by number limit 1`);
      await page.goto(`/production/${id}`);
      await page.waitForLoadState("networkidle");
      for (const b of ["Изменить", "Завершить", "Сохранить", "Удалить", "+ Добавить оплату за работу", "+ Добавить расход"]) {
        await expect(page.getByRole("button", { name: b }), `${role}: ${b}`).toHaveCount(0);
      }
      await expect(page.getByText("+ лот"), role).toHaveCount(0);
      await expect(page.locator("#retailPrice"), role).toHaveCount(0);
      // прямой заход на /production/new
      await page.goto("/production/new");
      await expect(page.getByText("Недостаточно прав для создания ТЗ")).toBeVisible();
      // баннер на сводке (редирект с error=forbidden)
      await page.goto("/dashboard?error=forbidden");
      await expect(page.getByText("Недостаточно прав для этого действия")).toBeVisible();
    }
    await loginAs(page, "technologist@qa-test.ru");
    await page.goto("/production");
    await expect(page.getByRole("link", { name: "+ Новое ТЗ" })).toBeVisible();
  });

  test.afterAll(() => {
    // ничего не удаляем: база одноразовая (scripts/e2e.sh down)
  });
});
