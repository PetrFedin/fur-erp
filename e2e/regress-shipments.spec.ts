import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, TEST_USER } from "./helpers";

// Регрессия по «Отгрузкам» и «Примеркам». Самодостаточный спек: данные — через UI, а то, чего из UI
// не сделать (роли, второй заказчик, подмена тела запроса), — через SQL изолированной копии базы
// (scripts/e2e.sh up reg2 <порт>) и перехват запросов.
const DB = process.env.E2E_DB ?? "fur_erp_e2e_reg2";
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "fur-erp-db-1", "psql", "-U", "fur_erp", "-d", DB, "-At", "-c", q], {
    encoding: "utf8",
  }).trim();
}
const BCRYPT = "$2b$10$4GjnSssJqUQKMd1CV4W48.ElNt4xt63QzGqtRFKhIb6GnMVT89.0G"; // TestPass123!
const MB = 1024 * 1024;

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}

async function createOrder(page: Page, o: { model: string; qty?: string; client?: boolean; lots?: string }): Promise<string> {
  await page.goto("/production/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#modelText").fill(o.model);
  await page.locator("input[name=plannedQuantity]").fill(o.qty ?? "1");
  if (o.lots) await page.locator("textarea[name=lots]").fill(o.lots);
  if (o.client) await page.locator("select[name=clientId]").selectOption(client1);
  await page.getByRole("button", { name: "Создать ТЗ" }).click();
  await page.waitForURL(/\/production\/c[a-z0-9]{20,}$/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  return page.url().split("/").pop()!;
}

// Минимальные «настоящие» заголовки форматов: сервер проверяет сигнатуру, а не имя.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(40, 3)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(40, 4)]);
const FAKE = Buffer.from("это просто текст, а не картинка");

/** Заказчик: первый реальный (Меркури) и второй, созданный здесь. */
let client1 = "";
let client2 = "";
let orgId = "";

test.describe.serial("Отгрузки и примерки: регрессия", () => {
  test.beforeAll(() => {
    orgId = sql(`select "organizationId" from "User" where email='${TEST_USER.email}'`);
    client1 = sql(`select id from "Client" where "organizationId"='${orgId}' and id<>'rg_client2' order by name limit 1`);
    sql(`insert into "Client"(id,"organizationId",name,"isActive","createdAt","updatedAt") values ('rg_client2','${orgId}','Второй заказчик QA',true,now(),now()) on conflict (id) do nothing`);
    client2 = "rg_client2";
    for (const role of ["WAREHOUSE", "PURCHASER", "VIEWER", "ACCOUNTANT", "TECHNOLOGIST"]) {
      sql(
        `insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","createdAt","updatedAt") values ('rg_${role}','${orgId}','${role.toLowerCase()}@qa-test.ru','${BCRYPT}','${role}',` +
          `'${role}'::"UserRole",true,now(),now()) on conflict (email) do nothing`
      );
    }
  });

  async function openForm(page: Page, clientValue: string) {
    await page.goto("/shipments/new");
    await page.waitForLoadState("networkidle");
    await page.locator("#client").selectOption(clientValue);
  }

  test("(18)(12) строка размера: 0/пусто блокируют сохранение; лимиты количества и общий лимит", async ({ page }) => {
    await login(page);
    await openForm(page, client1);
    const first = page.locator("input[type=checkbox]").first();
    await first.check();
    const qty = page.locator("input[aria-label=Количество]").first();
    const save = page.getByRole("button", { name: "Сохранить отгрузку" });
    const err = page.locator("form p.text-red-600");
    await qty.fill("0");
    await save.click();
    await expect(err).toContainText("количество должно быть больше 0");
    await qty.fill("");
    await save.click();
    await expect(err).toContainText("не указано количество");
    await qty.fill("2.5");
    await save.click();
    await expect(err).toContainText("целым числом");
    await qty.fill("2147483648");
    await save.click();
    await expect(err).toContainText("не больше 100 000");
    await qty.fill("99999999999");
    await save.click();
    await expect(err).toContainText("не больше 100 000");
    // 11 строк по 100 000 -> общий лимит
    await qty.fill("100000");
    for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "+ размер" }).first().click();
    const all = page.locator("input[aria-label=Количество]");
    for (let i = 0; i < 11; i++) await all.nth(i).fill("100000");
    await save.click();
    await expect(err).toContainText("Общее количество в отгрузке не больше 1 000 000");
    expect(sql(`select count(*) from "Shipment"`)).toBe("0");
  });

  /** Подменяет тело server action «Сохранить отгрузку», чтобы проверить серверные ограничения. */
  async function tamper(page: Page, from: RegExp | string, to: string) {
    await page.route("**/shipments/new*", async (route) => {
      const req = route.request();
      const body = req.postData();
      if (req.method() === "POST" && body && req.headers()["next-action"]) {
        return route.continue({ postData: body.replace(from as never, to) });
      }
      return route.continue();
    });
  }

  test("(12) сервер: 2147483648, 99999999999, общий лимит — русская ошибка, не 500", async ({ page }) => {
    await login(page);
    const statuses: number[] = [];
    page.on("response", (r) => { if (r.request().method() === "POST") statuses.push(r.status()); });
    for (const big of ["2147483648", "99999999999"]) {
      await openForm(page, client1);
      await page.locator("input[type=checkbox]").first().check();
      await page.locator("input[aria-label=Количество]").first().fill("3");
      await page.unroute("**/shipments/new*").catch(() => {});
      await tamper(page, /"quantity":3/, `"quantity":${big}`);
      await page.getByRole("button", { name: "Сохранить отгрузку" }).click();
      await expect(page.locator("form p.text-red-600")).toContainText("Количество в строке не больше 100 000");
    }
    // общий лимит: 11 строк по 100 000 (клиентская проверка обойдена подменой 100000 -> 100000 в 11 строках)
    await openForm(page, client1);
    await page.locator("input[type=checkbox]").first().check();
    for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "+ размер" }).first().click();
    const all = page.locator("input[aria-label=Количество]");
    for (let i = 0; i < 11; i++) await all.nth(i).fill("1");
    await page.unroute("**/shipments/new*").catch(() => {});
    await tamper(page, /"quantity":1([,}])/g, `"quantity":100000$1`);
    await page.getByRole("button", { name: "Сохранить отгрузку" }).click();
    await expect(page.locator("form p.text-red-600")).toContainText("Общее количество в отгрузке не больше 1 000 000");
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(sql(`select count(*) from "Shipment"`)).toBe("0");
  });

  test("(16) русские ошибки: размер >40, заметка >2000, диапазон дат", async ({ page }) => {
    await login(page);
    await openForm(page, client1);
    await page.locator("input[type=checkbox]").first().check();
    const err = page.locator("form p.text-red-600");
    const save = page.getByRole("button", { name: "Сохранить отгрузку" });
    await page.locator("input[aria-label=Размер]").first().fill("X".repeat(41));
    await save.click();
    await expect(err).toContainText("Размер не длиннее 40 символов");
    await page.locator("input[aria-label=Размер]").first().fill("");
    // заметка >2000: убрали maxlength, как при вставке из буфера в обход
    await page.locator("#notes").evaluate((t: HTMLTextAreaElement) => t.removeAttribute("maxlength"));
    await page.locator("#notes").fill("я".repeat(2001));
    await save.click();
    await expect(err).toContainText("Заметка не длиннее 2000 символов");
    await page.locator("#notes").fill("");
    // даты: форма без браузерной проверки, чтобы увидеть наши сообщения
    await page.locator("form.max-w-3xl").evaluate((f) => f.setAttribute("novalidate", ""));
    for (const d of ["2019-12-31", "2100-01-02", "1999-05-05", "9999-12-31"]) {
      await page.locator("#plannedDate").fill(d);
      await save.click();
      await expect(err).toContainText("Дата должна быть между 01.01.2020 и 01.01.2100");
    }
    expect(sql(`select count(*) from "Shipment"`)).toBe("0");
    // серверные границы (подмена тела): размер 41 и заметка 2001 и дата 2019
    const cases: [RegExp, string, string][] = [
      [/"size":"QA1"/, `"size":"${"Ж".repeat(41)}"`, "Размер не длиннее 40 символов"],
      [/"notes":""/, `"notes":"${"я".repeat(2001)}"`, "Заметка не длиннее 2000 символов"],
      [/"plannedDate":"\d{4}-\d{2}-\d{2}"/, `"plannedDate":"2019-12-31"`, "Дата должна быть между"],
    ];
    for (const [from, to, msg] of cases) {
      await openForm(page, client1);
      await page.locator("input[type=checkbox]").first().check();
      await page.locator("input[aria-label=Размер]").first().fill("QA1");
      await page.unroute("**/shipments/new*").catch(() => {});
      await tamper(page, from, to);
      await page.getByRole("button", { name: "Сохранить отгрузку" }).click();
      await expect(page.locator("form p.text-red-600")).toContainText(msg);
    }
    expect(sql(`select count(*) from "Shipment"`)).toBe("0");
  });

  test("(13) отменённое ТЗ и ТЗ чужого заказчика: отгрузка отклоняется, кнопки нет", async ({ page }) => {
    await login(page);
    const cancelled = await createOrder(page, { model: "M002A", client: true });
    sql(`update "ProductionOrder" set status='CANCELLED', "workOrderNumber"='QA-CANC' where id='${cancelled}'`);
    await page.goto(`/production/${cancelled}`);
    await expect(page.getByRole("link", { name: "+ Отгрузка" })).toHaveCount(0);
    // форма: отменённого ТЗ нет в списке заказчика
    await openForm(page, client1);
    await expect(page.getByText("QA-CANC")).toHaveCount(0);
    // прямая ссылка ?order=<отменённое>
    await page.goto(`/shipments/new?order=${cancelled}`);
    await page.waitForLoadState("networkidle");
    const offered = await page.getByText("QA-CANC").count();
    console.log("NOTE: отменённое ТЗ предлагается в форме по ?order= :", offered > 0);
    if (offered > 0) {
      await page.getByRole("button", { name: "Сохранить отгрузку" }).click();
      await expect(page.locator("form p.text-red-600")).toContainText("отменённому ТЗ");
    }
    expect(sql(`select count(*) from "Shipment"`)).toBe("0");
    // чужой заказчик: ТЗ заказчика 1, а в запросе — заказчик 2 / без заказчика
    const live = await createOrder(page, { model: "M002A", client: true });
    sql(`update "ProductionOrder" set "workOrderNumber"='QA-LIVE' where id='${live}'`);
    for (const swap of [`"clientId":"${client2}"`, `"notes":""`]) {
      await openForm(page, client1);
      await page.locator("label", { hasText: "QA-LIVE" }).locator("input[type=checkbox]").check();
      await page.unroute("**/shipments/new*").catch(() => {});
      await tamper(page, /"clientId":"[^"]+"/, swap.startsWith('"clientId"') ? swap : `"x":1`);
      await page.getByRole("button", { name: "Сохранить отгрузку" }).click();
      await expect(page.locator("form p.text-red-600")).toContainText(
        swap.startsWith('"clientId"') ? "ТЗ не принадлежит выбранному заказчику" : "ТЗ не принадлежит выбранному заказчику"
      );
    }
    expect(sql(`select count(*) from "Shipment"`)).toBe("0");
    // нормальная отгрузка проходит
    await page.unroute("**/shipments/new*").catch(() => {});
    await openForm(page, client1);
    await page.locator("label", { hasText: "QA-LIVE" }).locator("input[type=checkbox]").check();
    await page.getByRole("button", { name: "Сохранить отгрузку" }).click();
    await page.waitForURL(/\/shipments\/c[a-z0-9]{20,}$/);
    await expect(page.getByText("Запланирована").first()).toBeVisible();
    expect(sql(`select count(*) from "Shipment"`)).toBe("1");
  });

  test("(14) подписи ТЗ в форме примерки уникальны; выбор ТЗ №19 работает", async ({ page }) => {
    await login(page);
    await page.goto("/fittings/new");
    await page.waitForLoadState("networkidle");
    const labels = await page.locator("#order-options option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(new Set(labels).size).toBe(labels.length);
    const l19 = labels.filter((l) => l.startsWith("ТЗ №19 ·"));
    console.log("ТЗ №19:", l19.join("\n"));
    expect(l19.length).toBe(3);
    for (const l of l19) {
      const number = /П-2026-\d{4}/.exec(l)![0];
      await page.goto("/fittings/new");
      await page.locator("#orderText").fill(l);
      await page.locator("#comment").fill(`проверка ${number}`);
      await page.getByRole("button", { name: "Сохранить" }).click();
      await page.waitForURL(/\/fittings\/c[a-z0-9]{20,}$/);
      const num = sql(`select o.number from "Fitting" f join "ProductionOrder" o on o.id=f."productionOrderId" where f.comment='проверка ${number}'`);
      expect(num).toBe(number);
    }
    // заглушка: неполное значение не принимается
    await page.goto("/fittings/new");
    await page.locator("#orderText").fill("ТЗ №19");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Выберите ТЗ из списка")).toBeVisible();
    // тот же выбор через ссылку с карточки ТЗ
    const id = sql(`select id from "ProductionOrder" where number='П-2026-0020'`);
    await page.goto(`/fittings/new?order=${id}`);
    await expect(page.locator("#orderText")).toHaveValue(/П-2026-0020/);
  });

  test("(15) роли без прав не видят «+ Новая отгрузка» / «+ Примерка»", async ({ page }) => {
    const id = sql(`select id from "ProductionOrder" where status='COMPLETED' limit 1`);
    for (const role of ["warehouse", "purchaser", "viewer", "accountant"]) {
      await loginAs(page, `${role}@qa-test.ru`);
      await page.goto("/shipments");
      await expect(page.getByRole("heading", { name: "Отгрузки" })).toBeVisible();
      await expect(page.getByRole("link", { name: "+ Новая отгрузка" }), role).toHaveCount(0);
      await page.goto("/fittings");
      await expect(page.getByRole("link", { name: "+ Примерка" }), role).toHaveCount(0);
      await page.goto(`/production/${id}`);
      await expect(page.getByRole("link", { name: "+ Отгрузка" }), role).toHaveCount(0);
      await expect(page.getByRole("link", { name: "+ Примерка" }), role).toHaveCount(0);
      for (const url of ["/shipments/new", "/fittings/new"]) {
        await page.goto(url);
        await expect(page, `${role} ${url}`).toHaveURL(/\/dashboard\?error=forbidden/);
        await expect(page.getByText("Недостаточно прав")).toBeVisible();
      }
      // API
      const r = await page.request.post("/api/fittings", { multipart: { orderId: id, date: "2026-10-01", status: "HELD_OK" } });
      expect(r.status(), role).toBe(403);
      const sh = sql(`select id from "Shipment" limit 1`);
      if (sh) {
        await page.goto(`/shipments/${sh}`);
        await expect(page.getByRole("button", { name: "Отметить отгруженной" }), role).toHaveCount(0);
      }
    }
    await loginAs(page, "technologist@qa-test.ru");
    await page.goto("/shipments");
    await expect(page.getByRole("link", { name: "+ Новая отгрузка" })).toBeVisible();
    await page.goto("/fittings");
    await expect(page.getByRole("link", { name: "+ Примерка" })).toBeVisible();
  });

  test("(16б) /api/fittings: диапазон дат 2020–2100 и статусы", async ({ page }) => {
    await login(page);
    const id = sql(`select id from "ProductionOrder" where number='П-2026-0020'`);
    for (const date of ["2019-12-31", "2100-01-02", "1990-01-01", "abc", ""]) {
      const r = await page.request.post("/api/fittings", { multipart: { orderId: id, date, status: "HELD_OK" } });
      expect(r.status(), date).toBe(400);
      expect((await r.json()).error).toContain("между 01.01.2020 и 01.01.2100");
    }
    for (const date of ["2020-01-01", "2100-01-01"]) {
      const r = await page.request.post("/api/fittings", { multipart: { orderId: id, date, status: "HELD_OK" } });
      expect(r.status(), date).toBe(200);
    }
    const r = await page.request.post("/api/fittings", { multipart: { orderId: id, date: "2026-10-01", status: "BAD" } });
    expect(r.status()).toBe(400);
    const r2 = await page.request.post("/api/fittings", { multipart: { orderId: "nope", date: "2026-10-01", status: "HELD_OK" } });
    expect(r2.status()).toBe(400);
  });

  test("(17) файлы: пустой, 10.00 МБ, общий 50 МБ, форматы, подделки", async ({ page }) => {
    await login(page);
    const id = sql(`select id from "ProductionOrder" where number='П-2026-0020'`);
    const junkBefore = sql(`select count(*) from "FittingPhoto" where "originalName" in ('fake.jpg','fake.png','doc.pdf','empty.jpg','big.jpg')`);
    const post = (files: { name: string; mimeType: string; buffer: Buffer }[]) =>
      page.request.post("/api/fittings", {
        multipart: { orderId: id, date: "2026-10-01", status: "HELD_OK", ...Object.fromEntries(files.map((f, i) => [`photos${i}`, f])) },
      });
    // Playwright multipart не допускает повтора имени поля; для нескольких файлов берём fetch из страницы.
    const upload = async (files: { name: string; type: string; bytes: number[] | number; head?: number[] }[]) =>
      page.evaluate(
        async ({ files, id }) => {
          const fd = new FormData();
          fd.set("orderId", id);
          fd.set("date", "2026-10-01");
          fd.set("status", "HELD_OK");
          for (const f of files) {
            const size = typeof f.bytes === "number" ? f.bytes : f.bytes.length;
            const arr = new Uint8Array(size);
            const head = f.head ?? (Array.isArray(f.bytes) ? f.bytes : []);
            head.forEach((b, i) => (arr[i] = b));
            fd.append("photos", new File([arr], f.name, { type: f.type }));
          }
          const res = await fetch("/api/fittings", { method: "POST", body: fd });
          return { status: res.status, body: await res.json().catch(() => null) };
        },
        { files, id }
      );
    void post;
    const JPG = [0xff, 0xd8, 0xff, 0xe0];
    const PNGH = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const WEBPH = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")];
    const HEICH = [0, 0, 0, 0x18, ...Buffer.from("ftypheic")];
    // пустой
    let r = await upload([{ name: "empty.jpg", type: "image/jpeg", bytes: 0 }]);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("пустой");
    // ровно 10 МБ проходит; 10 МБ + 1 байт — «10.00 МБ»
    r = await upload([{ name: "ten.jpg", type: "image/jpeg", bytes: 10 * MB, head: JPG }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await upload([{ name: "big.jpg", type: "image/jpeg", bytes: 10 * MB + 1, head: JPG }]);
    expect(r.status).toBe(400);
    console.log("10MB+1:", r.body.error);
    expect(r.body.error).toContain("10.00 МБ");
    // общий лимит: 6 x 9 МБ = 54 МБ
    r = await upload(Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.jpg`, type: "image/jpeg", bytes: 9 * MB, head: JPG })));
    expect(r.status).toBe(400);
    console.log("total:", r.body.error);
    expect(r.body.error).toContain("Общий размер фото больше 50 МБ");
    // 5 x 9.9 МБ = 49.5 МБ — проходит целиком
    r = await upload(Array.from({ length: 5 }, (_, i) => ({ name: `q${i}.jpg`, type: "image/jpeg", bytes: Math.floor(9.9 * MB), head: JPG })));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // форматы
    r = await upload([
      { name: "a.jpg", type: "image/jpeg", bytes: 100, head: JPG },
      { name: "b.png", type: "image/png", bytes: 100, head: PNGH },
      { name: "c.webp", type: "image/webp", bytes: 100, head: WEBPH },
      { name: "d.heic", type: "image/heic", bytes: 100, head: HEICH },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // HEIC без заявленного типа (Chrome на Windows/Linux отдаёт пустой type -> multipart «application/octet-stream»)
    r = await upload([{ name: "e.HEIC", type: "", bytes: 100, head: HEICH }]);
    expect.soft(r.status, "HEIC с пустым type: " + JSON.stringify(r.body)).toBe(200);
    // подделки
    for (const [name, type, bytes, head] of [
      ["fake.jpg", "image/jpeg", 100, []],
      ["fake.png", "image/png", 100, [0x89, 0x50, 0x4e, 0x47]],
      ["doc.pdf", "application/pdf", 100, [0x25, 0x50, 0x44, 0x46]],
      ["script.svg", "image/svg+xml", 100, []],
      ["x.jpg", "text/html", 100, JPG],
      ["noext", "", 100, JPG],
    ] as [string, string, number, number[]][]) {
      r = await upload([{ name, type, bytes, head }]);
      expect(r.status, name).toBe(400);
      expect(r.body.error, name).toContain("не является фото");
    }
    // 11 файлов
    r = await upload(Array.from({ length: 11 }, (_, i) => ({ name: `m${i}.jpg`, type: "image/jpeg", bytes: 100, head: JPG })));
    expect(r.status).toBe(400);
    void JPEG; void PNG; void WEBP; void HEIC; void FAKE;
    // допустимые файлы и после ошибок не оставляют мусора в БД: ни одной примерки с битыми файлами
    expect(sql(`select count(*) from "FittingPhoto" where "originalName" in ('fake.jpg','fake.png','doc.pdf','empty.jpg','big.jpg')`)).toBe(junkBefore);
  });

  test("(17б) UI примерки: выбор файлов, сообщения о размере", async ({ page }) => {
    await login(page);
    await page.goto("/fittings/new");
    await page.waitForLoadState("networkidle");
    await page.locator("#orderText").fill(
      await page.locator("#order-options option").first().evaluate((o) => (o as HTMLOptionElement).value)
    );
    const input = page.locator("input[type=file]");
    await input.setInputFiles([{ name: "big.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(10 * MB + 1, 7) }]);
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("form p.text-red-600")).toContainText("10.00 МБ");
    // фальшивка с заявленным image/jpeg: клиент пропускает, сервер отказывает по содержимому
    await page.reload();
    await page.locator("#orderText").fill(
      await page.locator("#order-options option").first().evaluate((o) => (o as HTMLOptionElement).value)
    );
    await input.setInputFiles([{ name: "fake.jpg", mimeType: "image/jpeg", buffer: FAKE }]);
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("form p.text-red-600")).toContainText("не является фото");
    // честный JPEG проходит
    await page.getByRole("button", { name: /Убрать fake.jpg/ }).click();
    await input.setInputFiles([{ name: "ok.jpg", mimeType: "image/jpeg", buffer: JPEG }]);
    await page.getByRole("button", { name: "Сохранить" }).click();
    await page.waitForURL(/\/fittings\/c[a-z0-9]{20,}$/);
    // добавление фото к существующей примерке
    await page.locator('input[type=file]').setInputFiles([{ name: "w.webp", mimeType: "image/webp", buffer: WEBP }, { name: "p.png", mimeType: "image/png", buffer: PNG }]);
    await page.getByRole("button", { name: /Загрузить \(2\)/ }).click();
    await expect(page.locator("img").nth(0)).toBeVisible();
    await page.waitForTimeout(800);
    const fid = page.url().split("/").pop()!;
    expect(sql(`select count(*) from "FittingPhoto" where "fittingId"='${fid}'`)).toBe("3");
  });

  test("(16в) примерка: итог/дата при правке, лимит комментария и размера", async ({ page }) => {
    await login(page);
    const fid = sql(`select id from "Fitting" order by "createdAt" desc limit 1`);
    await page.goto(`/fittings/${fid}`);
    await page.getByRole("button", { name: "Изменить" }).click();
    await page.locator("#e-date").evaluate((i: HTMLInputElement) => { i.removeAttribute("min"); i.removeAttribute("max"); i.closest("form")!.setAttribute("novalidate", ""); });
    await page.locator("#e-date").fill("2019-01-01");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Укажите дату примерки между 01.01.2020 и 01.01.2100")).toBeVisible();
  });
});
