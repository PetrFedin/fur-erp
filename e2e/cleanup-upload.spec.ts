import { test, expect, type Page, type Browser, type Locator } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { watchErrors } from "./helpers";

// ФАЗА A: загрузка и открытие оригиналов документов Drive (самодостаточный спек).
// Стенд: scripts/e2e.sh up cln 3311; cp -R uploads/purchase-docs /tmp/fur-e2e/cln-uploads/
const DB = "fur_erp_e2e_cln";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3311";
const UP = "/tmp/fur-e2e/cln-uploads";
const FX = "/tmp/fur-e2e/fx-cln";
const ORG = "cmuo7vwvk0000lsu5pghd5jka";
const PW = "TestPass123!";
export function sql(q: string): string {
  return execSync(`docker exec -i fur-erp-db-1 psql -U fur_erp -d ${DB} -At -F '|' -v ON_ERROR_STOP=1`, { encoding: "utf8", input: q }).trim();
}
const dd = () => path.join(UP, "drive-docs", ORG);
const diskFiles = () => (existsSync(dd()) ? readdirSync(dd()).sort() : []);
const F = (n: string) => path.join(FX, n);
const log = (...a: unknown[]) => console.log("##", ...a);
const finding = (...a: unknown[]) => console.log("!! FINDING:", ...a);

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(PW);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}
async function ctxAs(browser: Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await loginAs(page, email);
  return { ctx, page };
}

const PURCHASE = "/purchases/cmupc480j000fls7y1gqe2l9y";
const TZ = "/production/cmupc48gq01e9ls7y9leydosw";
const BATCH = "/production/batches/1";
const AUC = "/lots?auction=" + encodeURIComponent("SAGA 03.26");
const PAYMENTS = "/payments";

/** li документов, у которых есть «Загрузить файл» (нет файла) и уникальное название на странице. */
async function freeDocs(page: Page, n: number): Promise<Locator[]> {
  const lis = page.locator("li").filter({ has: page.getByText("Загрузить файл", { exact: true }) });
  const cnt = await lis.count();
  const titles: string[] = [];
  for (let i = 0; i < cnt; i++) titles.push(((await lis.nth(i).locator("span.font-medium").first().innerText()) || "").trim());
  const allLi = page.locator("li span.font-medium");
  const allTitles = (await allLi.allInnerTexts()).map((t) => t.trim());
  const out: Locator[] = [];
  for (let i = 0; i < cnt && out.length < n; i++) {
    if (allTitles.filter((t) => t === titles[i]).length === 1) out.push(page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: titles[i] }) }).first());
  }
  return out;
}
const liTitle = async (li: Locator) => (await li.locator("span.font-medium").first().innerText()).trim();

async function pickFile(li: Locator, file: string) {
  await li.locator('input[type=file]').first().setInputFiles(file);
}
const dbById = (id: string) =>
  sql(`select id,coalesce("storagePath",''),coalesce("storedMime",''),coalesce("storedName",''),coalesce("storedSize",0),coalesce("viewUrl",'') from "DriveDocument" where id='${id}'`).split("|");
const liOf = (page: Page, t: string) => page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t }) }).first();
async function idOfLi(li: Locator): Promise<string> {
  const href = (await li.locator('a[href*="/api/drive-docs/"]').first().getAttribute("href")) ?? "";
  return /drive-docs\/([^?/]+)/.exec(href)?.[1] ?? "";
}

type Seen = { status: number; headers: Record<string, string>; url: string };

async function checkApi(page: Page, id: string, mime: string, label: string) {
  const r = await page.request.get(`/api/drive-docs/${id}`, { maxRedirects: 0 });
  const h = r.headers();
  log(label, "GET", r.status(), h["content-type"], h["content-disposition"], "XFO", h["x-frame-options"], "CSP", h["content-security-policy"]);
  expect.soft(r.status(), `${label} GET 200`).toBe(200);
  expect.soft(h["content-type"], `${label} CT`).toBe(mime);
  expect.soft(h["x-frame-options"], `${label} XFO`).toBe("SAMEORIGIN");
  const inline = mime === "application/pdf" || mime.startsWith("image/");
  expect.soft(h["content-disposition"] ?? "", `${label} disposition`).toMatch(inline ? /^inline/ : /^attachment/);
  const d = await page.request.get(`/api/drive-docs/${id}?download=1`, { maxRedirects: 0 });
  expect.soft(d.headers()["content-disposition"] ?? "", `${label} ?download=1`).toMatch(/^attachment/);
  return r;
}

async function uploadCycle(page: Page, name: string, url: string, errors: string[]) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  const docs = await freeDocs(page, 6);
  log(name, "free docs found", docs.length);
  expect(docs.length).toBeGreaterThanOrEqual(1);
  const set = [
    ["ok.pdf", "application/pdf"],
    ["ok.png", "image/png"],
    ["ok.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["ok.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ] as const;
  const titles: string[] = [];
  for (let i = 0; i < docs.length; i++) titles.push(await liTitle(docs[i]));
  // положительные: до 4 разных документов
  const ids: Record<string, string> = {};
  const idByTitle: Record<string, string> = {};
  for (let i = 0; i < Math.min(4, docs.length); i++) {
    const [file, mime] = set[i];
    const t = titles[i];
    const li = page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t }) }).first();
    const before = diskFiles().length;
    await pickFile(li, F(file));
    const li2 = page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t }) }).first();
    await expect(li2.getByText("Файл в приложении")).toBeVisible({ timeout: 20000 });
    const id = await idOfLi(li2);
    const [, sp, sm, sn, ss] = dbById(id);
    log(name, file, "->", id, sp, sm, sn, ss);
    expect.soft(sm).toBe(mime);
    expect.soft(sn).toBe(file);
    expect.soft(diskFiles().length, `${name} ${file} disk +1`).toBe(before + 1);
    expect.soft(existsSync(path.join(UP, sp))).toBeTruthy();
    ids[file] = id;
    idByTitle[t] = id;
    await checkApi(page, id, mime, `${name} ${file}`);
    // предпросмотр
    const open = li2.getByRole("button", { name: "Открыть" });
    if (file === "ok.pdf" || file === "ok.png") {
      await open.click();
      const dlg = page.getByRole("dialog");
      await expect(dlg).toBeVisible();
      if (file === "ok.pdf") {
        const ifr = dlg.locator("iframe");
        await expect(ifr).toHaveAttribute("src", new RegExp(`/api/drive-docs/${id}`));
        await page.waitForTimeout(800);
      } else {
        const img = dlg.locator("img");
        await expect(img).toHaveAttribute("src", new RegExp(`/api/drive-docs/${id}`));
        await page.waitForTimeout(500);
        const w = await img.evaluate((e: HTMLImageElement) => e.naturalWidth);
        expect.soft(w, `${name} png naturalWidth`).toBeGreaterThan(0);
      }
      await page.screenshot({ path: `/tmp/fur-e2e/shots-cln/${name}-preview-${file}.png` });
      await page.keyboard.press("Escape");
      await expect(dlg).toBeHidden();
    } else {
      const href = await li2.getByRole("link", { name: "Открыть" }).getAttribute("href");
      log(name, file, "Открыть href", href);
      expect.soft(href).toContain("download=1");
    }
  }
  // отрицательные — на 5-м (или последнем свободном) документе
  const t5 = titles[Math.min(4, docs.length - 1)];
  const neg: [string, RegExp][] = [
    ["html-as.pdf", /не подходит/],
    ["exe-as.png", /не подходит/],
    ["empty.pdf", /Выберите файл|пуст/],
    ["t.txt", /не подходит/],
    ["over25.pdf", /больше лимита 25 МБ|больше 25 МБ/],
    ["big26.pdf", /Не удалось загрузить|больше|25 МБ/],
  ];
  const t5target = docs.length >= 5 ? t5 : null;
  if (t5target) {
    for (const [file, rx] of neg) {
      const li = page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t5target }) }).first();
      const before = diskFiles().length;
      await pickFile(li, F(file));
      const msg = li.locator("div.text-red-600");
      await expect(msg).toBeVisible({ timeout: 40000 });
      const text = (await msg.innerText()).trim();
      log(name, "REJECT", file, "->", text);
      expect.soft(text, `${name} ${file} msg`).toMatch(rx);
      expect.soft(/[А-Яа-я]/.test(text), `${name} ${file} russian`).toBeTruthy();
      expect.soft(diskFiles().length).toBe(before);
      await expect(li.getByText("Файл в приложении")).toBeHidden();
      await page.waitForTimeout(300);
    }
  } else log(name, "нет 5-го документа для отрицательных проверок");
  // замена файла: на первом документе (pdf → ok2.pdf)
  const t0 = titles[0];
  const [, oldPath] = dbById(idByTitle[t0]);
  let li0 = page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t0 }) }).first();
  await pickFile(li0, F("ok2.pdf"));
  await expect(async () => {
    const [, np] = dbById(idByTitle[t0]);
    expect(np).not.toBe(oldPath);
  }).toPass({ timeout: 15000 });
  const [, newPath, , , ns] = dbById(idByTitle[t0]);
  log(name, "REPLACE old", oldPath, "new", newPath, "size", ns);
  expect.soft(existsSync(path.join(UP, oldPath)), `${name} old file removed`).toBeFalsy();
  expect.soft(existsSync(path.join(UP, newPath))).toBeTruthy();
  expect.soft(Number(ns)).toBe(statSync(F("ok2.pdf")).size);
  // удалить файл у документа 2 (png): ссылка Drive остаётся, GET -> 302 drive.google.com
  if (docs.length >= 2) {
    const t1 = titles[1];
    const [id1, sp1] = dbById(idByTitle[t1]);
    page.once("dialog", (d) => d.accept());
    const li = page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t1 }) }).first();
    await li.getByRole("button", { name: "Удалить файл" }).click();
    await expect(page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t1 }) }).first().getByText("Файл в приложении")).toBeHidden({ timeout: 15000 });
    const [, sp1b, , , , v1] = dbById(id1);
    log(name, "DELETE FILE: storagePath after", JSON.stringify(sp1b), "viewUrl kept", !!v1, "disk removed", !existsSync(path.join(UP, sp1)));
    expect.soft(sp1b).toBe("");
    expect.soft(v1).toContain("drive.google.com");
    expect.soft(existsSync(path.join(UP, sp1))).toBeFalsy();
    const r = await page.request.get(`/api/drive-docs/${id1}`, { maxRedirects: 0 });
    log(name, "no-file GET", r.status(), r.headers()["location"]);
    expect.soft(r.status()).toBe(302);
    expect.soft(r.headers()["location"] ?? "").toContain("drive.google.com");
    const li3 = page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t1 }) }).first();
    await expect(li3.getByText("Загрузить файл", { exact: true })).toBeVisible();
    await expect(li3.getByRole("link", { name: "Открыть в Drive" })).toBeVisible();
  }
  return ids;
}

test.describe.configure({ mode: "default" });

test("0. фикстуры и база", async () => {
  const c = sql(`select count(*) from "DriveDocument" where "storagePath" is not null`);
  log("DriveDocument with file at start", c, "disk", diskFiles().length);
});

for (const [name, url] of [["purchase", PURCHASE], ["tz", TZ], ["batch", BATCH], ["payments", PAYMENTS], ["auction", AUC]] as const) {
  test(`1. загрузка файлов: ${name}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await loginAs(page, "anna@qa-test.ru");
    await uploadCycle(page, name, url, errors);
    log(name, "console errors:", JSON.stringify(errors));
  });
}

// ---------- 2. «+ Загрузить документ» ----------
const XSS = `<img src=x onerror="window.__xss=1">"'&`;
for (const [name, url] of [["purchase", PURCHASE], ["tz", TZ], ["batch", BATCH], ["payments", PAYMENTS], ["auction", AUC]] as const) {
  test(`2. + Загрузить документ: ${name}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs++; void d.dismiss(); });
    await loginAs(page, "anna@qa-test.ru");
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const summ = page.locator("summary", { hasText: /\+ Загрузить документ/ }).first();
    await expect(summ).toBeVisible();
    const form = page.locator("details").filter({ has: page.locator(":scope > summary", { hasText: /\+ Загрузить документ/ }) }).first();
    const open = async () => { if (!(await form.locator("form").first().isVisible())) await summ.click(); };
    const submit = async (file: string, title: string, type?: string) => {
      await open();
      await form.locator('input[type=file]').setInputFiles(file);
      await form.locator('input[name=title]').fill(title);
      if (type) await form.locator('select[name=docType]').selectOption(type);
      await form.getByRole("button", { name: "Загрузить" }).click();
    };
    const lastMsg = async () => {
      const m = form.locator("span.text-red-600, span.text-emerald-600").first();
      await expect(m).toBeVisible({ timeout: 40000 });
      return (await m.innerText()).trim();
    };
    const before = diskFiles().length;
    const nBefore = Number(sql(`select count(*) from "DriveDocument" where "storagePath" is not null`));
    // положительные
    const okCases: [string, string, string, string][] = [
      ["ok.pdf", XSS, "UPD", "application/pdf"],
      ["ok.png", "", "OTHER", "image/png"],
      ["ok.xlsx", "Таблица xlsx", "CALC_SHEET", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["ok.docx", "Документ docx", "CONTRACT", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ];
    for (const [file, title, type, mime] of okCases) {
      await submit(F(file), title, type);
      const msg = await lastMsg();
      log(name, "UPLOAD", file, JSON.stringify(title.slice(0, 20)), "->", msg);
      expect.soft(msg).toBe("Загружено");
      await page.waitForTimeout(700);
      const row = sql(`select id,title,"docType","storedMime","storedName","viewUrl" is null,"driveFileId" like 'local-%',coalesce("purchaseId",coalesce("productionOrderId",coalesce("productionBatchId",coalesce("paymentId",'?')))) from "DriveDocument" where "storedName"='${file}' order by "storedAt" desc limit 1`).split("|");
      log(name, "row", JSON.stringify(row));
      expect.soft(row[3]).toBe(mime);
      expect.soft(row[2]).toBe(type);
      expect.soft(row[5]).toBe("t");
      expect.soft(row[6]).toBe("t");
      const expectTitle = title === "" ? file.replace(/\.[a-z]+$/, "") : title.replace(/[\u0000-\u001f]/g, " ").trim();
      expect.soft(row[1], `${name} title`).toBe(expectTitle);
      await checkApi(page, row[0], mime, `${name} new ${file}`);
    }
    expect.soft(diskFiles().length).toBe(before + 4);
    await page.reload();
    await page.waitForLoadState("networkidle");
    const xss = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss);
    log(name, "XSS executed?", xss, "dialogs", dialogs, "img[src=x] count", await page.locator('img[src="x"]').count());
    expect.soft(xss).toBeUndefined();
    expect.soft(await page.locator('img[src="x"]').count()).toBe(0);
    const shown = await page.getByText(XSS, { exact: false }).count();
    log(name, "xss title shown as text:", shown);
    // отрицательные
    await open();
    const nbefore2 = diskFiles().length;
    for (const [file, rx] of [["html-as.pdf", /не подходит/], ["exe-as.png", /не подходит/], ["empty.pdf", /Выберите файл|пуст/], ["over25.pdf", /больше|25 МБ/], ["big26.pdf", /больше 25 МБ|Не удалось/]] as const) {
      const f2 = form;
      await f2.locator('input[type=file]').setInputFiles(F(file));
      await f2.getByRole("button", { name: "Загрузить" }).click();
      const m = f2.locator("span.text-red-600").first();
      await expect(m).toBeVisible({ timeout: 40000 });
      const t = (await m.innerText()).trim();
      log(name, "UPLOAD REJECT", file, "->", t);
      expect.soft(t, `${name} ${file}`).toMatch(rx);
      expect.soft(/[А-Яа-я]/.test(t)).toBeTruthy();
      await page.waitForTimeout(300);
    }
    expect.soft(diskFiles().length).toBe(nbefore2);
    // без файла: required (HTML5)
    const reqd = await form.locator('input[type=file]').evaluate((e: HTMLInputElement) => e.required);
    log(name, "file input required", reqd);
    log(name, "console errors", JSON.stringify(errors));
    log(name, "docs with file added", Number(sql(`select count(*) from "DriveDocument" where "storagePath" is not null`)) - nBefore);
  });
}

// ---------- 3. доступ: без входа, чужая организация, заголовки ----------
const docWithFile = (where: string) =>
  sql(`select id from "DriveDocument" where "storagePath" is not null and ${where} order by "storedAt" desc limit 1`);

test("3. 401 без входа, 404 чужой организации, заголовки X-Frame-Options", async ({ browser, playwright }) => {
  const id = docWithFile(`"purchaseId" is not null`);
  const idNoFile = sql(`select id from "DriveDocument" where "storagePath" is null and "viewUrl" is not null limit 1`);
  const anon = await playwright.request.newContext({ baseURL: BASE });
  for (const [label, u] of [["file", `/api/drive-docs/${id}`], ["download", `/api/drive-docs/${id}?download=1`], ["nofile", `/api/drive-docs/${idNoFile}`], ["nonexistent", `/api/drive-docs/zzz`]] as const) {
    const r = await anon.get(u, { maxRedirects: 0 });
    log("ANON", label, r.status(), "XFO", r.headers()["x-frame-options"], "loc", r.headers()["location"]);
    expect.soft(r.status(), `anon ${label}`).toBe(401);
    expect.soft(r.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  }
  const pd = sql(`select id from "PurchaseDocument" limit 1`);
  const r2 = await anon.get(`/api/purchase-docs/${pd}`, { maxRedirects: 0 });
  log("ANON purchase-docs", r2.status(), "XFO", r2.headers()["x-frame-options"]);
  expect.soft(r2.status()).toBe(401);
  expect.soft(r2.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  // чужая организация
  const { ctx, page } = await ctxAs(browser, "bob@other-org.ru");
  for (const [label, u] of [["file", `/api/drive-docs/${id}`], ["download", `/api/drive-docs/${id}?download=1`], ["nofile", `/api/drive-docs/${idNoFile}`]] as const) {
    const r = await page.request.get(u, { maxRedirects: 0 });
    log("ORG_B", label, r.status(), r.headers()["location"] ?? "");
    expect.soft(r.status(), `orgB ${label}`).toBe(404);
  }
  const r3 = await page.request.get(`/api/purchase-docs/${pd}`, { maxRedirects: 0 });
  log("ORG_B purchase-docs", r3.status());
  expect.soft(r3.status()).toBe(404);
  // в чужой организации не видно наших страниц
  const pr = await page.goto(PURCHASE);
  log("ORG_B purchase page status", pr?.status());
  expect.soft(pr?.status()).toBe(404);
  await ctx.close();
  // заголовки на других маршрутах
  const o = await ctxAs(browser, "anna@qa-test.ru");
  for (const u of ["/dashboard", "/login", "/api/auth/session", "/api/fittings", "/api/fittings/photo/zzz", "/api/drive-docs/" + id, "/api/purchase-docs/" + pd, "/payments", "/attention", "/lots"]) {
    const r = await o.page.request.get(u, { maxRedirects: 0 });
    const h = r.headers();
    const want = u.startsWith("/api/drive-docs/") || u.startsWith("/api/purchase-docs/") ? "SAMEORIGIN" : "DENY";
    log("HDR", u.slice(0, 40), r.status(), "XFO", h["x-frame-options"], "CSP", h["content-security-policy"], "XCTO", h["x-content-type-options"]);
    expect.soft(h["x-frame-options"], `XFO ${u}`).toBe(want);
  }
  // Чужие файлы без вмешательства пути: подмена id
  for (const bad of ["../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", "%00", "' OR 1=1 --"]) {
    const r = await o.page.request.get(`/api/drive-docs/${bad}`, { maxRedirects: 0 });
    log("BADID", bad, r.status());
    if (bad !== "%00") expect.soft([404, 400]).toContain(r.status());
  }
  await o.ctx.close();
  await anon.dispose();
});

test("3b. деактивированный пользователь теряет доступ к файлам сразу", async ({ browser }) => {
  const id = docWithFile(`"purchaseId" is not null`);
  const { ctx, page } = await ctxAs(browser, "viewer@qa-test.ru");
  let r = await page.request.get(`/api/drive-docs/${id}`, { maxRedirects: 0 });
  expect.soft(r.status()).toBe(200);
  sql(`update "User" set "isActive"=false where id='u_viewer'`);
  r = await page.request.get(`/api/drive-docs/${id}`, { maxRedirects: 0 });
  log("DEACTIVATED user GET", r.status());
  expect.soft(r.status()).toBe(401);
  sql(`update "User" set "isActive"=true where id='u_viewer'`);
  await ctx.close();
});

// ---------- 4. матрица ролей (UI) ----------
const EDIT: Record<string, string[]> = {
  purchase: ["OWNER", "ADMIN", "PURCHASER"],
  tz: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  batch: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  payments: ["OWNER", "ADMIN"],
  auction: ["OWNER", "ADMIN", "PURCHASER"],
};
const ROLE_USERS: [string, string][] = [["OWNER", "anna@qa-test.ru"], ["ADMIN", "admin@qa-test.ru"], ["PURCHASER", "purch@qa-test.ru"], ["TECHNOLOGIST", "tech@qa-test.ru"], ["ACCOUNTANT", "acc@qa-test.ru"], ["WAREHOUSE", "wh@qa-test.ru"], ["VIEWER", "viewer@qa-test.ru"]];
test("4. кнопки по ролям (UI)", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const [role, email] of ROLE_USERS) {
    const { ctx, page } = await ctxAs(browser, email);
    for (const [name, url] of [["purchase", PURCHASE], ["tz", TZ], ["batch", BATCH], ["payments", PAYMENTS], ["auction", AUC]] as const) {
      const resp = await page.goto(url);
      await page.waitForLoadState("networkidle");
      const cnt = async (t: string | RegExp) => page.getByText(t, { exact: typeof t === "string" }).count();
      const c = {
        загрузить: await page.getByText("Загрузить файл", { exact: true }).count(),
        заменить: await page.getByText("Заменить файл", { exact: true }).count(),
        удалитьФайл: await page.getByRole("button", { name: "Удалить файл" }).count(),
        убрать: await page.getByRole("button", { name: "Убрать", exact: true }).count(),
        плюсДок: await cnt(/\+ Загрузить документ/),
        плюсСсылка: await cnt(/\+ Добавить ссылку на Drive/),
      };
      const any = Object.values(c).reduce((a, b) => a + b, 0) > 0;
      const should = EDIT[name].includes(role);
      log("ROLE", role.padEnd(12), name.padEnd(9), "HTTP", resp?.status(), JSON.stringify(c), any === should ? "OK" : `!! ожидалось ${should ? "кнопки есть" : "кнопок нет"}`);
      if (resp?.status() === 200) expect.soft(any, `${role} ${name}`).toBe(should);
    }
    await ctx.close();
  }
});

// ---------- 5. сервер отказывает без права (повтор запросов server action от имени других ролей) ----------
type Cap = { url: string; headers: Record<string, string>; body: Buffer };
async function capture(page: Page, trigger: () => Promise<void>): Promise<Cap> {
  let cap: Cap | null = null;
  const h = async (route: import("@playwright/test").Route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) {
      cap = { url: req.url(), headers: req.headers(), body: req.postDataBuffer() ?? Buffer.alloc(0) };
      await route.abort();
    } else await route.continue();
  };
  await page.route("**/*", h);
  try { await trigger(); await page.waitForTimeout(600); } finally { await page.unroute("**/*", h); }
  if (!cap) throw new Error("запрос server action не перехвачен");
  return cap;
}
async function replay(page: Page, c: Cap): Promise<string> {
  const headers: Record<string, string> = {};
  for (const k of ["content-type", "next-action", "accept", "next-router-state-tree"]) if (c.headers[k]) headers[k] = c.headers[k];
  if (process.env.DBG) console.log("CAPDBG", c.headers["content-type"], c.body.length, JSON.stringify(c.body.toString("latin1").slice(0, 700)));
  // Chromium не отдаёт байты файла в postDataBuffer (пустая часть) — вставляем содержимое ok.pdf сами.
  const pdf = readFileSync(F("ok.pdf")).toString("latin1");
  const text = c.body.toString("latin1").replace("Content-Type: application/pdf\r\n\r\n\r\n--", `Content-Type: application/pdf\r\n\r\n${pdf}\r\n--`);
  const r = await page.request.post(c.url, { headers, data: Buffer.from(text, "latin1") });
  return (await r.text()).slice(0, 600);
}

test("5. права на сервере: server action по ролям", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await ctxAs(browser, "anna@qa-test.ru");
  const po = owner.page;
  // «цели»: документ ТЗ (ссылка Drive) без файла, документ закупки без файла, документ с файлом и ссылкой
  const tzDoc = sql(`select id from "DriveDocument" where "productionOrderId" is not null and "storagePath" is null and "viewUrl" is not null limit 1`);
  const purDoc = sql(`select id from "DriveDocument" where "purchaseId" is not null and "storagePath" is null and "viewUrl" is not null limit 1`);
  const payDoc = sql(`select id from "DriveDocument" where "paymentId" is not null and "storagePath" is null and "viewUrl" is not null limit 1`);
  const orderId = sql(`select "productionOrderId" from "DriveDocument" where id='${tzDoc}'`);
  const purId = sql(`select "purchaseId" from "DriveDocument" where id='${purDoc}'`);
  const payId = sql(`select "paymentId" from "DriveDocument" where id='${payDoc}'`);
  log("targets", { tzDoc, purDoc, payDoc, orderId, purId, payId });
  // Захват: «Загрузить файл» (uploadDriveDocumentFile) — сделаем из UI с разных страниц
  const capFile: Record<string, Cap> = {};
  for (const [k, url, id] of [["tz", `/production/${orderId}`, tzDoc], ["purchase", `/purchases/${purId}`, purDoc]] as const) {
    await po.goto(url);
    await po.waitForLoadState("networkidle");
    const li = po.locator("li").filter({ has: po.locator('input[type=file]') }).filter({ hasText: (await po.evaluate(() => "")) || "" }).first();
    void li; void id;
  }
  // Проще: берём первую пару li с «Загрузить файл» на странице нужного объекта; id найдём по DB после реальной загрузки.
  async function capUploadFileFor(url: string): Promise<Cap> {
    await po.goto(url);
    await po.waitForLoadState("networkidle");
    const li = po.locator("li").filter({ has: po.getByText("Загрузить файл", { exact: true }) }).first();
    return capture(po, async () => { await li.locator("input[type=file]").setInputFiles(F("ok.pdf")); });
  }
  capFile.tz = await capUploadFileFor(`/production/${orderId}`);
  capFile.purchase = await capUploadFileFor(`/purchases/${purId}`);
  capFile.payment = await capUploadFileFor(PAYMENTS);
  // Какой документ в каждом перехвате — по сохранённому в теле id ("[\"<id>\",\"$K1\"]")
  const idOf = (c: Cap) => /"(c[a-z0-9]{20,})"/.exec(c.body.toString("latin1"))?.[1] ?? "";
  const targets = { tz: idOf(capFile.tz), purchase: idOf(capFile.purchase), payment: idOf(capFile.payment) };
  log("captured file-upload targets", targets);
  // Захват uploadDriveDocument (новый документ) на каждой сущности
  async function capNew(url: string): Promise<Cap> {
    await po.goto(url);
    await po.waitForLoadState("networkidle");
    const form = po.locator("details").filter({ has: po.locator(":scope > summary", { hasText: /\+ Загрузить документ/ }) }).first();
    await form.locator("summary").click();
    await form.locator("input[type=file]").setInputFiles(F("ok.pdf"));
    return capture(po, async () => { await form.getByRole("button", { name: "Загрузить" }).click(); });
  }
  const capNewDoc = { tz: await capNew(`/production/${orderId}`), purchase: await capNew(`/purchases/${purId}`), payment: await capNew(PAYMENTS) };
  // Захват removeDriveDocumentFile и removeDriveDocument: сперва реально положим файл на документы, потом перехватим «Удалить файл»/«Убрать»
  async function prepWithFile(docId: string, url: string) {
    // реальная загрузка через UI
    await po.goto(url);
    await po.waitForLoadState("networkidle");
  }
  void prepWithFile;
  const cntBefore = () => sql(`select count(*) from "DriveDocument"`);
  const filesBefore = () => sql(`select count(*) from "DriveDocument" where "storagePath" is not null`);
  const matrix: [string, string[], "tz" | "purchase" | "payment"][] = [];
  for (const [role] of ROLE_USERS) for (const t of ["tz", "purchase", "payment"] as const) matrix.push([role, [], t]);
  const allowed: Record<string, string[]> = { tz: ["OWNER", "ADMIN", "TECHNOLOGIST"], purchase: ["OWNER", "ADMIN", "PURCHASER"], payment: ["OWNER", "ADMIN"] };
  // --- uploadDriveDocumentFile (замена/загрузка файла у существующего документа)
  for (const [role, email] of process.env.ONLY_RM ? [] : ROLE_USERS) {
    const { ctx, page } = await ctxAs(browser, email);
    for (const t of ["tz", "purchase", "payment"] as const) {
      const id = targets[t];
      const before = sql(`select coalesce("storagePath",'-') from "DriveDocument" where id='${id}'`);
      const resp = await replay(page, capFile[t]);
      if (role === "OWNER") log("OWNER replay raw", t, resp.slice(0, 300).replace(/\n/g, "\\n"));
      const after = sql(`select coalesce("storagePath",'-') from "DriveDocument" where id='${id}'`);
      const changed = before !== after;
      const should = allowed[t].includes(role);
      const err = /Недостаточно прав[^"]*/.exec(resp)?.[0] ?? "";
      log("SRV uploadFile", role.padEnd(12), t.padEnd(8), changed ? "ФАЙЛ ЗАПИСАН" : "не изменён", err ? `msg="${err}"` : "", changed === should ? "OK" : "!! НАРУШЕНИЕ ПРАВ");
      expect.soft(changed, `uploadFile ${role} ${t}`).toBe(should);
      if (!should) expect.soft(err, `msg ${role} ${t}`).toMatch(/Недостаточно прав/);
    }
    // --- uploadDriveDocument (новый документ с файлом)
    for (const t of ["tz", "purchase", "payment"] as const) {
      const n0 = Number(cntBefore());
      const resp = await replay(page, capNewDoc[t]);
      const created = Number(cntBefore()) - n0;
      const should = allowed[t].includes(role);
      const err = /Недостаточно прав[^"]*/.exec(resp)?.[0] ?? "";
      log("SRV uploadNew ", role.padEnd(12), t.padEnd(8), created ? `создано ${created}` : "не создано", err ? `msg="${err}"` : "", (created > 0) === should ? "OK" : "!! НАРУШЕНИЕ ПРАВ");
      expect.soft(created > 0, `uploadNew ${role} ${t}`).toBe(should);
      if (!should) expect.soft(err).toMatch(/Недостаточно прав/);
    }
    await ctx.close();
  }
  // --- removeDriveDocumentFile и removeDriveDocument: перехват из UI владельца (запрос не уходит), повтор от других ролей
  for (const t of ["tz", "purchase", "payment"] as const) {
    const col = t === "tz" ? "productionOrderId" : t === "purchase" ? "purchaseId" : "paymentId";
    const [id, owner_] = sql(`select id, "${col}" from "DriveDocument" where "${col}" is not null and "storagePath" is not null and "viewUrl" is not null order by "storedAt" desc limit 1`).split("|");
    const url = t === "tz" ? `/production/${owner_}` : t === "purchase" ? `/purchases/${owner_}` : t === "payment" ? PAYMENTS : "";
    if (t === "payment") { /* оплата без привязки к закупке видна на /payments, иначе — на карточке закупки */ }
    await po.goto(url);
    await po.waitForLoadState("networkidle");
    const li = po.locator("li").filter({ has: po.locator(`a[href^="/api/drive-docs/${id}"]`) }).first();
    log("SRV remove li count", t, await li.count(), "hasFile", sql(`select coalesce("storagePath",'-') from "DriveDocument" where id='${id}'`));
    if (!(await li.count())) { log("SRV remove: нет li для", t, id); continue; }
    po.once("dialog", (d) => d.accept());
    const capRmFile = await capture(po, async () => { await li.getByRole("button", { name: "Удалить файл" }).click(); });
    await po.reload();
    await po.waitForLoadState("networkidle");
    const li2 = po.locator("li").filter({ has: po.locator(`a[href^="/api/drive-docs/${id}"]`) }).first();
    po.once("dialog", (d) => d.accept());
    const capRm = await capture(po, async () => { await li2.getByRole("button", { name: "Убрать", exact: true }).click(); });
    for (const [role, email] of ROLE_USERS.filter(([r]) => !allowed[t].includes(r))) {
      const { ctx, page } = await ctxAs(browser, email);
      const f0 = sql(`select coalesce("storagePath",'-') from "DriveDocument" where id='${id}'`);
      const r1 = await replay(page, capRmFile);
      const f1 = sql(`select coalesce("storagePath",'-') from "DriveDocument" where id='${id}'`);
      const r2 = await replay(page, capRm);
      const exists = sql(`select count(*) from "DriveDocument" where id='${id}'`);
      log("SRV remove    ", role.padEnd(12), t.padEnd(8), "file kept", f0 === f1, "doc kept", exists === "1", "msgs", /Недостаточно прав[^"]*/.exec(r1)?.[0], "|", /Недостаточно прав[^"]*/.exec(r2)?.[0]);
      expect.soft(f0, `removeFile ${role} ${t}`).toBe(f1);
      expect.soft(exists, `remove ${role} ${t}`).toBe("1");
      await ctx.close();
    }
  }
  await owner.ctx.close();
  log("files on disk", diskFiles().length, "db with file", filesBefore());
});

// ---------- 6. общий файл у нескольких строк (скрипт attach-local-drive-files) и удаление ----------
test("6. общий файл: «Убрать»/«Удалить файл» у одной строки не ломает остальные", async ({ page }) => {
  await loginAs(page, "anna@qa-test.ru");
  const rows = sql(`select id,coalesce("productionOrderId",''),coalesce("productionBatchId",''),"storagePath" from "DriveDocument" where "storedName"='МФВМ_000022.pdf'`).split("\n").map((l) => l.split("|"));
  expect(rows.length).toBe(5);
  const shared = rows[0][3];
  for (const r of rows) {
    const resp = await page.request.get(`/api/drive-docs/${r[0]}`, { maxRedirects: 0 });
    expect.soft(resp.status()).toBe(200);
    expect.soft(resp.headers()["content-type"]).toBe("application/pdf");
  }
  // 1) «Убрать» у ТЗ-строки
  const tzRow = rows.find((r) => r[1]) as string[];
  await page.goto(`/production/${tzRow[1]}`);
  await page.waitForLoadState("networkidle");
  page.once("dialog", (d) => { log("confirm:", d.message()); void d.accept(); });
  const li = page.locator("li").filter({ has: page.locator(`a[href^="/api/drive-docs/${tzRow[0]}"]`) }).first();
  await li.getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(page.locator(`a[href^="/api/drive-docs/${tzRow[0]}"]`)).toHaveCount(0, { timeout: 15000 });
  log("after Убрать: file on disk", existsSync(path.join(UP, shared)), "rows left", sql(`select count(*) from "DriveDocument" where "storagePath"='${shared}'`));
  expect.soft(existsSync(path.join(UP, shared))).toBeTruthy();
  // 2) «Удалить файл» у другой ТЗ-строки
  const tzRow2 = rows.filter((r) => r[1] && r[0] !== tzRow[0])[0];
  await page.goto(`/production/${tzRow2[1]}`);
  await page.waitForLoadState("networkidle");
  page.once("dialog", (d) => { log("confirm:", d.message()); void d.accept(); });
  const li2 = page.locator("li").filter({ has: page.locator(`a[href^="/api/drive-docs/${tzRow2[0]}"]`) }).first();
  await li2.getByRole("button", { name: "Удалить файл" }).click();
  await expect(page.locator(`a[href^="/api/drive-docs/${tzRow2[0]}"]`)).toHaveCount(0, { timeout: 15000 });
  log("after Удалить файл: file on disk", existsSync(path.join(UP, shared)), "rows with path", sql(`select count(*) from "DriveDocument" where "storagePath"='${shared}'`));
  expect.soft(existsSync(path.join(UP, shared))).toBeTruthy();
  const other = rows.filter((r) => r[0] !== tzRow[0] && r[0] !== tzRow2[0])[0];
  const resp = await page.request.get(`/api/drive-docs/${other[0]}`, { maxRedirects: 0 });
  expect.soft(resp.status()).toBe(200);
  // 3) локальный документ без ссылки: «Убрать» удаляет и файл
  const localDoc = sql(`select id,"storagePath",coalesce("purchaseId",'') from "DriveDocument" where "driveFileId" like 'local-%' and "purchaseId" is not null limit 1`).split("|");
  await page.goto(`/purchases/${localDoc[2]}`);
  await page.waitForLoadState("networkidle");
  let msg = "";
  page.once("dialog", (d) => { msg = d.message(); void d.accept(); });
  const li3 = page.locator("li").filter({ has: page.locator(`a[href^="/api/drive-docs/${localDoc[0]}"]`) }).first();
  const hasDl = await li3.getByRole("button", { name: "Удалить файл" }).count();
  log("local-only doc: кнопка «Удалить файл» есть?", hasDl, "(без ссылки на Drive удалять только документом)");
  await li3.getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(page.locator(`a[href^="/api/drive-docs/${localDoc[0]}"]`)).toHaveCount(0, { timeout: 15000 });
  log("local-only Убрать confirm:", msg, "file removed", !existsSync(path.join(UP, localDoc[1])));
  expect.soft(existsSync(path.join(UP, localDoc[1]))).toBeFalsy();
  expect.soft(hasDl).toBe(0);
});

// ---------- 7. сироты на диске ----------
test("7. нет файлов-сирот: диск = БД", async () => {
  const dbPaths = sql(`select "storagePath" from "DriveDocument" where "storagePath" is not null union select "storagePath" from "PurchaseDocument" where "storagePath" like 'drive-docs/%'`).split("\n").filter(Boolean).sort();
  const disk = diskFiles().map((f) => `drive-docs/${ORG}/${f}`);
  const orphans = disk.filter((d) => !dbPaths.includes(d));
  const missing = dbPaths.filter((d) => !disk.includes(d));
  log("orphans on disk:", JSON.stringify(orphans), "missing on disk:", JSON.stringify(missing));
  expect.soft(orphans).toEqual([]);
  expect.soft(missing).toEqual([]);
});

test("8. имена файлов: XSS, кириллица, длинное имя, заголовки", async ({ page }) => {
  const errors = watchErrors(page);
  let dlg = 0;
  page.on("dialog", (d) => { dlg++; void d.dismiss(); });
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(PURCHASE);
  await page.waitForLoadState("networkidle");
  const form = page.locator("details").filter({ has: page.locator(":scope > summary", { hasText: /\+ Загрузить документ/ }) }).first();
  const long = "a".repeat(230) + ".pdf";
  for (const name of [long]) {
    await form.locator("summary").click().catch(() => {});
    if (!(await form.locator("form").first().isVisible())) await form.locator("summary").click();
    await form.locator("input[type=file]").setInputFiles(F(name));
    await form.locator("input[name=title]").fill("");
    await form.getByRole("button", { name: "Загрузить" }).click();
    await expect(form.locator("span.text-emerald-600, span.text-red-600").first()).toBeVisible({ timeout: 15000 });
    const msg = await form.locator("span.text-emerald-600, span.text-red-600").first().innerText();
    const row = sql(`select id,title,"storedName",length("storedName") from "DriveDocument" where "storedAt" is not null order by "storedAt" desc limit 1`).split("|");
    log("NAME", name.slice(0, 30), "msg", msg, "title", row[1].slice(0, 60), "storedName len", row[3], row[2].slice(0, 50));
    const r = await page.request.get(`/api/drive-docs/${row[0]}`, { maxRedirects: 0 });
    log("   header", r.status(), r.headers()["content-disposition"]?.slice(0, 160));
    await page.waitForTimeout(500);
  }
  await page.reload();
  await page.waitForLoadState("networkidle");
  log("dialogs", dlg, "img[src=x]", await page.locator('img[src="x"]').count(), "errors", JSON.stringify(errors));
});

// ---------- 9. единые числа ----------
const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const num = (s: string) => Number(norm(s).replace(/[^\d,\-]/g, "").replace(",", "."));
const moneyTokens = (s: string) => (norm(s).match(/-?\d[\d ]*,\d\d(?= ₽)/g) ?? []).map(num);
const DEBT_SQL = `
with pt as (
 select p.id, p.status, nullif(trim(split_part(coalesce(p."auctionSession",''),E'\\n',1)),'') a,
  coalesce((select sum(case when i."costPlan"->>'unitCostInclVat' is not null and i."costPlan"->>'materialExclVat' is not null and i."costPlan"->>'expenseExclVat' is not null
        then (i."costPlan"->>'unitCostInclVat')::numeric*i.quantity else i.subtotal*p."exchangeRate"*(1+i."vatRate"/100) end) from "PurchaseItem" i where i."purchaseId"=p.id),0)
  + coalesce((select sum(e.amount*(1+e."vatRate"/100)) from "PurchaseExpense" e where e."purchaseId"=p.id),0) tot,
  coalesce((select sum(y.amount) from "Payment" y where y."purchaseId"=p.id and y.status='COMPLETED'),0) paid
 from "Purchase" p),
na as (select coalesce(sum(greatest(tot-paid,0)),0) due from pt where a is null and status<>'CANCELLED'),
au as (select a, sum(tot) filter (where status<>'CANCELLED') tot, sum(paid) pp from pt where a is not null group by a),
aup as (select trim(split_part("auctionSession",E'\\n',1)) a, sum(amount) s from "Payment" where "purchaseId" is null and "auctionSession" is not null and status='COMPLETED' group by 1),
aur as (select au.a, coalesce(au.tot,0)-au.pp-coalesce(aup.s,0) rem from au left join aup on aup.a=au.a),
adv as (select coalesce(sum(amount),0) s from "Payment" where "purchaseId" is null and "auctionSession" is null and status='COMPLETED')
select round(greatest((select due from na)+coalesce((select sum(rem) filter (where rem>0.005) from aur),0)-(select s from adv),0),2),
       round((select sum(tot) filter (where status<>'CANCELLED') from pt),2)`;

test("9. единые числа: долг поставщику, куплено сырья, партии/ТЗ, срезы", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  const [debtSql, boughtSql] = sql(DEBT_SQL).split("|").map(Number);
  log("SQL debt", debtSql, "bought", boughtSql);
  // Сводка
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  const debtTile = page.locator("text=Долг поставщику").first().locator("xpath=ancestor::*[self::div or self::section][1]");
  const debtTitle = await page.locator('span[title]').filter({ hasText: "млн" }).evaluateAll((els) => els.map((e) => `${e.textContent}|${e.getAttribute("title")}`));
  log("Dashboard tiles (text|title)", JSON.stringify(debtTitle));
  const tileText = norm(await debtTile.innerText());
  log("Dashboard debt tile:", tileText);
  const dashDebt = num((await page.locator('span[title]').filter({ hasText: "млн" }).evaluateAll((els) => els.map((e) => e.getAttribute("title")!)))[3] ?? "0");
  const titles = await page.locator('span[title]').filter({ hasText: "млн" }).evaluateAll((els) => els.map((e) => e.getAttribute("title")!));
  log("dash titles", JSON.stringify(titles));
  // Оплаты
  await page.goto("/payments");
  await page.waitForLoadState("networkidle");
  const payTxt = norm(await page.locator("body").innerText());
  const rest = /Остаток к оплате ([\d ]+,\d\d) ₽/.exec(payTxt);
  const buy = /Стоимость закупок, с НДС ([\d ]+,\d\d)/.exec(payTxt);
  const paidT = /Оплачено ([\d ]+,\d\d) ₽/.exec(payTxt);
  const advT = /Авансы без привязки ([\d ]+,\d\d)/.exec(payTxt);
  log("Payments:", "стоимость", buy?.[1], "оплачено", paidT?.[1], "авансы", advT?.[1], "остаток", rest?.[1]);
  const payDebt = num(rest![1]);
  expect.soft(Math.abs(payDebt - debtSql), "payments debt vs SQL").toBeLessThan(0.02);
  expect.soft(Math.abs(num(buy![1]) - boughtSql), "стоимость закупок vs SQL").toBeLessThan(0.02);
  expect.soft(Math.abs(num(buy![1]) - num(paidT![1]) - num(advT![1]) - payDebt), "формула расшифровки").toBeLessThan(0.02);
  const dashDebtV = titles.map(num).find((v) => Math.abs(v - debtSql) < 0.02);
  log("Dashboard has tile with title == SQL debt:", dashDebtV, "bought tile:", titles.map(num).find((v) => Math.abs(v - boughtSql) < 0.02));
  expect.soft(dashDebtV, "dashboard debt tile title").toBeDefined();
  void dashDebt;
  // «Остаток» в таблице аукционов: Σ по видимым + «Прочее» + закупки без аукциона
  const remList = [...(payTxt.matchAll(/ ([\d ]+,\d\d) ₽ (?:Не оплачен|Частично|Оплачен)/g))].map((m) => num(m[1]));
  log("visible auctions remaining sum", remList.reduce((a, b) => a + b, 0).toFixed(2), "n", remList.length);
  // Сводка по годам
  await page.goto("/lots?tab=summary");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
  type Row = { depth: number; name: string; m: number[] };
  const rows: Row[] = await page.evaluate(() => {
    const out: { depth: number; name: string; text: string }[] = [];
    document.querySelectorAll("main details, details").forEach((d) => {
      const s = d.querySelector(":scope > summary");
      if (!s) return;
      let depth = 0;
      let p = d.parentElement;
      while (p) { if (p.tagName === "DETAILS") depth++; p = p.parentElement; }
      out.push({ depth, name: (s.textContent ?? "").slice(0, 60), text: s.textContent ?? "" });
    });
    return out;
  }).then((r) => r.map((x) => ({ depth: x.depth, name: x.name, m: moneyTokens(x.text.replace(/₽/g, " ₽ ")) })));
  const totalRow = norm(await page.locator("body").innerText());
  const itog = /Итого[\s\S]*?([\d ]+,\d\d) ₽[\s\S]*?([\d ]+,\d\d) ₽[\s\S]*?([\d ]+,\d\d) ₽[\s\S]*?([\d ]+,\d\d) ₽/.exec(totalRow);
  log("summary Итого (цена, с расх., оплачено, остаток):", itog?.slice(1, 5).join(" | "));
  const byDepth: Record<number, number[][]> = {};
  for (const r of rows) (byDepth[r.depth] ??= []).push(r.m);
  for (const d of Object.keys(byDepth)) {
    const mm = byDepth[Number(d)].filter((m) => m.length >= 4);
    log(`summary depth ${d}: rows ${mm.length}`, "Σ с расходами", mm.reduce((a, m) => a + m[1], 0).toFixed(2), "Σ оплачено", mm.reduce((a, m) => a + m[2], 0).toFixed(2), "Σ остаток", mm.reduce((a, m) => a + m[3], 0).toFixed(2));
  }
  const years = byDepth[0]?.filter((m) => m.length >= 4) ?? [];
  expect.soft(Math.abs(years.reduce((a, m) => a + m[1], 0) - boughtSql), "Σ по годам с расходами vs SQL «Куплено»").toBeLessThan(1);
  const d1 = byDepth[1]?.filter((m) => m.length >= 4) ?? [];
  expect.soft(Math.abs(d1.reduce((a, m) => a + m[1], 0) - boughtSql), "Σ по аукционам vs SQL").toBeLessThan(1);
  const d2 = byDepth[2]?.filter((m) => m.length >= 4) ?? [];
  expect.soft(Math.abs(d2.reduce((a, m) => a + m[1], 0) - boughtSql), "Σ по типам сырья vs SQL").toBeLessThan(1);
  const advLine = /Авансы без аукциона: ([\d ]+,\d\d) ₽/.exec(totalRow);
  const remTot = itog ? num(itog[4]) : NaN;
  log("summary: остаток Итого", remTot, "− авансы", advLine?.[1], "=", (remTot - num(advLine![1])).toFixed(2), "vs Долг поставщику", debtSql, "Δ", (remTot - num(advLine![1]) - debtSql).toFixed(2));
  expect.soft(Math.abs(remTot - num(advLine![1]) - debtSql), "summary остаток − авансы vs Долг").toBeLessThan(0.02);
  log("console errors:", JSON.stringify(errors));
});

// ---------- 10. чистка интерфейса ----------
const BAD = /\bNaN\b|undefined|\[object|\bnull\b|Infinity/;
test("10a. дубли блоков, редиректы, «Без аукциона»", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  // закупка: один блок «Документы»
  for (const [num, id] of sql(`select number,id from "Purchase" where number in ('З-2026-0002','З-2026-0060','З-2026-0049','З-2026-0050') order by number`).split("\n").map((l) => l.split("|"))) {
    await page.goto(`/purchases/${id}`);
    await page.waitForLoadState("networkidle");
    const heads = (await page.locator("h1,h2,h3,[class*=CardTitle],div.font-semibold,div.font-medium").allInnerTexts()).map((t) => norm(t)).filter((t) => /^Документ/.test(t));
    const dup = await page.getByText(/×\d+/).count();
    const driveBlocks = await page.locator("[data-drive-docs]").count();
    const summaries = (await page.locator("summary").allInnerTexts()).map(norm).filter((t) => /загруз|добав|ссыл|документ/i.test(t));
    log("PURCHASE", num, "doc headings:", JSON.stringify(heads), "×N groups:", dup, "drive-docs sections:", driveBlocks, "form summaries:", JSON.stringify(summaries));
    const txt = await page.locator("body").innerText();
    expect.soft(heads.filter((h) => /^Документы/.test(h)).length, `${num} blocks`).toBeLessThanOrEqual(1);
    expect.soft(/Документы Google Drive/.test(txt), `${num} old drive heading`).toBeFalsy();
    expect.soft(BAD.test(txt), `${num} bad`).toBeFalsy();
  }
  // редиректы
  for (const [from, rx] of [["/raw-materials?q=15874", /\/lots\?q=15874/], ["/raw-materials", /\/lots$/], ["/raw-materials?material=abc&auction=SAGA%2003-26", /\/lots\?/], ["/models", /\/articles$/], ["/models?q=M001", /\/articles\?q=M001/], ["/finished-stock", /\/articles$/]] as const) {
    const r = await page.goto(from);
    log("REDIRECT", from, "->", page.url().replace(BASE, ""), r?.status());
    expect.soft(page.url().replace(BASE, ""), from).toMatch(rx);
  }
  // меню / ссылки на старые адреса
  await page.goto("/dashboard");
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  log("links to old routes on dashboard:", JSON.stringify(hrefs.filter((h) => /raw-materials|\/models|finished-stock/.test(h ?? ""))));
  // «Без аукциона» вместо служебных меток
  const targets = ["/purchases", "/lots", "/payments", "/lots?tab=summary", "/attention"];
  for (const u of targets) {
    await page.goto(u);
    await page.waitForLoadState("networkidle");
    const t = await page.locator("body").innerText();
    const opts = await page.locator("select option, a, button").allInnerTexts();
    const svc = [...t.matchAll(/Нет информации|Не в реестре[^\n]*|реконструирован[^\n]*|Подкладочные материалы[^\n]*|Доп закупк[^\n]*/gi)].map((m) => m[0]);
    log("SERVICE LABELS", u, "text:", JSON.stringify([...new Set(svc)]), "«Без аукциона» count:", (t.match(/Без аукциона/g) ?? []).length, "options w/ service:", JSON.stringify(opts.filter((o) => /Нет информации|Не в реестре/i.test(o)).slice(0, 3)));
    expect.soft(BAD.test(t), `${u} bad`).toBeFalsy();
  }
  // «Остаток к оплате» на карточке закупки
  await page.goto(`/purchases/${sql(`select id from "Purchase" where number='З-2026-0002'`)}`);
  const pt = norm(await page.locator("body").innerText());
  log("PURCHASE 0002 has «Остаток к оплате»?", /Остаток к оплате/.test(pt), "«остаток по аукциону»", /остаток по аукциону/.test(pt));
  log("console errors:", JSON.stringify(errors));
});

test("10b. режим «Аукцион»: 4 плитки, один переключатель, оба вида", async ({ page }) => {
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  for (const a of ["SAGA 03.26", "СП 09.26", "FH 06.26", "Подкладка 07.25"]) {
    for (const view of ["", "&view=lots"]) {
      await page.goto(`/lots?auction=${encodeURIComponent(a)}${view}`);
      await page.waitForLoadState("networkidle");
      const t = await page.locator("body").innerText();
      const labels = ["Закупок / шкур", "Цена шкур по счетам", "С расходами", "Остаток к оплате"].map((l) => t.includes(l));
      const adv = /Расширенный поиск/.test(t);
      const switches = await page.getByRole("link", { name: /По счетам|Списком лотов/ }).count() + await page.getByRole("button", { name: /По счетам|Списком лотов/ }).count();
      const tilesOld = ["Шкур всего", "Расходы сверх цены", "Закупок / счетов"].filter((l) => t.includes(l));
      log("AUCTION", a, view || "(по счетам)", "tiles", JSON.stringify(labels), "Расширенный поиск:", adv, "switch controls:", switches, "old tile labels:", JSON.stringify(tilesOld), "bad:", BAD.test(t));
      expect.soft(labels.every(Boolean), `${a} tiles`).toBeTruthy();
      expect.soft(adv).toBeFalsy();
      expect.soft(BAD.test(t)).toBeFalsy();
      await page.screenshot({ path: `/tmp/fur-e2e/shots-cln/auction-${a.slice(0, 6).replace(/\W/g, "_")}${view ? "-lots" : ""}.png`, fullPage: false });
    }
  }
  log("console errors:", JSON.stringify(errors));
});

test("10c. «Изделия»: цена по Enter/blur, без кнопок «Сохранить»", async ({ page }) => {
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto("/articles");
  await page.waitForLoadState("networkidle");
  const saveBtns = await page.getByRole("button", { name: /Сохранить/ }).count();
  log("«Сохранить» кнопок на /articles:", saveBtns);
  expect.soft(saveBtns).toBe(0);
  const inputs = page.locator('input[aria-label="Розничная цена"]');
  const n = await inputs.count();
  log("price inputs", n);
  const m1 = sql(`select id,coalesce("sellingPrice",0) from "ProductModel" where "sellingPrice" is not null order by name limit 1`).split("|");
  const row = page.locator("tr", { has: page.locator(`form#price-${m1[0]}`) });
  const inp = row.locator('input[aria-label="Розничная цена"]');
  const orig = await inp.inputValue();
  // Enter
  await inp.fill("12345.67");
  await inp.press("Enter");
  await expect(row.getByText("Задана")).toBeVisible({ timeout: 10000 });
  log("after Enter DB:", sql(`select "sellingPrice" from "ProductModel" where id='${m1[0]}'`));
  expect.soft(Number(sql(`select "sellingPrice" from "ProductModel" where id='${m1[0]}'`))).toBe(12345.67);
  // blur
  await inp.fill("23456.78");
  await page.locator("h1").first().click();
  await expect(async () => expect(Number(sql(`select "sellingPrice" from "ProductModel" where id='${m1[0]}'`))).toBe(23456.78)).toPass({ timeout: 10000 });
  log("after blur DB ok");
  // без изменений — не сохраняет
  const upd = sql(`select "updatedAt" from "ProductModel" where id='${m1[0]}'`);
  await inp.focus(); await page.locator("h1").first().click();
  await page.waitForTimeout(500);
  expect.soft(sql(`select "updatedAt" from "ProductModel" where id='${m1[0]}'`)).toBe(upd);
  // пустое / отрицательное / огромное
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.accept(); });
  for (const bad of ["", "-5", "99999999999999999999"]) {
    await inp.fill(bad);
    await inp.press("Enter");
    await page.waitForTimeout(800);
    log("BAD PRICE", JSON.stringify(bad), "dialogs:", JSON.stringify(dialogs.splice(0)), "DB:", sql(`select "sellingPrice" from "ProductModel" where id='${m1[0]}'`), "status text:", norm(await row.locator("span.text-xs").first().innerText()));
  }
  await page.goto("/articles");
  await page.locator(`form#price-${m1[0]} input`).fill(orig || "0");
  await page.locator(`form#price-${m1[0]} input`).press("Enter");
  await page.waitForTimeout(800);
  // роли: TECHNOLOGIST может, VIEWER — нет
  log("console errors:", JSON.stringify(errors));
});

test("10d. ТЗ/партии: «Отгрузки (0) · Примерки (0)», пустые партии, план/факт, режимы НДС и 4%", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  const tzs = sql(`select id,number from "ProductionOrder" where status<>'CANCELLED' order by random() limit 8`).split("\n").map((l) => l.split("|"));
  const pages: [string, string][] = [["/dashboard", "dash"], ["/payments", "pay"], ["/lots", "lots"], ["/lots?tab=summary", "sum"], ["/lots?auction=SAGA%2003-26", "auc"], ["/purchases/" + sql(`select id from "Purchase" where number='З-2026-0049'`), "pur"], ["/production", "prod"], ["/production/batches", "batches"], ["/production/batches/5", "b5"], ["/articles", "art"], ["/attention", "att"], ["/production/" + tzs[0][0], "tzA"], [`/production/${sql(`select id from "ProductionOrder" where number='П-2026-0001'`)}`, "tz1"]];
  for (const t of tzs.slice(1)) pages.push([`/production/${t[0]}`, `tz-${t[1]}`]);
  for (const [vat, c4] of [["incl", "off"], ["excl", "off"], ["incl", "on"], ["excl", "on"]]) {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: vat === "incl" ? "С НДС" : "Без НДС", exact: true }).click();
    await page.getByRole("button", { name: c4 === "on" ? "С 4%" : "Без 4%", exact: true }).click();
    await page.waitForTimeout(500);
    for (const [u, tag] of pages) {
      await page.goto(u);
      await page.waitForLoadState("networkidle");
      const t = await page.locator("body").innerText();
      const m = BAD.exec(t);
      if (m) { finding("mode", vat, c4, u, "содержит", m[0], "…", t.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\n/g, " ")); }
      expect.soft(m, `${vat}/${c4} ${u}`).toBeNull();
      if (tag.startsWith("tz")) {
        const line = /Отгрузки \(\d+\)[^\n]*/.exec(t)?.[0];
        if (vat === "incl" && c4 === "off") log("TZ", tag, "shipments line:", JSON.stringify(line), "«Отгрузок пока нет»:", t.includes("Отгрузок пока нет"), "«Примерок пока нет»:", t.includes("Примерок пока нет"), "План/факт:", /план \d+[^\n]{0,20}факт/.exec(t)?.[0]);
      }
    }
    log("mode", vat, c4, "checked", pages.length, "pages");
    if (vat === "excl" && c4 === "on") {
      await page.goto("/dashboard");
      log("dash excl+4% tiles:", JSON.stringify(await page.locator("span[title]").filter({ hasText: "млн" }).evaluateAll((e) => e.map((x) => `${x.textContent}|${x.getAttribute("title")}`))));
      await page.goto("/payments");
      log("payments excl+4%:", norm(await page.locator("body").innerText()).slice(100, 700));
    }
  }
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "С НДС", exact: true }).click();
  await page.getByRole("button", { name: "Без 4%", exact: true }).click();
  log("console errors:", JSON.stringify(errors));
});

// ---------- 11. /attention ----------
test("11. /attention: числа vs SQL, фильтры, серые, ссылки", async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  const Q: Record<string, string> = {
    "Закупки без документов": `select count(*) from "Purchase" p where p.status<>'CANCELLED'
      and not exists (select 1 from "PurchaseDocument" d where d."purchaseId"=p.id)
      and not exists (select 1 from "DriveDocument" d where d."purchaseId"=p.id)
      and not exists (select 1 from "DriveDocument" d join "RawMaterialLot" l on l.id=d."lotId" where l."purchaseId"=p.id)
      and not exists (select 1 from "PurchaseDocument" d where d."purchaseId" is null and d.batch is not null and d.batch = nullif(trim(split_part(coalesce(p."auctionSession",''),E'\\n',1)),''))`,
    "ТЗ без списаний сырья": `select count(*) from "ProductionOrder" o where o.status<>'CANCELLED' and not exists (select 1 from "ProductionMaterialUsage" u where u."productionOrderId"=o.id)`,
    "Авансы без привязки к аукциону": `select count(*) from "Payment" where status<>'CANCELLED' and "purchaseId" is null and coalesce("auctionSession",'')=''`,
    "ТЗ без даты": `select count(*) from "ProductionOrder" o where o.status<>'CANCELLED' and o."workOrderDate" is null`,
    "Партии без оплат": `select count(*) from "ProductionBatch" b where exists (select 1 from "ProductionOrder" o where o."batchId"=b.id and o.status<>'CANCELLED')
      and not exists (select 1 from "ProductionOrder" o join "ProductionPaymentOrder" l on l."productionOrderId"=o.id join "ProductionPayment" p on p.id=l."productionPaymentId" and p.status<>'CANCELLED' where o."batchId"=b.id and o.status<>'CANCELLED')`,
  };
  await page.goto("/attention");
  await page.waitForLoadState("networkidle");
  const cards = await page.locator("details.group").evaluateAll((ds) =>
    ds.map((d) => ({ title: d.querySelector("summary span.font-medium")?.textContent?.trim() ?? "", count: Number([...d.querySelectorAll("summary span.rounded-full")].map((e) => e.textContent?.trim() ?? "").find((t) => /^\d+$/.test(t)) ?? "NaN") })),
  );
  log("attention cards:", JSON.stringify(cards));
  for (const [title, q] of Object.entries(Q)) {
    const s = Number(sql(q));
    const c = cards.find((x) => x.title === title);
    log("CHECK", title.padEnd(34), "SQL", s, "UI", c?.count, s === c?.count ? "OK" : "!! РАСХОЖДЕНИЕ");
    expect.soft(c?.count, title).toBe(s);
  }
  // итоги
  const head = norm(await page.locator('[aria-label="Фильтры"]').innerText());
  log("filters:", head);
  const sumUI = cards.reduce((a, c) => a + c.count, 0);
  log("Σ по карточкам:", sumUI);
  // сводка на Сводке
  await page.goto("/dashboard");
  const dash = norm(await page.locator("text=Требует внимания").first().locator("xpath=ancestor::*[self::div][1]").innerText());
  log("dashboard tile:", dash);
  // Фильтры
  const counts = async () => {
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    return page.locator("details.group li a").count();
  };
  await page.goto("/attention");
  const allLinks = await counts();
  const grayDots = await page.locator('details.group li span[title="Справочно"]').count();
  log("all items shown (<=150 per card)", allLinks, "gray dots", grayDots);
  await page.goto("/attention?gray=hide");
  const noGray = await counts();
  const grayDots2 = await page.locator('details.group li span[title="Справочно"]').count();
  log("gray=hide items", noGray, "gray dots left", grayDots2, "chip text:", norm(await page.locator('[aria-label="Фильтры"]').innerText()));
  expect.soft(grayDots2).toBe(0);
  expect.soft(allLinks - noGray).toBe(grayDots);
  for (const s of ["purchases", "production", "data"]) {
    await page.goto(`/attention?section=${s}`);
    const n = await counts();
    const chip = norm(await page.locator('[aria-label="Фильтры"] a').filter({ hasText: s === "purchases" ? "Закупки" : s === "production" ? "Производство" : "Данные" }).first().innerText());
    const secH = await page.locator("h2").allInnerTexts();
    log("section", s, "items", n, "chip", chip, "sections shown", JSON.stringify(secH));
    await page.goto(`/attention?section=${s}&gray=hide`);
    const n2 = await counts();
    log("   +gray=hide items", n2);
  }
  await page.getByRole("link", { name: /Скрыть серые|Показать серые/ }).click();
  log("toggle link works →", page.url().replace(BASE, ""));
  // Ссылки «Открыть»
  await page.goto("/attention");
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
  const links = await page.locator("details.group li a").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href") ?? "", text: a.textContent?.trim() ?? "", row: (a.closest("li")?.textContent ?? "").trim().slice(0, 80) })));
  const uniq = [...new Map(links.map((l) => [l.href, l])).values()];
  log("links total", links.length, "unique", uniq.length, "labels", JSON.stringify([...new Set(links.map((l) => l.text))]));
  const bad: string[] = [];
  const cookies = await page.context().cookies();
  for (const l of uniq) {
    const r = await page.request.get(l.href.split("#")[0], { maxRedirects: 5 });
    const body = r.status() === 200 ? await r.text() : "";
    const is404 = r.status() >= 400 || /This page could not be found/.test(body.slice(0, 20000));
    if (is404) bad.push(`${r.status()} ${l.href} (${l.row})`);
  }
  void cookies; void request;
  log("BROKEN LINKS:", bad.length, JSON.stringify(bad.slice(0, 10)));
  expect.soft(bad).toEqual([]);
  // выборочно в браузере: первые 30 ссылок — открывается карточка, не 404, нет ошибок консоли
  const first30 = uniq.slice(0, 30);
  let fails = 0;
  for (const l of first30) {
    const r = await page.goto(l.href);
    const t = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    if (!r || r.status() >= 400 || /не найден|404/i.test(t)) { fails++; log("OPEN FAIL", l.href, r?.status(), t); }
  }
  log("browser-opened first 30:", first30.length, "fails", fails);
  log("console errors:", JSON.stringify(errors));
});

test("12. мобильный 375: нет горизонтального скролла, «Режимы»", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU", viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  const tz1 = sql(`select id from "ProductionOrder" where number='П-2026-0001'`);
  const urls = ["/dashboard", "/purchases", "/purchases/" + sql(`select id from "Purchase" where number='З-2026-0002'`), "/production", "/production/" + tz1, "/production/batches", "/production/batches/5", "/lots", "/lots?tab=summary", "/lots?auction=SAGA%2003-26", "/payments", "/attention", "/articles"];
  for (const u of urls) {
    await page.goto(u);
    await page.waitForLoadState("networkidle");
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth, wide: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest("[class*=overflow-x]") && getComputedStyle(e).position !== "fixed").slice(0, 3).map((e) => e.tagName + "." + String(e.className).slice(0, 40)) }));
    const modes = await page.getByRole("button", { name: /Режимы/ }).count();
    log("MOBILE", u.slice(0, 40), "scrollW", m.sw, "clientW", m.cw, "Режимы btn", modes, m.sw > m.cw ? "!! ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ " + JSON.stringify(m.wide) : "OK");
    expect.soft(m.sw, u).toBeLessThanOrEqual(m.cw);
  }
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Режимы/ }).click();
  await page.screenshot({ path: "/tmp/fur-e2e/shots-cln/mobile-modes.png" });
  log("modes panel buttons:", JSON.stringify(await page.getByRole("button", { name: /НДС|4%/ }).allInnerTexts()));
  log("console errors:", JSON.stringify(errors));
  await ctx.close();
});
