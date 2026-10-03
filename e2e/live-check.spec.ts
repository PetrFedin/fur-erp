import { test, expect, type Page, type Locator } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

// Загрузка и выдача файлов документов на КОПИИ боевой базы (самодостаточный спек, без networkidle, таймауты 20 с).
// Стенд:  scripts/e2e.sh up liv 3341 && cp -R uploads/purchase-docs /tmp/fur-e2e/liv-uploads/
// Запуск: E2E_BASE_URL=http://localhost:3341 npx playwright test -c e2e/playwright.config.ts live-check
// Снос:   scripts/e2e.sh down liv
// Боевую базу (fur_erp) и порты 3000/3200 спек не трогает: SQL идёт только в fur_erp_e2e_liv.
const DB = "fur_erp_e2e_liv";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3341";
const UP = "/tmp/fur-e2e/liv-uploads";
const FX = "/tmp/fur-e2e/fx-liv";
const ORG = "cmuo7vwvk0000lsu5pghd5jka";
const RUN = Date.now().toString(36);
const T = 20_000;
const log = (...a: unknown[]) => console.log("##", ...a);
test.use({ actionTimeout: T, navigationTimeout: T });
test.describe.configure({ timeout: 240_000 });

function sql(q: string): string {
  if (!/^fur_erp_e2e_/.test(DB)) throw new Error("SQL только в копии базы");
  return execSync(`docker exec -i fur-erp-db-1 psql -U fur_erp -d ${DB} -At -F '|' -v ON_ERROR_STOP=1`, { encoding: "utf8", input: q }).trim();
}
const dd = () => path.join(UP, "drive-docs", ORG);
const diskFiles = () => (existsSync(dd()) ? readdirSync(dd()).sort() : []);
const F = (n: string) => path.join(FX, n);

// ---------- фикстуры (создаются тут же) ----------
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
function pdf(label: string, pad = 0): Buffer {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  return Buffer.concat([Buffer.from(body), Buffer.alloc(pad, 0x20)]);
}
function zipFixture(name: string, entries: Record<string, string>) {
  const dir = path.join(FX, "z-" + name);
  rmSync(dir, { recursive: true, force: true });
  for (const [e, c] of Object.entries(entries)) {
    mkdirSync(path.dirname(path.join(dir, e)), { recursive: true });
    writeFileSync(path.join(dir, e), c);
  }
  rmSync(F(name), { force: true });
  execSync(`cd '${dir}' && zip -qr '${F(name)}' .`);
}
test.beforeAll(() => {
  mkdirSync(FX, { recursive: true });
  writeFileSync(F("ok.pdf"), pdf("ok"));
  writeFileSync(F("ok2.pdf"), pdf("ok2-replacement"));
  writeFileSync(F("ok.png"), PNG);
  zipFixture("ok.xlsx", { "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>" });
  zipFixture("ok.docx", { "[Content_Types].xml": "<Types/>", "word/document.xml": "<document/>" });
  writeFileSync(F("html-as.pdf"), "<html><script>alert(1)</script></html>");
  writeFileSync(F("exe-as.png"), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]));
  writeFileSync(F("empty.pdf"), Buffer.alloc(0));
  writeFileSync(F("t.txt"), "plain text");
  writeFileSync(F("fake.xlsx"), Buffer.from("PK\u0003\u0004 not really an xlsx, no content types"));
  writeFileSync(F("over25.pdf"), pdf("over25", 25 * 1024 * 1024 + 1 - pdf("over25").length));
  writeFileSync(F("big26.pdf"), pdf("big26", 26 * 1024 * 1024 - pdf("big26").length));
});

async function login(page: Page) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill("anna@qa-test.ru");
  await page.getByLabel("Пароль").fill("TestPass123!");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: T });
}
async function open(page: Page, url: string) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").first().waitFor({ state: "attached", timeout: T });
}

const PURCHASE = "/purchases/cmupc480j000fls7y1gqe2l9y"; // З-2026-0002
const TZ = "/production/cmupc48gq01e9ls7y9leydosw"; // ТЗ 1
const BATCH = "/production/batches/1";
const AUC = "/lots?auction=" + encodeURIComponent("СП 09-26");
const PAYMENTS = "/payments";

const rowOf = (page: Page, t: string) => page.locator("li").filter({ has: page.locator("span.font-medium", { hasText: t }) }).first();
const dbById = (id: string) =>
  sql(`select id,coalesce("storagePath",''),coalesce("storedMime",''),coalesce("storedName",''),coalesce("storedSize",0),coalesce("viewUrl",'') from "DriveDocument" where id='${id}'`).split("|");
async function idOfLi(li: Locator): Promise<string> {
  const href = (await li.locator('a[href*="/api/drive-docs/"]').first().getAttribute("href")) ?? "";
  return /drive-docs\/([^?/]+)/.exec(href)?.[1] ?? "";
}
async function freeTitles(page: Page, n: number): Promise<string[]> {
  const lis = page.locator("li").filter({ has: page.getByText("Загрузить файл", { exact: true }) });
  const all = (await page.locator("li span.font-medium").allInnerTexts()).map((t) => t.trim());
  const out: string[] = [];
  for (let i = 0; i < (await lis.count()) && out.length < n; i++) {
    const t = ((await lis.nth(i).locator("span.font-medium").first().innerText()) || "").trim();
    if (t && all.filter((x) => x === t).length === 1) out.push(t);
  }
  return out;
}

const SET = [
  ["ok.pdf", "application/pdf"],
  ["ok.png", "image/png"],
  ["ok.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ok.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
] as const;

/** Хранилище: БД + диск + выдача (inline и ?download=1), байты 1:1 с загруженным. */
async function verifyStored(page: Page, id: string, file: string, mime: string, label: string) {
  const src = readFileSync(F(file));
  const [, sp, sm, sn, ss] = dbById(id);
  expect.soft(sp, `${label}: storagePath заполнен`).not.toBe("");
  expect.soft(sm, `${label}: storedMime`).toBe(mime);
  expect.soft(sn, `${label}: storedName`).toBe(file);
  expect.soft(Number(ss), `${label}: storedSize`).toBe(src.length);
  expect.soft(existsSync(path.join(UP, sp)), `${label}: файл на диске`).toBeTruthy();
  if (existsSync(path.join(UP, sp))) expect.soft(readFileSync(path.join(UP, sp)).equals(src), `${label}: байты на диске = загруженным`).toBeTruthy();
  const r = await page.request.get(`${BASE}/api/drive-docs/${id}`, { maxRedirects: 0, timeout: T });
  const h = r.headers();
  expect.soft(r.status(), `${label} GET 200`).toBe(200);
  expect.soft(h["content-type"], `${label} Content-Type`).toBe(mime);
  const inline = mime === "application/pdf" || mime.startsWith("image/");
  expect.soft(h["content-disposition"] ?? "", `${label} disposition`).toMatch(inline ? /^inline/ : /^attachment/);
  const b = await r.body();
  expect.soft(b.subarray(0, 8).equals(src.subarray(0, 8)) && b.length === src.length, `${label}: первые байты и размер при открытии`).toBeTruthy();
  const d = await page.request.get(`${BASE}/api/drive-docs/${id}?download=1`, { maxRedirects: 0, timeout: T });
  expect.soft(d.status()).toBe(200);
  expect.soft(d.headers()["content-disposition"] ?? "", `${label} ?download=1`).toMatch(/^attachment/);
  const db = await d.body();
  expect.soft(db.equals(src), `${label}: скачанные байты = загруженным (${db.length}/${src.length})`).toBeTruthy();
  log(label, "ok:", h["content-type"], h["content-disposition"], "bytes", db.length, "head", db.subarray(0, 4).toString("hex"));
}

/** Интерфейс строки: бейдж, «Открыть» (iframe/img или скачивание), «Скачать» (настоящее скачивание, байты). */
async function verifyRowUi(page: Page, li: Locator, id: string, file: string, mime: string, label: string) {
  await expect(li.getByText("Файл в приложении"), `${label}: бейдж`).toBeVisible({ timeout: T });
  const src = readFileSync(F(file));
  if (mime === "application/pdf" || mime.startsWith("image/")) {
    await li.getByRole("button", { name: "Открыть" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    if (mime === "application/pdf") await expect(dlg.locator("iframe")).toHaveAttribute("src", new RegExp(`/api/drive-docs/${id}`));
    else {
      const img = dlg.locator("img");
      await expect(img).toHaveAttribute("src", new RegExp(`/api/drive-docs/${id}`));
      await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth), { timeout: T, message: `${label}: png виден` }).toBeGreaterThan(0);
    }
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
  } else {
    expect.soft(await li.getByRole("link", { name: "Открыть" }).getAttribute("href"), `${label}: Открыть = скачивание`).toContain("download=1");
  }
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: T }), li.getByRole("link", { name: "Скачать" }).click()]);
  const p = await dl.path();
  expect.soft(dl.suggestedFilename(), `${label}: имя скачанного`).toBe(file);
  expect.soft(readFileSync(p).equals(src), `${label}: «Скачать» отдаёт те же байты`).toBeTruthy();
}

const REJECT: [string, RegExp][] = [
  ["html-as.pdf", /не подходит/],
  ["exe-as.png", /не подходит/],
  ["empty.pdf", /пуст|Выберите файл/],
  ["over25.pdf", /больше 25 МБ/],
  ["big26.pdf", /больше 25 МБ|слишком большой/], // 26 МБ: форма режет на клиенте, у «Загрузить файл» отвечает сервер (HTTP 413/500 Next) — общий текст
];

async function cycle(page: Page, name: string, url: string) {
  await open(page, url);
  const dbBefore = Number(sql(`select count(*) from "DriveDocument"`));
  // ---- A. «Загрузить файл» у существующего документа Drive ----
  const titles = await freeTitles(page, 4);
  log(name, "A: документов без файла (взято):", titles.length);
  expect.soft(titles.length, `${name}: есть документы без файла`).toBeGreaterThanOrEqual(1);
  const ids: string[] = [];
  for (let i = 0; i < titles.length; i++) {
    const [file, mime] = SET[i];
    const before = diskFiles().length;
    await rowOf(page, titles[i]).locator("input[type=file]").first().setInputFiles(F(file));
    const li = rowOf(page, titles[i]);
    await expect(li.getByText("Файл в приложении")).toBeVisible({ timeout: T });
    const id = await idOfLi(li);
    ids.push(id);
    expect.soft(diskFiles().length, `${name} A ${file}: на диске +1`).toBe(before + 1);
    await verifyStored(page, id, file, mime, `${name} A ${file}`);
    await verifyRowUi(page, li, id, file, mime, `${name} A ${file}`);
  }
  // отклонения на одном из свободных документов (если ещё остался), иначе на заменяемом ниже
  // ---- B. «+ Загрузить документ» (новый документ без ссылки) ----
  const sum = page.locator("summary", { hasText: /\+ Загрузить документ/ }).first();
  const det = sum.locator("xpath=..");
  await sum.click();
  const form = det.locator("form");
  const newIds: string[] = [];
  for (const [file, mime] of SET) {
    const title = `UP-${RUN}-${Buffer.from(url).toString("hex").slice(-6)}-${file}`;
    const before = diskFiles().length;
    await form.locator("input[type=file]").setInputFiles(F(file));
    await form.locator("input[name=title]").fill(title);
    await form.getByRole("button", { name: "Загрузить", exact: true }).click();
    await expect(form.getByText("Загружено")).toBeVisible({ timeout: T });
    const id = sql(`select id from "DriveDocument" where title='${title}'`);
    expect.soft(id, `${name} B ${file}: запись создана`).not.toBe("");
    newIds.push(id);
    expect.soft(diskFiles().length, `${name} B ${file}: на диске +1`).toBe(before + 1);
    await verifyStored(page, id, file, mime, `${name} B ${file}`);
    const li = rowOf(page, title);
    if (await li.count()) await verifyRowUi(page, li, id, file, mime, `${name} B ${file}`);
    else log(name, "B", file, "документ создан, но в этом списке страницы не виден (привязан к другому объекту?)");
    if (!(await det.evaluate((e: HTMLDetailsElement) => e.open))) await sum.click();
  }
  // ---- C. отклонения через форму «+ Загрузить документ» ----
  const dbMid = Number(sql(`select count(*) from "DriveDocument"`));
  for (const [file, rx] of REJECT) {
    const before = diskFiles().length;
    await form.locator("input[type=file]").setInputFiles(F(file));
    await form.getByRole("button", { name: "Загрузить", exact: true }).click();
    const msg = form.locator("span.text-red-600");
    await expect(msg).toBeVisible({ timeout: T });
    const text = (await msg.innerText()).trim();
    log(name, "C ОТКЛОНЕНО (форма)", file, "->", text);
    expect.soft(text, `${name} C ${file}`).toMatch(rx);
    expect.soft(diskFiles().length, `${name} C ${file}: на диск не попало`).toBe(before);
    expect.soft(Number(sql(`select count(*) from "DriveDocument"`)), `${name} C ${file}: запись не создана`).toBe(dbMid);
  }
  // ---- D. после перезагрузки файлы на месте ----
  await open(page, url);
  for (let i = 0; i < titles.length; i++) await expect(rowOf(page, titles[i]).getByText("Файл в приложении"), `${name}: после перезагрузки A ${SET[i][0]}`).toBeVisible();
  for (const id of [...ids, ...newIds]) {
    const [, sp] = dbById(id);
    expect.soft(sp !== "" && existsSync(path.join(UP, sp)), `${name}: после перезагрузки ${id} на месте`).toBeTruthy();
  }
  // ---- E. отклонения «Загрузить файл» у существующего документа ----
  const free = await freeTitles(page, 1);
  const tgt = free[0] ?? titles[0];
  const useReplace = free.length === 0;
  for (const [file, rx] of [...REJECT, ["t.txt", /не подходит/] as [string, RegExp]]) {
    const before = diskFiles().length;
    const [, oldSp] = dbById(ids[0] ?? "");
    await rowOf(page, tgt).locator("input[type=file]").first().setInputFiles(F(file));
    const msg = rowOf(page, tgt).locator("div.text-red-600");
    await expect(msg).toBeVisible({ timeout: 25000 });
    const text = (await msg.innerText()).trim();
    log(name, "E ОТКЛОНЕНО (у документа)", file, "->", text);
    expect.soft(text, `${name} E ${file}`).toMatch(rx);
    expect.soft(diskFiles().length, `${name} E ${file}: на диск не попало`).toBe(before);
    if (useReplace) expect.soft(dbById(ids[0])[1], `${name} E ${file}: старый файл остался`).toBe(oldSp);
    else await expect(rowOf(page, tgt).getByText("Файл в приложении")).toBeHidden();
  }
  // ---- F. замена (старый файл удалён с диска) ----
  if (ids[0]) {
    const [, oldPath] = dbById(ids[0]);
    await rowOf(page, titles[0]).locator("input[type=file]").first().setInputFiles(F("ok2.pdf"));
    await expect.poll(() => dbById(ids[0])[1], { timeout: T }).not.toBe(oldPath);
    expect.soft(existsSync(path.join(UP, oldPath)), `${name} F: старый файл удалён с диска`).toBeFalsy();
    await verifyStored(page, ids[0], "ok2.pdf", "application/pdf", `${name} F замена`);
  }
  // ---- G. «Удалить файл» (ссылка Drive остаётся) ----
  if (ids[1]) {
    const [id1, sp1] = dbById(ids[1]);
    const btn = rowOf(page, titles[1]).getByRole("button", { name: "Удалить файл" });
    if (await btn.count()) {
      page.once("dialog", (d) => void d.accept());
      await btn.click();
      await expect(rowOf(page, titles[1]).getByText("Файл в приложении")).toBeHidden({ timeout: T });
      const [, sp1b, , , , v1] = dbById(id1);
      expect.soft(sp1b, `${name} G: storagePath очищен`).toBe("");
      expect.soft(v1, `${name} G: ссылка Drive осталась`).toContain("drive.google.com");
      expect.soft(existsSync(path.join(UP, sp1)), `${name} G: файл удалён с диска`).toBeFalsy();
      const r = await page.request.get(`${BASE}/api/drive-docs/${id1}`, { maxRedirects: 0, timeout: T });
      expect.soft(r.status()).toBe(302);
      expect.soft(r.headers()["location"] ?? "").toContain("drive.google.com");
    } else log(name, "G: кнопки «Удалить файл» нет у этого документа");
  }
  await open(page, url);
  if (ids[0]) await expect(rowOf(page, titles[0]).getByText("Файл в приложении")).toBeVisible();
  log(name, "готово; записей DriveDocument +", Number(sql(`select count(*) from "DriveDocument"`)) - dbBefore);
}

for (const [name, url] of [["карточка закупки З-2026-0002", PURCHASE], ["карточка ТЗ 1", TZ], ["карточка партии 1", BATCH], ["оплаты", PAYMENTS], ["аукцион СП 09-26", AUC]] as const) {
  test(`загрузка файлов к документам Drive: ${name}`, async ({ page }) => {
    page.setDefaultTimeout(T);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
    page.on("response", (r) => r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url()}`));
    await login(page);
    await cycle(page, name, url);
    const real = errors.filter((e) => !/HTTP 500|status of 500/.test(e)); // 500 — ожидаемый отказ Next на теле >26 МБ (big26)
    log(name, "ожидаемых 500 от big26:", errors.length - real.length);
    expect.soft(real, `${name}: ошибки консоли/сети`).toEqual([]);
  });
}

// «Файлы (PDF, XLSX, DOCX…)» закупки — отдельное хранилище PurchaseDocument (/api/purchase-docs)
test("файлы закупки (PurchaseDocument): загрузка, выдача, отклонение, удаление", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await page.goto(BASE + PURCHASE);
  await page.locator("input[type=file]").first().waitFor({ state: "attached" });
  const form = page.locator("form").filter({ has: page.locator('input[type=file][name=files]') }).first();
  const pdDir = path.join(UP, "purchase-docs");
  const countFiles = () => (existsSync(pdDir) ? execSync(`find '${pdDir}' -type f | wc -l`, { encoding: "utf8" }).trim() : "0");
  for (const [file, mime] of SET) {
    const n0 = Number(sql(`select count(*) from "PurchaseDocument"`));
    const f0 = countFiles();
    await form.locator("input[type=file]").setInputFiles(F(file));
    await form.getByRole("button", { name: "Загрузить" }).click();
    await expect(form.getByText("Загружено")).toBeVisible({ timeout: 30000 });
    expect.soft(Number(sql(`select count(*) from "PurchaseDocument"`))).toBe(n0 + 1);
    expect.soft(Number(countFiles()), `${file}: файл на диске`).toBe(Number(f0) + 1);
    const row = sql(`select id,"mimeType" from "PurchaseDocument" order by "createdAt" desc limit 1`).split("|");
    expect.soft(row[1]).toBe(mime);
    const r = await page.request.get(`${BASE}/api/purchase-docs/${row[0]}`, { maxRedirects: 0 });
    log("purchase-docs", file, r.status(), r.headers()["content-type"], r.headers()["content-disposition"]);
    expect.soft(r.status()).toBe(200);
    expect.soft(r.headers()["content-type"]).toBe(mime);
    await page.waitForTimeout(500);
  }
  await page.reload();
  await page.locator("input[type=file]").first().waitFor({ state: "attached" });
  for (const [file, rx] of [["html-as.pdf", /не подходит/], ["exe-as.png", /не подходит/], ["fake.xlsx", /не подходит/], ["over25.pdf", /больше|25 МБ/], ["big26.pdf", /больше|25 МБ|Не удалось/]] as [string, RegExp][]) {
    const n0 = Number(sql(`select count(*) from "PurchaseDocument"`));
    await form.locator("input[type=file]").setInputFiles(F(file));
    await form.getByRole("button", { name: "Загрузить" }).click();
    const msg = form.locator("p.text-red-600");
    await expect(msg).toBeVisible({ timeout: 40000 });
    const text = (await msg.innerText()).trim();
    log("purchase-docs ОТКЛОНЕНО", file, "->", text);
    expect.soft(text).toMatch(rx);
    expect.soft(Number(sql(`select count(*) from "PurchaseDocument"`))).toBe(n0);
    await page.waitForTimeout(300);
  }
  // удаление последнего загруженного документа
  const last = sql(`select id,"storagePath" from "PurchaseDocument" order by "createdAt" desc limit 1`).split("|");
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true))); // одинаковые файлы группируются в свёрнутый «×N»
  page.once("dialog", (d) => void d.accept());
  const title = sql(`select title from "PurchaseDocument" where id='${last[0]}'`);
  await page.locator("div.text-sm").filter({ has: page.locator(`a[href="/api/purchase-docs/${last[0]}"]`) }).first().getByRole("button", { name: "Удалить" }).click();
  await expect(async () => expect(sql(`select count(*) from "PurchaseDocument" where id='${last[0]}'`)).toBe("0")).toPass({ timeout: 15000 });
  expect.soft(existsSync(path.join(UP, last[1])), `удалённый файл (${title}) убран с диска`).toBeFalsy();
});

test("СП 09-26: 11 загруженных документов отдаются с верным Content-Type", async ({ page }) => {
  await login(page);
  const rows = sql(`select id,"mimeType" from "PurchaseDocument" where batch='СП 09-26' or "purchaseId" in (select id from "Purchase" where "auctionSession"='СП 09-26') order by title`).split("\n");
  expect(rows.length).toBe(11);
  for (const r of rows) {
    const [id, mime] = r.split("|");
    const res = await page.request.get(`${BASE}/api/purchase-docs/${id}`, { maxRedirects: 0 });
    expect.soft(res.status(), id).toBe(200);
    expect.soft(res.headers()["content-type"], id).toBe(mime);
  }
});
