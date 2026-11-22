import { test, expect, type Page } from "@playwright/test";
import { login, watchErrors, expectNoErrors } from "./helpers";

// Самодостаточные проверки новой структуры: «Сырьё» (полоса итогов, таблица «Динамика по сырью»), партии, переключатель «С 4%»,
// документы, оплаты. Идут против изолированной копии боевой базы
// (scripts/e2e.sh up drv 3301; E2E_BASE_URL=http://localhost:3301). Данные не изменяются, кроме
// тестов с пометкой «пишет».
// Тесты с test.fail() фиксируют найденные ошибки: пока ошибка есть — тест «проходит как ожидаемо
// падающий»; когда ошибку починят, он станет красным и пометку надо снять.

const num = (s: string) => Number(s.replace(/[^\d,-]/g, "").replace(",", "."));
const setCookie = (page: Page, name: string, value: string) =>
  page.context().addCookies([{ name, value, url: new URL(page.url() === "about:blank" ? "http://localhost:3301" : page.url()).origin }]);

/** Полоса итогов уровня («Куплено → Использовано → Остаток → Оплачено → Долг») на страницах раздела «Сырьё». */
async function levelTotals(page: Page) {
  const strip = page.locator('[data-testid="level-summary"]').first();
  await expect(strip).toBeVisible();
  const tiles = await strip.locator(":scope > div").evaluateAll((els) =>
    els.map((el) => {
      const lines = (el as HTMLElement).innerText.split("\n").map((x) => x.trim()).filter(Boolean);
      return { title: lines[0] ?? "", main: lines[1] ?? "" };
    }),
  );
  const of = (t: string) => {
    const x = tiles.find((y) => y.title.toLowerCase().startsWith(t));
    return x ? num(x.main) : NaN;
  };
  return { bought: of("куплено"), used: of("использовано"), rem: of("остаток"), paid: of("оплачено"), debt: of("долг") };
}

test.describe("Сырьё: итоги и таблица динамики", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("полоса итогов, строки по году, НДС, без NaN", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/lots");
    const t = await levelTotals(page);
    expect(t.bought).toBeGreaterThan(0);
    // Куплено без 4 % = использовано (без 4 %) + остаток; при «С 4 %» использовано больше на надбавку, поэтому проверяем нестрого
    expect(t.used + t.rem).toBeGreaterThanOrEqual(t.bought - 5);
    // Строки таблицы по году закупки (раньше — отдельная «Сводка по годам»)
    await page.getByRole("tab", { name: "Году закупки" }).click();
    await expect(page.getByRole("button", { name: "Год → сырьё → аукцион" })).toBeVisible();
    await expect(page.locator("tr[data-total]").first()).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/NaN|undefined|Infinity/);
    // «Без НДС»: сумма без НДС меньше суммы с НДС, количество не меняется
    await page.getByRole("button", { name: "Без НДС" }).first().click();
    await page.waitForTimeout(800);
    const e = await levelTotals(page);
    expect(e.bought).toBeLessThan(t.bought);
    await expectNoErrors(errors);
  });

  test("мобильный 375: нет горизонтального скролла страницы", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/lots");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  });

  // Была ошибка (исправлена): у двух закупок подкладки (З-2026-0032 и З-2026-0060) одни и те же лоты; «Куплено» партии
  // берёт lot.totalCost целиком для каждой позиции — сумма задваивается (+1 351 269,05 ₽).
  test("«Куплено» партии подкладки совпадает со «Стоимостью» на /payments", async ({ page }) => {
    await page.goto("/lots/lining/" + encodeURIComponent("Подкладка 07.25"));
    const s = await levelTotals(page);
    await page.goto("/payments?auction=" + encodeURIComponent("Подкладка 07.25"));
    const card = page.locator("main").getByText("Подкладка 07.25").first();
    await expect(card).toBeVisible();
    const txt = await page.locator("main").innerText();
    const i = txt.indexOf("Подкладка 07.25\nзакупок");
    const m = /Стоимость\n([\d\s,]+)\s*₽/.exec(txt.slice(i));
    expect(Math.abs(s.bought - num(m![1]))).toBeLessThan(1);
  });

  // Оплаты на странице «Сырьё» — доли оплат по лотам (с НДС); полный итог оплат — на /payments. Здесь проверяем разумность, а не равенство.
  test("«Оплачено» в полосе итогов: больше нуля и не больше «Куплено» более чем на 1 %", async ({ page }) => {
    await page.goto("/lots");
    const s = await levelTotals(page);
    expect(s.paid).toBeGreaterThan(0);
    expect(s.paid).toBeLessThanOrEqual(s.bought * 1.01);
  });

  // Переключатель «Без НДС» в шапке меняет суммы раздела.
  test("переключатель НДС в шапке меняет суммы полосы итогов", async ({ page }) => {
    await page.goto("/lots");
    const before = await levelTotals(page);
    await page.getByRole("button", { name: "Без НДС" }).first().click();
    await page.waitForTimeout(800);
    await page.goto("/lots");
    const after = await levelTotals(page);
    expect(after.bought).toBeLessThan(before.bought);
  });
});

test.describe("Партии", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("список = карточки партий = фильтр ?batch=N = вид «По партиям»", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/production/batches");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => (c as HTMLElement).innerText.replace(/\s+/g, " ").trim())),
    );
    expect(rows.length).toBeGreaterThanOrEqual(19);
    const grouped = await (async () => {
      await page.goto("/production?view=batches");
      return page.evaluate(() => [...document.querySelectorAll("[data-batch-groups] > details > summary")].map((s) => (s as HTMLElement).innerText.replace(/\s+/g, " ")));
    })();
    for (const r of rows.slice(0, 6)) {
      const n = /№(\d+)/.exec(r[0])![1];
      const tz = num(r[2]);
      await page.goto(`/production/batches/${n}`);
      const stats = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("dl > div")].map((d) => [(d.querySelector("dt") as HTMLElement).innerText, (d.querySelector("dd") as HTMLElement).innerText])));
      expect(num(stats["ТЗ"])).toBe(tz);
      expect(stats["Остаток"].replace(/\s/g, "")).toBe(r[r.length - 2].replace(/\s/g, ""));
      await page.goto(`/production?batch=${n}`);
      await expect(page.locator("tbody tr")).toHaveCount(tz);
      expect(grouped.some((g) => g.includes(`Партия №${n} `))).toBe(true);
    }
    await expectNoErrors(errors);
  });

  test("пустые партии и неверные номера", async ({ page }) => {
    for (const n of [15, 16]) {
      await page.goto(`/production/batches/${n}`);
      await expect(page.getByText("К партии пока не привязано ни одного ТЗ")).toBeVisible();
    }
    for (const bad of ["0", "999", "abc", "1.5", "99999999"]) {
      const r = await page.goto(`/production/batches/${bad}`);
      expect(r?.status()).toBe(404);
    }
  });
});

test.describe("Переключатель «Без 4% | С 4%»", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("меняет только себестоимость; работа, оплаты, долги и закупки — без изменений", async ({ page }) => {
    const grab = async (u: string) => {
      await page.goto(u);
      return page.locator("main").innerText();
    };
    await setCookie(page, "commission4Display", "off");
    const off = { batches: await grab("/production/batches"), pay: await grab("/payments"), pur: await grab("/purchases") };
    await page.goto("/lots");
    const offLots = await levelTotals(page);
    const offDash = await grab("/dashboard");
    await page.getByRole("button", { name: "С 4%" }).click();
    await page.waitForTimeout(1200);
    const on = { batches: await grab("/production/batches"), pay: await grab("/payments"), pur: await grab("/purchases") };
    await page.goto("/lots");
    const onLots = await levelTotals(page);
    const onDash = await grab("/dashboard");
    expect(on.pay).toBe(off.pay);
    expect(on.pur).toBe(off.pur);
    // «Сырьё»: «Куплено» и «Остаток» от 4 % не зависят, «Использовано» при «С 4 %» растёт на надбавку
    expect(onLots.bought).toBe(offLots.bought);
    expect(onLots.rem).toBe(offLots.rem);
    expect(onLots.used).toBeGreaterThan(offLots.used);
    expect(on.batches).toContain("Себестоимость (с 4%)".toUpperCase());
    expect(on.batches).not.toBe(off.batches);
    // «Долг поставщикам» и «Долг по работе подрядчику» не меняются, «Использовано в ТЗ» растёт
    const pick = (t: string, label: string) => num(new RegExp(label + "\\n([\\d\\s,]+)\\s*₽").exec(t)![1]);
    expect(pick(onDash, "Долг поставщикам")).toBe(pick(offDash, "Долг поставщикам"));
    expect(pick(onDash, "Долг по работе подрядчику")).toBe(pick(offDash, "Долг по работе подрядчику"));
    expect(pick(onDash, "Использовано в ТЗ \\(с 4%\\)")).toBeGreaterThan(pick(offDash, "Использовано в ТЗ"));
    await setCookie(page, "commission4Display", "off");
  });

  test("карточка ТЗ: 4% только на сырьё/подкладку; партия 6 (commission4 = false) без изменений", async ({ page }) => {
    const total = async (u: string) => {
      await page.goto(u);
      const t = await page.locator("main").innerText();
      return num(/Итого себестоимость(?: \(с 4%\))?\t([\d\s,]+)\s*₽/.exec(t)![1]);
    };
    // ТЗ 1: партия 1 — 6 077 697,30 → ×1,04
    await page.goto("/production?q=П-2026-0001");
    const href1 = (await page.locator("tbody a[href^='/production/']").first().getAttribute("href"))!;
    await setCookie(page, "commission4Display", "off");
    const a = await total(href1);
    await setCookie(page, "commission4Display", "on");
    const b = await total(href1);
    expect(Math.abs(b - a * 1.04)).toBeLessThan(0.05);
    // партия 6: те же итоги в обоих режимах
    await page.goto("/production?batch=6");
    const href6 = (await page.locator("tbody a[href^='/production/']").first().getAttribute("href"))!;
    await setCookie(page, "commission4Display", "off");
    const c = await total(href6);
    await setCookie(page, "commission4Display", "on");
    const d = await total(href6);
    expect(d).toBe(c);
    // «Без НДС» + «С 4%»: подпись и ×1,04 сохраняются
    await setCookie(page, "vatDisplay", "excl");
    const e = await total(href1);
    await setCookie(page, "commission4Display", "off");
    const f = await total(href1);
    expect(Math.abs(e - f * 1.04)).toBeLessThan(0.05);
    await setCookie(page, "vatDisplay", "incl");
  });
});

test.describe("Шапка на мобильном", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("375: меню, НДС, 4% и «Выйти» помещаются без наложения", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/production/batches");
    const boxes = await page.evaluate(() => [...document.querySelectorAll("header button")].map((b) => b.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right })));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].l).toBeGreaterThanOrEqual(boxes[i - 1].r - 0.5);
    expect(boxes[boxes.length - 1].r).toBeLessThanOrEqual(375);
  });

  // Была ошибка (исправлена): на 360 и 320 px переключатель НДС налезает на кнопку меню, на 320 «Выйти» выходит за экран.
  test("360: кнопки шапки не накладываются", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/production/batches");
    const boxes = await page.evaluate(() => [...document.querySelectorAll("header button")].map((b) => b.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right })));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].l).toBeGreaterThanOrEqual(boxes[i - 1].r - 0.5);
  });
});
