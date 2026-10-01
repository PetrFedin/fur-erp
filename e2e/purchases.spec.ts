import { test, expect, type Page } from "@playwright/test";
import { login, watchErrors, expectNoErrors } from "./helpers";

// Тесты раздела «Закупки»/«Сырьё». Идут против изолированной копии базы (scripts/e2e.sh).

async function openPurchase(page: Page, number: string) {
  await page.goto("/purchases");
  await page.getByRole("link", { name: number, exact: true }).first().click();
  await page.waitForLoadState("networkidle");
}

test.describe.serial("приёмка закупок СП 09-26", () => {
  for (const n of [50, 51, 52, 53, 54, 55, 56, 57]) {
    const number = `З-2026-00${n}`;
    test(`приёмка ${number}`, async ({ page }) => {
      page.on("dialog", (d) => d.accept());
      await login(page);
      const errors = watchErrors(page);
      await openPurchase(page, number);
      await page.getByRole("button", { name: "Принять на склад" }).click();
      await expect(page.getByText("Принято на склад").first()).toBeVisible({ timeout: 20_000 });
      await expectNoErrors(errors);
    });
  }
});

// ---------- Документы закупки ----------
// Фикстуры (файлы разных типов) лежат вне репозитория: FX — каталог с ними, E2E_FX.
const FX = process.env.E2E_FX ?? "/private/tmp/claude-501/-Users-petr-Documents-claude/b85db0ed-7d01-461c-9022-acebe740c8ed/scratchpad/fx";

async function upload(page: Page, files: string[], opts: { scope?: string; kind?: string } = {}) {
  const form = page.locator("form", { has: page.locator('input[type=file]') });
  await form.locator("input[type=file]").setInputFiles(files.map((f) => `${FX}/${f}`));
  if (opts.kind) await form.locator("select[name=kind]").selectOption(opts.kind);
  if (opts.scope) await form.locator("select[name=scope]").selectOption(opts.scope);
  await form.getByRole("button", { name: /Загрузить/ }).click();
  const res = form.locator("p.text-red-600, p.text-emerald-600").first();
  await res.waitFor({ timeout: 40_000 });
  return (await res.innerText()).trim();
}

const DOC_CASES: { file: string; ok: boolean; why: string }[] = [
  { file: "real.pdf", ok: true, why: "PDF" },
  { file: "real.xlsx", ok: true, why: "xlsx" },
  { file: "real.docx", ok: true, why: "docx" },
  { file: "pic.png", ok: true, why: "png" },
  { file: "pic.jpg", ok: true, why: "jpg" },
  { file: "Счёт №1 \"тест\" (копия).pdf", ok: true, why: "кириллица и кавычки в имени" },
  { file: "big2mb.pdf", ok: true, why: "PDF 2 МБ (лимит 25)" },
  { file: "big24.pdf", ok: true, why: "PDF 24 МБ (лимит 25)" },
  { file: "big26.pdf", ok: false, why: "PDF 26 МБ (>25)" },
  { file: "note.txt", ok: false, why: "txt" },
  { file: "evil.html", ok: false, why: "html" },
  { file: "pic.svg", ok: false, why: "svg" },
  { file: "fake.pdf", ok: false, why: "текст под видом .pdf" },
  { file: "mz.pdf", ok: false, why: "exe-заголовок под видом .pdf" },
  { file: "old.xls", ok: false, why: "старый .xls" },
  { file: "real_as_zip.zip", ok: false, why: "xlsx, переименованный в .zip" },
  { file: "fakezip.xlsx", ok: false, why: "битый zip под видом .xlsx" },
  { file: "xlsx_as_docx.docx", ok: false, why: "xlsx, переименованный в .docx" },
  { file: "html_in_png.png", ok: false, why: "html под видом png" },
];

test.describe("документы закупки: загрузка", () => {
  test.setTimeout(180_000);
  for (const c of DOC_CASES) {
    test(`загрузка: ${c.why}`, async ({ page }) => {
      await login(page);
      await openPurchase(page, "З-2026-0057");
      const msg = await upload(page, [c.file]);
      console.log(`DOC ${c.file}: ${msg}`);
      if (c.ok) expect(msg, `ожидали успех: ${c.why}`).toBe("Загружено");
      else expect(msg, `ожидали отказ: ${c.why}`).not.toBe("Загружено");
    });
  }
});

test.describe("документы закупки: 2 МБ без сообщения", () => {
  test("что видит пользователь при файле больше 1 МБ", async ({ page }) => {
    await login(page);
    await openPurchase(page, "З-2026-0057");
    const form = page.locator("form", { has: page.locator("input[type=file]") });
    await form.locator("input[type=file]").setInputFiles(`${FX}/big2mb.pdf`);
    await form.getByRole("button", { name: /Загрузить/ }).click();
    await page.waitForTimeout(6000);
    await page.screenshot({ path: "/tmp/pw/big2mb.png", fullPage: true });
    const txt = await form.innerText();
    console.log("FORM TEXT:", txt.replace(/\n/g, " | "));
    console.log("BUTTON:", await form.getByRole("button").innerText());
  });
});

// ---------- Доступ к файлам ----------
test.describe("документы закупки: доступ", () => {
  test("без входа — 401, другая организация — 404, свой — 200 с верными заголовками", async ({ page, browser, playwright }) => {
    await login(page);
    await openPurchase(page, "З-2026-0050");
    const hrefs = await page.locator('a[href^="/api/purchase-docs/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    const base = process.env.E2E_BASE_URL!;
    const anon = await playwright.request.newContext({ baseURL: base });
    for (const h of hrefs) {
      const r = await anon.get(h, { maxRedirects: 0 });
      expect(r.status(), `аноним ${h}`).toBe(401);
      const own = await page.request.get(h);
      expect(own.status(), `свой ${h}`).toBe(200);
      console.log("OWN", h, own.headers()["content-type"], own.headers()["content-disposition"]);
    }
    // Другая организация (bob@qa-other.ru заведён SQL-ом в тестовой базе).
    const ctx2 = await browser.newContext({ baseURL: base });
    const p2 = await ctx2.newPage();
    await p2.goto("/login");
    await p2.getByLabel("Email").fill("bob@qa-other.ru");
    await p2.getByLabel("Пароль").fill("TestPass123!");
    await p2.getByRole("button", { name: "Войти" }).click();
    await p2.waitForURL(/\/dashboard/);
    for (const h of hrefs) {
      const r = await p2.request.get(h);
      expect(r.status(), `чужая орг ${h}`).toBe(404);
    }
    // Чужая закупка в карточке
    const purchasePath = new URL(page.url()).pathname;
    const res = await p2.goto(purchasePath);
    console.log("чужая закупка:", res?.status(), (await p2.locator("body").innerText()).slice(0, 200).replace(/\n/g, " | "));
    const nf = await anon.get("/api/purchase-docs/nonexistent", { maxRedirects: 0 });
    console.log("аноним, несуществующий id:", nf.status());
    const nf2 = await page.request.get("/api/purchase-docs/nonexistent");
    console.log("вошёл, несуществующий id:", nf2.status());
  });
});

// ---------- Сырьё: лоты, поиск, ссылки 📄 ----------
test.describe("Сырьё (Мех)", () => {
  test("раскрытие материалов: число видимых лотов vs в базе", async ({ page }) => {
    await login(page);
    await page.goto("/lots");
    await page.waitForLoadState("networkidle");
    const groups = page.locator("details.group");
    const n = await groups.count();
    for (let i = 0; i < n; i++) {
      const g = groups.nth(i);
      const name = (await g.locator("summary").first().innerText()).split("\n")[0];
      await g.locator("summary").first().click();
      const rows = await g.locator("tbody tr").count();
      const empty = await g.getByText("Лоты не найдены").count();
      console.log(`LOTS ${name}: строк=${rows} пусто=${empty}`);
    }
  });

  test("ссылки 📄 у лотов СП 09-26 открываются, поиск по лоту", async ({ page }) => {
    await login(page);
    await page.goto("/lots?q=" + encodeURIComponent("СП0926-4"));
    await page.waitForLoadState("networkidle");
    const links = page.locator('a[href^="/api/purchase-docs/"]');
    console.log("📄 ссылок по лоту СП0926-4:", await links.count(), await links.allInnerTexts());
    const href = await links.first().getAttribute("href");
    const r = await page.request.get(href!);
    expect(r.status()).toBe(200);
    console.log("TEXT:", (await page.locator("main, body").first().innerText()).replace(/\n/g, " | ").slice(0, 900));
  });
});

// ---------- Создание закупки вставкой из Excel ----------
async function fillNew(page: Page, rows: string, opts: { currency?: string; rate?: string; auction?: string } = {}) {
  await page.goto("/purchases/new");
  await page.waitForLoadState("networkidle");
  if (opts.auction) await page.getByLabel("Аукцион / сессия").fill(opts.auction);
  if (opts.currency) {
    await page.getByLabel("Валюта").selectOption(opts.currency);
    if (opts.rate !== undefined) await page.getByLabel(/Курс/).pressSequentially(opts.rate);
  }
  await page.locator("textarea[name=rows]").fill(rows);
}
async function submitNew(page: Page) {
  await page.getByRole("button", { name: /Создать закупку/ }).click();
  // либо ушли на карточку, либо показана ошибка
  await Promise.race([
    page.waitForURL(/\/purchases\/[a-z0-9]{20,}/, { timeout: 15_000 }).catch(() => null),
    page.locator("p.bg-red-50, div.bg-red-50").first().waitFor({ timeout: 15_000 }).catch(() => null),
  ]);
  await page.waitForTimeout(500);
  const m = page.url().match(/\/purchases\/([a-z0-9]{20,})/);
  return { id: m?.[1] ?? null, errors: await page.locator(".bg-red-50").allInnerTexts() };
}

test.describe("создание закупки вставкой", () => {
  test("валидные строки: запятая/точка, пробелы, НДС по умолчанию, заголовок", async ({ page }) => {
    await login(page);
    const rows = [
      "Материал\tКол-во\tЦена без НДС\tНДС%\tЛот\tСорт\tЦвет",
      "Соболь\t10\t1000,50\t22\tQA-1\tК 2\tтёмный",
      "соболь\t5,5\t2 000.25\t\tQA-2\t\t",
      "  Норка  \t3\t 5 000,00 \t20\t\tI\tбелая",
      "Соболь\t1\t 12 345,67 ₽\t22%\tQA-3",
    ].join("\n");
    await fillNew(page, rows);
    await page.getByRole("button", { name: "Проверить" }).click();
    console.log("PREVIEW:", (await page.locator("form.flex-col").innerText()).replace(/\n/g, " | ").slice(-700));
    const r = await submitNew(page);
    console.log("CREATED", r);
    expect(r.id).not.toBeNull();
  });

  test("битые строки: ничего не создаётся, ошибки по номерам строк", async ({ page }) => {
    await login(page);
    const before = await page.goto("/purchases").then(() => page.locator("tbody tr").count());
    const rows = [
      "Соболь\tдесять\t1000\t22",
      "Соболь\t10\t\t22",
      "Соболь\t-5\t100\t22",
      "Соболь\t0\t100\t22",
      "Соболь\t5\t100\t150",
      "Соболь\t5\t100\tабв",
      "Соболь",
      "\t5\t100",
      "Соболь\t5\t1,234.56\t22",
      "Соболь\t5\t1.234,56\t22",
      "Соболь\t5\t-0\t22",
      "Соболь\t0x10\t100\t22",
      "Соболь\t1e3\t100\t22",
    ].join("\n");
    await fillNew(page, rows);
    const r = await submitNew(page);
    console.log("BAD:", r);
    const issues = await page.locator("li").allInnerTexts();
    console.log("ISSUES:\n" + issues.join("\n"));
    await page.goto("/purchases");
    expect(await page.locator("tbody tr").count()).toBe(before);
  });

  test("дубли лотов в одной вставке и лот, уже лежащий на складе", async ({ page }) => {
    await login(page);
    const rows = "Соболь\t1\t100\t22\tDUP-1\nСоболь\t2\t100\t22\tDUP-1\nСоболь\t3\t100\t22\t15016";
    await fillNew(page, rows);
    await page.getByRole("button", { name: "Проверить" }).click();
    console.log("DUP PREVIEW:", (await page.locator("form.flex-col").innerText()).replace(/\n/g, " | ").slice(-500));
    const r = await submitNew(page);
    console.log("DUP CREATED:", r);
  });

  test("пустые и пробельные строки между данными, только пустая вставка", async ({ page }) => {
    await login(page);
    await fillNew(page, "\n\n   \nСоболь\t1\t100\t22\n\n\t\t\nСоболь\t2\t100\t22\n\n");
    const r = await submitNew(page);
    console.log("EMPTYLINES:", r);
    await fillNew(page, "   \n\n  ");
    const r2 = await submitNew(page);
    console.log("ONLYEMPTY:", r2);
  });

  test("огромные числа и дробные хвосты", async ({ page }) => {
    await login(page);
    await fillNew(page, "Соболь\t99999999999999\t1\t22");
    const r = await submitNew(page);
    console.log("HUGEQTY:", r, await page.locator("body").innerText().then((t) => t.slice(0, 300).replace(/\n/g, " | ")));
    await fillNew(page, "Соболь\t21,5555\t100,555\t22\tFRAC-1");
    const r2 = await submitNew(page);
    console.log("FRAC:", r2);
    await fillNew(page, "Соболь\t1\t99999999999999\t22");
    const r3 = await submitNew(page);
    console.log("HUGEPRICE:", r3, await page.locator("body").innerText().then((t) => t.slice(0, 300).replace(/\n/g, " | ")));
  });

  test("валюта USD: курс 0, отрицательный, запятая", async ({ page }) => {
    await login(page);
    for (const rate of ["84,5", "84.5", "1e2"]) {
      await fillNew(page, "Соболь\t1\t100\t22", { currency: "USD", rate });
      const r = await submitNew(page);
      console.log("RATE", rate, r);
    }
  });
});

// ---------- Приёмка: гонка и дубли лотов ----------
test.describe("приёмка: гонка двух вкладок и дубли лотов", () => {
  test("двойная приёмка одной закупки из двух вкладок", async ({ browser }) => {
    const base = process.env.E2E_BASE_URL!;
    const ctx = await browser.newContext({ baseURL: base });
    const p1 = await ctx.newPage();
    const p2 = await ctx.newPage();
    for (const p of [p1, p2]) p.on("dialog", (d) => d.accept());
    await login(p1);
    await openPurchase(p1, "З-2026-0058");
    await p2.goto(p1.url());
    await p2.waitForLoadState("networkidle");
    await Promise.all([
      p1.getByRole("button", { name: "Принять на склад" }).click(),
      p2.getByRole("button", { name: "Принять на склад" }).click(),
    ]);
    await p1.waitForTimeout(4000);
    console.log("P1 TEXT:", (await p1.locator("body").innerText()).slice(0, 500).replace(/\n/g, " | "));
    console.log("P2 TEXT:", (await p2.locator("body").innerText()).slice(0, 500).replace(/\n/g, " | "));
  });
});

// ---------- Позиции, расходы, оплаты в карточке ----------
const sqlOne = (q: string) => {
  const { execFileSync } = require("node:child_process");
  return execFileSync("docker", ["exec", "-i", "fur-erp-db-1", "psql", "-U", "fur_erp", "-d", "fur_erp_e2e_purch", "-At", "-c", q]).toString().trim();
};

test.describe.serial("карточка закупки: позиции", () => {
  let url = "";
  test("нестандартная ставка НДС (18%, 10,5%) из вставки сохраняется как есть", async ({ page }) => {
    await login(page);
    await fillNew(page, "Соболь\t1\t100\t18\tVAT18\nНорка\t2\t200\t10,5\tVAT105");
    const r = await submitNew(page);
    expect(r.id).not.toBeNull();
    url = page.url();
    console.log("НДС в БД:", sqlOne(`select string_agg("lotNumber"||'='||"vatRate", ',') from "PurchaseItem" where "purchaseId"='${r.id}'`));
  });

  test("правка только цвета у позиции с НДС 18% — НДС не должен измениться", async ({ page }) => {
    await login(page);
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Изменить" }).nth(1).click(); // позиция 1 (шапка «Изменить» — первая)
    const row = page.locator("form.grid.grid-cols-8").last();
    const sel = row.locator("select[name=vatRate]");
    console.log("в форме правки НДС показан как:", await sel.inputValue(), "| опции:", await sel.locator("option").allInnerTexts());
    await row.locator("input[name=color]").fill("правка");
    await row.getByRole("button", { name: "Сохранить" }).click();
    await page.waitForTimeout(1500);
    console.log("НДС в БД после правки цвета:", sqlOne(`select string_agg("lotNumber"||'='||"vatRate"||'/'||coalesce(color,''), ',') from "PurchaseItem" where "purchaseId"='${url.split("/").pop()}'`));
  });
});

test.describe.serial("карточка закупки: расходы, оплата, отмена", () => {
  let id = "";
  test("создать закупку USD 84,5 и добавить расход и оплату", async ({ page }) => {
    await login(page);
    await fillNew(page, "Соболь\t10\t100\t22\tPAY-1", { currency: "USD", rate: "84.5" });
    const r = await submitNew(page);
    id = r.id!;
    const summary = async () => (await page.locator(".grid > div").filter({ hasText: /Остаток к оплате|Итого \(RUB\)/ }).allInnerTexts()).join(" | ").replace(/\n/g, " ");
    console.log("ИТОГО до расхода:", await page.getByText("Итого (RUB)").locator("xpath=..").innerText().then((t) => t.replace(/\n/g, " ")));
    // расход
    await page.getByRole("button", { name: "Доставка" }).click();
    await page.locator("input.w-40").fill("10000");
    await page.getByRole("button", { name: "+ Добавить расход" }).click();
    await page.waitForTimeout(1500);
    console.log("ИТОГО после расхода 10 000 (22%):", await page.getByText("Итого (RUB)").locator("xpath=..").innerText().then((t) => t.replace(/\n/g, " ")));
    console.log("ПОДСКАЗКА:", await page.getByText(/Расходы = /).innerText().catch(() => "нет"));
    // оплата
    const pay = page.locator("form", { has: page.getByRole("button", { name: "+ Добавить оплату" }) });
    await pay.locator("input[name=amount]").fill("5000");
    await pay.getByRole("button", { name: "+ Добавить оплату" }).click();
    await page.waitForTimeout(1500);
    console.log("ПОСЛЕ ОПЛАТЫ 5000:", await page.getByText("Остаток к оплате").locator("xpath=..").innerText().then((t) => t.replace(/\n/g, " ")));
    console.log("PAY IN DB:", sqlOne(`select amount||' '||currency||' '||status from "Payment" where "purchaseId"='${id}'`));
  });

  test("оплата больше остатка, нулевая и в будущем", async ({ page }) => {
    await login(page);
    await page.goto(`/purchases/${id}`);
    await page.waitForLoadState("networkidle");
    const pay = page.locator("form", { has: page.getByRole("button", { name: "+ Добавить оплату" }) });
    await pay.locator("input[name=amount]").fill("99999999");
    await pay.locator("input[name=paidAt]").fill("2031-01-01");
    await pay.getByRole("button", { name: "+ Добавить оплату" }).click();
    await page.waitForTimeout(1500);
    console.log("ПЕРЕПЛАТА:", await page.getByText("Остаток к оплате").locator("xpath=..").innerText().then((t) => t.replace(/\n/g, " ")));
    await page.goto("/payments");
    await page.waitForLoadState("networkidle");
    const t = await page.locator("main, body").first().innerText();
    console.log("PAYMENTS PAGE:", t.replace(/\n/g, " | ").slice(0, 1500));
  });

  test("отмена закупки: что остаётся доступным", async ({ page }) => {
    await login(page);
    await page.goto(`/purchases/${id}`);
    page.on("dialog", (d) => d.accept());
    await page.locator("details summary", { hasText: "⋯" }).click();
    await page.getByRole("button", { name: "Отменить закупку" }).click();
    await page.waitForTimeout(2000);
    const t = await page.locator("body").innerText();
    console.log("ПОСЛЕ ОТМЕНЫ:", t.replace(/\n/g, " | ").slice(0, 700));
    console.log("кнопки:", await page.getByRole("button").allInnerTexts());
    const pay = page.locator("form", { has: page.getByRole("button", { name: "+ Добавить оплату" }) });
    console.log("форма оплаты у отменённой:", await pay.count());
    if (await pay.count()) {
      await pay.locator("input[name=amount]").fill("1");
      await pay.getByRole("button", { name: "+ Добавить оплату" }).click();
      await page.waitForTimeout(1500);
      console.log("ПЛАТЁЖ ПО ОТМЕНЁННОЙ:", sqlOne(`select count(*) from "Payment" where "purchaseId"='${id}'`));
    }
    await page.goto("/purchases?status=CANCELLED");
    console.log("ОТМЕНЁННЫЕ:", (await page.locator("tbody").innerText()).replace(/\n/g, " | ").slice(0, 300));
  });
});

// ---------- СП 09-26: правка позиций с расчётом себестоимости (costPlan) ----------
test.describe.serial("СП 09-26: правка и расходы в черновике с costPlan", () => {
  let url = "";
  const planCard = async (page: Page) => (await page.getByText("Расчёт себестоимости по лотам").locator("xpath=../..").innerText()).replace(/\n/g, " | ");
  const summary = async (page: Page) => (await page.locator("div.grid").first().innerText()).replace(/\n/g, " ");
  test("правка цены и количества позиции — как реагирует расчёт", async ({ page }) => {
    await login(page);
    await openPurchase(page, "З-2026-0057");
    url = page.url();
    console.log("ДО:", await summary(page));
    console.log("ДО план:", await planCard(page));
    await page.getByRole("button", { name: "Изменить" }).nth(3).click(); // 3-я позиция (27010)
    const f = page.locator("form.grid.grid-cols-8").last();
    await f.locator("input[name=quantity]").fill("10");
    await f.locator("input[name=unitPrice]").fill("100");
    await f.getByRole("button", { name: "Сохранить" }).click();
    await page.waitForTimeout(1500);
    console.log("ПОСЛЕ правки (qty 5->10, цена 88->100):", await summary(page));
    console.log("ПОСЛЕ план:", await planCard(page));
    console.log("СТРОКИ:", (await page.locator("table").first().innerText()).replace(/\n/g, " | ").slice(0, 700));
    console.log("БД:", sqlOne(`select i."lotNumber"||' q='||i.quantity||' p='||i."unitPrice"||' plan='||(i."costPlan"->>'unitCostInclVat')||' planUSD='||coalesce(i."costPlan"->'costBreakdown'->'items'->0->>'value','?') from "PurchaseItem" i where i."lotNumber"='27010'`));
  });
  test("расход в черновике с costPlan и приёмка: распределяется ли расход по лотам", async ({ page }) => {
    await login(page);
    await page.goto(url);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Доставка" }).click();
    await page.locator("input.w-40").fill("100000");
    await page.getByRole("button", { name: "+ Добавить расход" }).click();
    await page.waitForTimeout(1500);
    console.log("С расходом 100 000:", await summary(page));
    await page.getByRole("button", { name: "Принять на склад" }).click();
    await page.waitForTimeout(3000);
    console.log("ПОСЛЕ ПРИЁМКИ:", await summary(page));
    console.log("лоты:", sqlOne(`select string_agg(l."lotNumber"||' q='||l."quantityReceived"||' u='||l."unitCost"||' t='||l."totalCost", E'\n') from "RawMaterialLot" l join "Purchase" p on p.id=l."purchaseId" where p.number='З-2026-0057'`));
    console.log("сумма лотов:", sqlOne(`select sum(l."quantityRemaining"*l."unitCost") from "RawMaterialLot" l join "Purchase" p on p.id=l."purchaseId" where p.number='З-2026-0057'`));
  });
});

test.describe.serial("СП 09-26: правка принятой позиции", () => {
  test("правка количества у принятой позиции с расчётом", async ({ page }) => {
    await login(page);
    await openPurchase(page, "З-2026-0056");
    const before = sqlOne(`select l."unitCost"||' / '||l."totalCost"||' / bd='||coalesce((l."costBreakdown"->'items'->0->>'value'),'null') from "RawMaterialLot" l where l."lotNumber"='1055' and l."purchaseId" is not null`);
    const planBefore = (await page.getByText("Расчёт себестоимости по лотам").locator("xpath=../..").innerText()).replace(/\n/g, " | ");
    console.log("ЛОТ ДО:", before);
    await page.getByRole("button", { name: "Изменить" }).first().click();
    const f = page.locator("form.grid.grid-cols-8").last();
    const q = await f.locator("input[name=quantity]").inputValue();
    await f.locator("input[name=quantity]").fill(String(Number(q) + 1));
    await f.getByRole("button", { name: "Сохранить" }).click();
    await page.waitForTimeout(2000);
    console.log("ЛОТ ПОСЛЕ qty+1:", sqlOne(`select l."unitCost"||' / '||l."totalCost"||' / q='||l."quantityReceived"||' bd='||coalesce((l."costBreakdown"->'items'->0->>'value'),'null') from "RawMaterialLot" l where l."lotNumber"='1055' and l."purchaseId" is not null`));
    console.log("КАРТОЧКА ПЛАН ДО:", planBefore.slice(250, 600));
    console.log("КАРТОЧКА ПЛАН ПОСЛЕ:", (await page.getByText("Расчёт себестоимости по лотам").locator("xpath=../..").innerText()).replace(/\n/g, " | ").slice(250, 600));
  });
});

// ---------- Подкладка ----------
async function buyLining(page: Page, o: { material?: string; newNumber?: string; meters: string; price: string; vat?: string }) {
  await page.goto("/lots?tab=lining");
  await page.waitForLoadState("networkidle");
  await page.getByText("+ Купить ткань").click();
  const form = page.locator("form", { has: page.locator("#lp-meters") });
  if (o.newNumber !== undefined) {
    await form.locator("#lp-material").selectOption("__new");
    await form.locator("input[name=newNumber]").fill(o.newNumber);
  } else if (o.material) await form.locator("#lp-material").selectOption({ label: o.material });
  await form.locator("#lp-meters").pressSequentially(o.meters);
  await form.locator("#lp-price").pressSequentially(o.price);
  if (o.vat !== undefined) {
    await form.getByText("Дополнительно").click();
    await form.locator("#lp-vat").fill(o.vat);
  }
  await form.getByRole("button", { name: "Добавить" }).click();
  const res = form.locator("p.text-red-600, p.text-green-700").first();
  await res.waitFor({ timeout: 15_000 }).catch(() => null);
  return (await res.innerText().catch(() => "(нет сообщения)")).trim();
}

test.describe.serial("подкладка: покупка ткани в пул", () => {
  test("докупка к ткани с нулевым остатком: стоимость пула", async ({ page }) => {
    await login(page);
    console.log("ПУЛ ДО:", sqlOne(`select "quantityReceived"||' rec, '||"quantityRemaining"||' rem, unit='||"unitCost"||', total='||"totalCost" from "RawMaterialLot" l join "RawMaterial" m on m.id=l."rawMaterialId" where m.name='Подкладочная ткань №4'`));
    console.log("1:", await buyLining(page, { material: "№4", meters: "10", price: "1000" }));
    console.log("ПУЛ ПОСЛЕ 10 м по 1000 без НДС (ожидаем остаток 12 200):", sqlOne(`select "quantityReceived"||' rec, '||"quantityRemaining"||' rem, unit='||"unitCost"||', total='||"totalCost"||', остаток*unit='||("quantityRemaining"*"unitCost") from "RawMaterialLot" l join "RawMaterial" m on m.id=l."rawMaterialId" where m.name='Подкладочная ткань №4'`));
    const row = page.locator("tr", { hasText: "Подкладочная ткань №4" }).first();
    console.log("СТРОКА В СПИСКЕ:", (await row.innerText()).replace(/\n/g, " | "));
  });
  test("валидация формы покупки ткани", async ({ page }) => {
    await login(page);
    console.log("новый №999:", await buyLining(page, { newNumber: "999", meters: "2,5", price: "100,50" }));
    console.log("повтор №999:", await buyLining(page, { newNumber: "999", meters: "1", price: "100" }));
    console.log("с «№ »:", await buyLining(page, { newNumber: "№ 999", meters: "1", price: "100" }));
    console.log("пробел в номере:", await buyLining(page, { newNumber: "12 3", meters: "1", price: "100" }));
    console.log("НДС 150:", await buyLining(page, { newNumber: "998", meters: "1", price: "100", vat: "150" }));
    console.log("нулевая цена:", await buyLining(page, { newNumber: "997", meters: "1", price: "0" }));
    console.log("ведущий ноль 0999:", await buyLining(page, { newNumber: "0999", meters: "1", price: "100" }));
    console.log("999 в БД:", sqlOne(`select string_agg(m.name||' '||l."quantityReceived"||' '||l."unitCost", '; ') from "RawMaterial" m join "RawMaterialLot" l on l."rawMaterialId"=m.id where m.name like '%99%'`));
  });
});

// ---------- Фильтры списка и тумблер НДС ----------
test.describe("список закупок: фильтры и согласованность тумблера НДС", () => {
  test.setTimeout(240_000);
  const num = (s: string) => Number(s.replace(/[^\d,-]/g, "").replace(",", "."));
  test("сумма в списке = «Итого» в карточке в обоих режимах для всех закупок", async ({ page }) => {
    await login(page);
    for (const mode of ["С НДС", "Без НДС"]) {
      await page.goto("/purchases");
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page.waitForTimeout(400);
      const rows = await page.locator("tbody tr").evaluateAll((trs) =>
        trs.map((tr) => ({ n: tr.children[0].textContent!.trim(), href: tr.querySelector("a")?.getAttribute("href") ?? "", sum: tr.children[6].textContent!.trim() })),
      );
      let bad = 0;
      for (const r of rows) {
        if (!r.href) continue;
        await page.goto(r.href);
        // режим хранится в cookie, поэтому в карточке уже выбран тот же режим
        const tot = await page.getByText("Итого (RUB)").locator("xpath=..").innerText();
        const a = num(r.sum), b = num(tot.replace("Итого (RUB)", ""));
        if (Math.abs(a - b) > 0.01) { bad++; console.log(`РАСХОЖДЕНИЕ [${mode}] ${r.n}: список=${r.sum} карточка=${tot.replace(/\n/g, " ")}`); }
      }
      console.log(`[${mode}] проверено ${rows.length}, расхождений ${bad}`);
    }
  });

  test("фильтры: статус, период (границы), аукцион, сброс", async ({ page }) => {
    await login(page);
    const count = async (qs: string) => { await page.goto("/purchases" + qs); return (await page.locator("tbody tr").filter({ hasNot: page.locator("td[colspan]") }).count()); };
    console.log("все:", await count(""));
    console.log("DRAFT:", await count("?status=DRAFT"), "RECEIVED:", await count("?status=RECEIVED"), "CANCELLED:", await count("?status=CANCELLED"));
    console.log("30.09 только:", await count("?from=2026-09-30&to=2026-09-30"), "(ожидаем З-2026-0057 и др. датой 30.09)");
    console.log("29.09 только:", await count("?from=2026-09-29&to=2026-09-29"));
    console.log("инвертированный период:", await count("?from=2026-10-01&to=2026-01-01"));
    console.log("аукцион 'сп 09':", await count("?auction=" + encodeURIComponent("сп 09")));
    console.log("аукцион спецсимволы %:", await count("?auction=" + encodeURIComponent("%")), await count("?auction=" + encodeURIComponent("'\"<script>")));
    console.log("мусорный статус:", await count("?status=HACK"), "мусорная дата:", await count("?from=abc"));
    console.log("поиск по номеру в auction:", await count("?auction=" + encodeURIComponent("З-2026-0050")));
    console.log("SQL: даты:", sqlOne(`select string_agg(number||'='||"orderDate"::text, ', ') from "Purchase" where number in ('З-2026-0057','З-2026-0050','З-2026-0049')`));
  });
});

// ---------- Шапка, курс, пустая закупка, дубли лотов ----------
test.describe.serial("шапка, курс и крайние случаи приёмки", () => {
  const sum = async (page: Page) => (await page.locator("div.grid").first().innerText()).replace(/\n/g, " ");
  test("СП 09-26 (черновик): смена курса не должна ломать суммы", async ({ page }) => {
    await login(page);
    await openPurchase(page, "З-2026-0055");
    console.log("КУРС 84,4075 →", await sum(page));
    const form = page.locator("form", { has: page.getByRole("button", { name: "Обновить курс" }) });
    await form.locator("input[name=exchangeRate]").fill("95");
    await form.getByRole("button", { name: "Обновить курс" }).click();
    await page.waitForTimeout(1500);
    console.log("КУРС 95 →", await sum(page));
    console.log("план (первые строки):", (await page.getByText("Расчёт себестоимости по лотам").locator("xpath=../..").innerText()).replace(/\n/g, " | ").slice(250, 520));
  });
  test("смена валюты в шапке сбрасывает курс", async ({ page }) => {
    await login(page);
    await openPurchase(page, "З-2026-0055");
    await page.getByRole("button", { name: "Изменить" }).first().click();
    await page.getByLabel("Валюта").selectOption("EUR");
    await page.getByRole("button", { name: "Сохранить" }).first().click();
    await page.waitForTimeout(1500);
    console.log("после смены валюты на EUR:", await sum(page), "| БД:", sqlOne(`select currency||' '||"exchangeRate" from "Purchase" where number='З-2026-0055'`));
  });
  test("приёмка пустой закупки и закупки с дублями лотов", async ({ page }) => {
    await login(page);
    page.on("dialog", (d) => d.accept());
    await openPurchase(page, "З-2026-0059");
    console.log("ПУСТАЯ: кнопки", await page.getByRole("button").allInnerTexts());
    await page.getByRole("button", { name: "Принять на склад" }).click();
    await page.waitForTimeout(2000);
    console.log("ПУСТАЯ после клика:", (await page.locator("p.text-red-600").allInnerTexts()), await page.getByText("Принято на склад").count());
    await openPurchase(page, "З-2026-0062");
    await page.getByRole("button", { name: "Принять на склад" }).click();
    await page.waitForTimeout(3000);
    console.log("ДУБЛИ принято:", await page.getByText("Принято на склад").count(), sqlOne(`select string_agg("lotNumber", ',') from "RawMaterialLot" where "lotNumber" in ('DUP-1','15016')`));
    await page.goto("/lots?q=DUP-1");
    console.log("ПОИСК DUP-1 в Сырьё:", (await page.locator("main").innerText()).replace(/\n/g, " | ").slice(-500));
  });
});

test.describe.serial("документы: партия и удаление", () => {
  test("документ ко всей партии виден на другой закупке партии, удаление убирает файл", async ({ page }) => {
    await login(page);
    await openPurchase(page, "З-2026-0057");
    console.log("загрузка в партию:", await upload(page, ["real.pdf"], { scope: "batch", kind: "SPECIFICATION" }));
    await openPurchase(page, "З-2026-0050");
    const t = await page.locator("body").innerText();
    console.log("на 0050 виден real.pdf (партия):", t.includes("real.pdf"), "| «Удалить» у документов партии:", await page.locator("li, div").filter({ hasText: /^real\.pdf/ }).getByRole("button", { name: "Удалить" }).count());
    // удалить документ закупки без confirm?
    await openPurchase(page, "З-2026-0057");
    const before = sqlOne(`select count(*) from "PurchaseDocument" where title='pic.png'`);
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs++; d.accept(); });
    const row = page.locator("div", { hasText: /^pic\.png/ }).first();
    await page.getByRole("button", { name: "Удалить" }).first().click();
    await page.waitForTimeout(2000);
    console.log("диалогов подтверждения при удалении документа:", dialogs, "| документов", before, "→", sqlOne(`select count(*) from "PurchaseDocument" where title='pic.png'`));
    console.log("файлов на диске:", require("node:child_process").execSync("find /tmp/fur-e2e/purch-uploads -type f | wc -l").toString().trim(), "записей в БД:", sqlOne(`select count(*) from "PurchaseDocument"`));
  });
});

test.describe.serial("вставка: реалистичные выгрузки Excel", () => {
  test("NBSP-тысячи, CRLF, кавычки, хвостовые табы, латиница-«двойник»", async ({ page }) => {
    await login(page);
    const nb = " ", nn = " ";
    const rows = [
      `Соболь\t10\t60${nb}355,15\t22\t8001\tК 2\t"тёмный, с пятнами"`,
      `Соболь\t2\t1${nn}000,5\t22\t8002\t\t\t\t`,
      `Cобoль\t3\t100\t22\t8003`, // латинские C и o
      `Соболь\t4\t100\t22\t8004\t\t\tлишний столбец`,
    ].join("\r\n");
    await fillNew(page, rows);
    const r = await submitNew(page); // без «Проверить»
    console.log("СОЗДАНО без проверки:", r);
    console.log("БД:", sqlOne(`select string_agg(m.name||'|'||m.unit||'|'||i.quantity||'|'||i."unitPrice"||'|'||coalesce(i."lotNumber",'')||'|'||coalesce(i.color,''), E'\n') from "PurchaseItem" i join "RawMaterial" m on m.id=i."rawMaterialId" where i."purchaseId"='${r.id}'`));
    console.log("новых материалов:", sqlOne(`select string_agg(name||' (создан '||"createdAt"||')', '; ') from "RawMaterial" where "createdAt" > now() - interval '5 minutes'`));
  });
  test("160 строк: время создания и приёмки", async ({ page }) => {
    await login(page);
    page.on("dialog", (d) => d.accept());
    const rows = Array.from({ length: 160 }, (_, i) => `Соболь\t${i + 1}\t${(1000 + i).toString().replace(".", ",")},50\t22\tBULK-${i + 1}\tК${i % 3}\tцвет${i % 5}`).join("\n");
    await fillNew(page, rows);
    let t = Date.now();
    const r = await submitNew(page);
    console.log("создание 160 строк, мс:", Date.now() - t, r.id ? "ok" : r.errors);
    t = Date.now();
    await page.getByRole("button", { name: "Принять на склад" }).click();
    await page.getByText("Принято на склад").first().waitFor({ timeout: 60_000 });
    console.log("приёмка 160 строк, мс:", Date.now() - t);
    console.log("лотов:", sqlOne(`select count(*) from "RawMaterialLot" where "lotNumber" like 'BULK-%'`));
  });
});

test.describe.serial("карточка закупки: вставка в существующий черновик, добавление и удаление позиции", () => {
  test("bulk, одна позиция, удаление", async ({ page }) => {
    await login(page);
    await openPurchase(page, "З-2026-0060");
    const n0 = sqlOne(`select count(*) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p.number='З-2026-0060'`);
    // вставка с ошибкой в одной строке
    await page.getByText("Вставить позиции из Excel").click();
    const ta = page.locator("textarea[name=rows]");
    await ta.fill("Соболь\t1\t100\t22\tX1\nСоболь\tдва\t100\t22\tX2");
    await page.getByRole("button", { name: "Добавить в закупку" }).click();
    await page.waitForTimeout(800);
    console.log("BULK с ошибкой:", (await page.locator(".bg-red-50").allInnerTexts()).join(" / ").replace(/\n/g, " "), "| строк:", sqlOne(`select count(*) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p.number='З-2026-0060'`), "было", n0, "| текст в поле сохранился:", (await ta.inputValue()).length > 0);
    await ta.fill("Соболь\t1\t100\t22\tX1\nСоболь\t2\t200\t22\tX2");
    await page.getByRole("button", { name: "Добавить в закупку" }).click();
    await page.waitForTimeout(1500);
    console.log("BULK ок: строк", sqlOne(`select count(*) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p.number='З-2026-0060'`), "| сообщение:", await page.getByText(/Добавлено позиций/).innerText().catch(() => "нет"));
    // одна позиция
    await page.getByText("Добавить одну позицию").click();
    const f = page.locator("form.grid.grid-cols-8").first();
    await f.locator("select[name=rawMaterialId]").selectOption({ label: "Норка (шт.)" });
    await f.locator("input[name=quantity]").pressSequentially("2,5");
    await f.locator("input[name=unitPrice]").pressSequentially("1999,99");
    await f.getByRole("button", { name: "+ Добавить позицию" }).click();
    await page.waitForTimeout(1500);
    console.log("ОДНА ПОЗИЦИЯ:", sqlOne(`select i.quantity||'x'||i."unitPrice"||'='||i.subtotal from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" join "RawMaterial" m on m.id=i."rawMaterialId" where p.number='З-2026-0060' and m.name='Норка'`));
    // удаление с отказом и согласием
    let n = 0;
    page.once("dialog", (d) => { n++; d.dismiss(); });
    await page.getByRole("button", { name: "Удалить" }).first().click();
    await page.waitForTimeout(800);
    const afterDismiss = sqlOne(`select count(*) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p.number='З-2026-0060'`);
    page.once("dialog", (d) => { n++; d.accept(); });
    await page.getByRole("button", { name: "Удалить" }).first().click();
    await page.waitForTimeout(1500);
    console.log("УДАЛЕНИЕ: после отказа", afterDismiss, "после согласия", sqlOne(`select count(*) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p.number='З-2026-0060'`), "диалогов", n);
  });
});
