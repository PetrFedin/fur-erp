import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { watchErrors } from "./helpers";

// Регрессия «Оплат» (/payments): Б1–Б4, закрытие остатка, список аукционов, баннер, подписи полей.
// Самодостаточно: свои аукционы «RG-…» создаются через SQL и удаляются; боевые данные копии не трогаются.
// Стенд: scripts/e2e.sh up reg3 3291; E2E_BASE_URL=http://localhost:3291 npx playwright test -c e2e/playwright.config.ts e2e/regress-payments.spec.ts
// (другая база — E2E_DB). Перед первым запуском: cp -R uploads/purchase-docs /tmp/fur-e2e/reg3-uploads/
const DB = process.env.E2E_DB ?? "fur_erp_e2e_reg3";
const PW = "TestPass123!";
const HASH = "$2b$10$4GjnSssJqUQKMd1CV4W48.ElNt4xt63QzGqtRFKhIb6GnMVT89.0G"; // TestPass123!
const FIX = "/tmp/fur-e2e/fixtures-rg";
const PDF = `${FIX}/ok.pdf`;

function sql(q: string): string {
  return execSync(`docker exec -i fur-erp-db-1 psql -U fur_erp -d ${DB} -At -F '|' -v ON_ERROR_STOP=1`, { encoding: "utf8", input: q }).trim();
}
const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const ORG = sql(`select "organizationId" from "User" where email='anna@qa-test.ru'`);
const SUP = sql(`select id from "Supplier" where "organizationId"='${ORG}' order by "createdAt" limit 1`);
const WH = sql(`select id from "Warehouse" where "organizationId"='${ORG}' order by id limit 1`);
const MAT = sql(`select id from "RawMaterial" where "organizationId"='${ORG}' order by id limit 1`);
const enc = (a: string) => encodeURIComponent(a).replace(/%20/g, "+");
const aucUrl = (a: string) => `/payments?auction=${enc(a)}#auction-block`;
const CLOSING_NOTE = "Оплачено до начала учёта в системе (закрытие остатка)";

// ---------- ID server actions из манифеста сборки ----------
function actionId(name: string): string {
  const m = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node as Record<string, { exportedName?: string }>;
  const hit = Object.entries(m).find(([, v]) => v.exportedName === name);
  if (!hit) throw new Error("нет server action " + name);
  return hit[0];
}

/** Прямой вызов server action с полями формы (как браузер: "0" = аргументы, "$K1" = FormData). */
async function callForm(page: Page, route: string, name: string, args: unknown[], fields: Record<string, string> = {}, file?: { name: string; data: Buffer }) {
  const b = "----QA" + Date.now() + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  const add = (n: string, value: string | Buffer, filename?: string) => {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${n}"${filename !== undefined ? `; filename="${filename}"` : ""}\r\n${filename !== undefined ? "Content-Type: application/octet-stream\r\n" : ""}\r\n`));
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    parts.push(Buffer.from("\r\n"));
  };
  for (const [k, v] of Object.entries(fields)) add(`_1_${k}`, v);
  if (file) add("_1_file", file.data, file.name);
  add("0", JSON.stringify(args));
  parts.push(Buffer.from(`--${b}--\r\n`));
  const r = await page.request.post(route, {
    headers: { "Next-Action": actionId(name), accept: "text/x-component", "content-type": `multipart/form-data; boundary=${b}` },
    data: Buffer.concat(parts),
    maxRedirects: 0,
  });
  const text = await r.text();
  return { status: r.status(), text: (text.match(/\n1:(\{[^\n]*\})/)?.[1] ?? text.slice(0, 200)).replace(/\s+/g, " ") };
}
/** Прямой вызов server action с JSON-аргументами (без FormData). */
async function callJson(page: Page, route: string, name: string, args: unknown[]) {
  const r = await page.request.post(route, {
    headers: { "Next-Action": actionId(name), accept: "text/x-component", "content-type": "text/plain;charset=UTF-8" },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
  const text = await r.text();
  return { status: r.status(), text: (text.match(/\n1:(\{[^\n]*\})/)?.[1] ?? text.slice(0, 200)).replace(/\s+/g, " ") };
}

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(PW);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}

/** Диалоги confirm/alert: policy.accept управляется тестом, тексты копятся. */
function dialogs(page: Page) {
  const policy = { accept: true };
  const msgs: string[] = [];
  page.on("dialog", async (d) => {
    msgs.push(d.message());
    if (policy.accept) await d.accept();
    else await d.dismiss();
  });
  return { policy, msgs };
}

// ---------- данные ----------
const slug = (n: string) => n.replace(/[^A-Za-z0-9]/g, "_");
/** Аукцион из одной закупки: итог с НДС = subtotalExcl × 1,2 (курс 1, RUB, НДС 20 %). */
function mkAuction(name: string, subtotalExcl: number, o: { daysAgo?: number; org?: string; sup?: string; wh?: string; mat?: string } = {}) {
  const s = slug(name);
  const org = o.org ?? ORG;
  const pid = `${o.org ? "rgb" : "rg"}_p_${s}`;
  sql(`insert into "Purchase"(id,"organizationId",number,"supplierId","warehouseId",currency,"exchangeRate","auctionSession","invoiceNumber","orderDate","updatedAt")
       values ('${pid}','${org}','RG-${s}','${o.sup ?? SUP}','${o.wh ?? WH}','RUB',1,'${name}','${s}', date_trunc('day', now()) - interval '${o.daysAgo ?? 0} days', now())`);
  sql(`insert into "PurchaseItem"(id,"purchaseId","rawMaterialId",quantity,"unitPrice",subtotal,"vatRate")
       values ('${pid}_i','${pid}','${o.mat ?? MAT}',10,${subtotalExcl / 10},${subtotalExcl},20)`);
  return pid;
}
const setSubtotal = (name: string, subtotalExcl: number) =>
  sql(`update "PurchaseItem" set subtotal=${subtotalExcl}, "unitPrice"=${subtotalExcl / 10} where id='rg_p_${slug(name)}_i'`);
function cleanRg() {
  sql(`delete from "Payment" where "auctionSession" like 'RG-%' or "purchaseId" like 'rg%\\_p\\_%' or notes like 'RG:%' or notes = '${CLOSING_NOTE}' and "auctionSession" like 'RG-%'`);
  sql(`delete from "PurchaseDocument" where batch like 'RG-%'`);
  sql(`delete from "PurchaseItem" where "purchaseId" like 'rg%\\_p\\_%'`);
  sql(`delete from "Purchase" where id like 'rg%\\_p\\_%'`);
}
const payRow = (note: string) => sql(`select amount,coalesce(percent::text,''),status,kind,method,to_char("paidAt",'YYYY-MM-DD'),"documentId" is not null from "Payment" where notes='${note}'`);
const payCount = (cond: string) => Number(sql(`select count(*) from "Payment" where ${cond}`));
const insertPay = (id: string, o: { auction?: string; purchase?: string; amount: number; status?: string; notes?: string; kind?: string }) =>
  sql(`insert into "Payment"(id,"organizationId","supplierId","purchaseId","auctionSession",amount,currency,method,status,kind,"paidAt",notes)
       values ('${id}','${ORG}','${SUP}',${o.purchase ? `'${o.purchase}'` : "null"},${o.auction ? `'${o.auction}'` : "null"},${o.amount},'RUB','BANK_TRANSFER','${o.status ?? "COMPLETED"}','${o.kind ?? "ADVANCE"}', now(), ${o.notes ? `'${o.notes}'` : "null"})`);

const addForm = (page: Page) => page.locator("form", { has: page.getByRole("button", { name: "Добавить оплату", exact: true }) });
const rowOf = (page: Page, note: string) =>
  page.locator("div.rounded-lg.border.bg-white.p-3").filter({ hasText: new RegExp("Заметка: " + note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\wа-яё-])") }).last();
const nextYear = () => `${new Date().getFullYear() + 1}-12-31`;

test.describe.configure({ mode: "default" });
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });
test.setTimeout(120_000);

test.beforeAll(() => {
  mkdirSync(FIX, { recursive: true });
  writeFileSync(PDF, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  writeFileSync(`${FIX}/empty.pdf`, "");
  writeFileSync(`${FIX}/pdf-as.jpg`, "%PDF-1.4 pdf renamed to jpg\n%%EOF");
  writeFileSync(`${FIX}/jpg-as.pdf`, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0xff, 0xd9]));
  const users = [["rg_viewer", "viewer", "VIEWER"], ["rg_acc", "acc", "ACCOUNTANT"]];
  sql(users.map(([id, e, r]) => `insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('${id}','${ORG}','${e}@qa-test.ru','${HASH}','QA ${e}','${r}',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash","isActive"=true`).join(";") + ";");
  sql(`insert into "Organization"(id,name,slug,"updatedAt") values ('org_b','Other Org','other-org',now()) on conflict do nothing`);
  sql(`insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('u_b','org_b','bob@other-org.ru','${HASH}','Bob','OWNER',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash"`);
  sql(`insert into "Supplier"(id,"organizationId",name,"updatedAt") values ('s_b','org_b','Supplier B',now()) on conflict do nothing`);
  sql(`insert into "Warehouse"(id,"organizationId",name) values ('w_b','org_b','WH B') on conflict do nothing`);
  sql(`insert into "RawMaterial"(id,"organizationId",name,"updatedAt") values ('m_b','org_b','Соболь B',now()) on conflict do nothing`);
  cleanRg();
});
test.afterAll(() => cleanRg());

// =====================================================================================
test("Б1. правка только заметки у оплаты в % не меняет сумму; смена стоимости аукциона не трогает старые оплаты; явное «%» пересчитывает", async ({ page }) => {
  cleanRg();
  mkAuction("RG-B1", 100_000); // итог 120 000
  const errors = watchErrors(page);
  const d = dialogs(page);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl("RG-B1"));
  const f = addForm(page);
  await f.getByLabel("% от стоимости аукциона").fill("50");
  await f.getByLabel("Заметка").fill("RG:b1");
  // файл прикладываем осознанно: «добавление без файла» проверяется отдельным тестом Б3
  await f.getByLabel(/Платёжный документ/).setInputFiles(PDF);
  await f.getByRole("button", { name: "Добавить оплату" }).click();
  await expect.poll(() => payRow("RG:b1")).toMatch(/^60000\.00\|50\.000\|COMPLETED\|ADVANCE/);

  // стоимость аукциона выросла вдвое (итог 240 000)
  setSubtotal("RG-B1", 200_000);
  await page.goto(aucUrl("RG-B1"));
  const edit = async (note: string, fill: (form: ReturnType<typeof rowOf>) => Promise<void>) => {
    const row = rowOf(page, note);
    await row.getByRole("button", { name: "Править" }).click();
    await fill(row);
    await row.getByLabel(/Заменить платёжку/).setInputFiles(PDF); // см. комментарий выше
    await row.getByRole("button", { name: "Сохранить" }).click();
  };
  const dialogsBefore = d.msgs.length;
  await edit("RG:b1", async (row) => {
    await expect(row.getByLabel("% от стоимости аукциона")).toHaveValue("50");
    await row.getByLabel("Заметка").fill("RG:b1-n");
  });
  await expect.poll(() => payRow("RG:b1-n")).toMatch(/^60000\.00\|50\.000\|/); // сумма и % не изменились
  expect(d.msgs.length, "правка заметки не должна вызывать confirm").toBe(dialogsBefore);

  // явное изменение «%» пересчитывает от текущей стоимости: 25 % от 240 000 = 60 000; 30 % = 72 000
  await page.goto(aucUrl("RG-B1"));
  await edit("RG:b1-n", async (row) => {
    await row.getByLabel("% от стоимости аукциона").fill("30");
    await expect(row.getByLabel("или сумма, ₽")).toHaveValue("72000,00");
  });
  await expect.poll(() => payRow("RG:b1-n")).toMatch(/^72000\.00\|30\.000\|/);

  // стоимость упала до 12 000: платёж 72 000 теперь «больше» стоимости; правка заметки — без confirm
  setSubtotal("RG-B1", 10_000);
  await page.goto(aucUrl("RG-B1"));
  const n0 = d.msgs.length;
  await edit("RG:b1-n", async (row) => {
    await row.getByLabel("Заметка").fill("RG:b1-m");
  });
  await expect.poll(() => payRow("RG:b1-m")).toMatch(/^72000\.00\|30\.000\|/);
  expect(d.msgs.length, "правка заметки у уже «переплаченной» оплаты не должна просить confirm").toBe(n0);

  // а вот явная смена суммы вверх — просит confirm о переплате
  await page.goto(aucUrl("RG-B1"));
  await edit("RG:b1-m", async (row) => {
    await row.getByLabel("или сумма, ₽").fill("90 000,50");
  });
  await expect.poll(() => payRow("RG:b1-m")).toMatch(/^90000\.50\|\|/); // % сброшен
  expect(d.msgs.slice(n0).some((m) => /переплата/.test(m))).toBe(true);

  // отмена confirm — ничего не меняется
  d.policy.accept = false;
  await page.goto(aucUrl("RG-B1"));
  await edit("RG:b1-m", async (row) => {
    await row.getByLabel("или сумма, ₽").fill("95 000");
  });
  await page.waitForTimeout(800);
  expect(payRow("RG:b1-m")).toMatch(/^90000\.50\|\|/);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Б2. оплата внутри закупки аукциона: confirm переплаты, отмена, согласие; гонка с оплатой аукциона", async ({ page, browser }) => {
  cleanRg();
  const pid = mkAuction("RG-B2", 100_000); // итог 120 000
  const errors = watchErrors(page);
  const d = dialogs(page);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl("RG-B2"));
  const f = addForm(page);
  await f.getByLabel("или сумма, ₽").fill("100000");
  await f.getByLabel("Заметка").fill("RG:b2a");
  await f.getByLabel(/Платёжный документ/).setInputFiles(PDF);
  await f.getByRole("button", { name: "Добавить оплату" }).click();
  await expect.poll(() => payRow("RG:b2a")).toMatch(/^100000\.00\|/);

  await page.goto(`/purchases/${pid}`);
  const pf = page.locator("form", { has: page.getByRole("button", { name: /Добавить оплату/ }) });
  await pf.getByLabel("Сумма, ₽").fill("30000");
  await pf.getByLabel("Заметка").fill("RG:b2b");
  d.policy.accept = false;
  const n0 = d.msgs.length;
  await pf.getByRole("button", { name: /Добавить оплату/ }).click();
  await expect.poll(() => d.msgs.length).toBeGreaterThan(n0);
  expect(norm(d.msgs[n0])).toMatch(/переплата 10 000,00 ₽/);
  await page.waitForTimeout(600);
  expect(payCount(`notes='RG:b2b'`), "после отказа в confirm оплата не записана").toBe(0);
  d.policy.accept = true;
  // после отказа в confirm введённые значения должны остаться в форме (React 19 сбрасывает форму после action)
  expect.soft({ amount: await pf.getByLabel("Сумма, ₽").inputValue(), notes: await pf.getByLabel("Заметка").inputValue() }, "после отказа в confirm форма не должна очищаться").toEqual({ amount: "30000", notes: "RG:b2b" });
  await pf.getByLabel("Сумма, ₽").fill("30000");
  await pf.getByLabel("Заметка").fill("RG:b2b");
  await pf.getByRole("button", { name: /Добавить оплату/ }).click();
  await expect.poll(() => payCount(`notes='RG:b2b'`)).toBe(1);
  await page.goto(aucUrl("RG-B2"));
  await expect(page.locator("main")).toContainText("Переплата");
  await expect(page.locator("main")).toContainText("переплата 10 000,00");

  // гонка: «Остаток» аукциона против оплаты на весь остаток внутри закупки. 3 раунда, каждый — свой аукцион
  for (let i = 0; i < 3; i++) {
    const name = `RG-B2R${i}`;
    const p2 = mkAuction(name, 100_000);
    const c1 = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, locale: "ru-RU" });
    const c2 = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, locale: "ru-RU" });
    const a = await c1.newPage();
    const b = await c2.newPage();
    const da = dialogs(a);
    const db = dialogs(b);
    da.policy.accept = false;
    db.policy.accept = false; // confirm переплаты отклоняем: победитель только один
    await loginAs(a, "anna@qa-test.ru");
    await loginAs(b, "anna@qa-test.ru");
    await a.goto(aucUrl(name));
    const fa = addForm(a);
    await fa.getByLabel("Тип оплаты").selectOption("FINAL");
    await fa.getByRole("button", { name: /Остаток:/ }).click();
    await fa.getByLabel("Заметка").fill("RG:race-a");
    await b.goto(`/purchases/${p2}`);
    const fb = b.locator("form", { has: b.getByRole("button", { name: /Добавить оплату/ }) });
    await fb.getByLabel("Сумма, ₽").fill("120000");
    await fb.getByLabel("Заметка").fill("RG:race-b");
    await Promise.all([fa.getByRole("button", { name: "Добавить оплату" }).click(), fb.getByRole("button", { name: /Добавить оплату/ }).click()]);
    await a.waitForTimeout(2500);
    const total = Number(sql(`select coalesce(sum(amount),0) from "Payment" where status='COMPLETED' and ("auctionSession"='${name}' or "purchaseId"='${p2}')`));
    const rows = payCount(`status='COMPLETED' and ("auctionSession"='${name}' or "purchaseId"='${p2}')`);
    expect({ round: i, rows, total }, "ровно одна оплата на весь остаток, без переплаты").toEqual({ round: i, rows: 1, total: 120000 });
    await c1.close();
    await c2.close();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Б3. платёжка: пустой файл — понятная ошибка (UI и сервер); без файла оплата добавляется и правится", async ({ page }) => {
  cleanRg();
  mkAuction("RG-B3", 100_000);
  const errors = watchErrors(page);
  dialogs(page);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl("RG-B3"));
  let f = addForm(page);
  await f.getByLabel("или сумма, ₽").fill("100");
  await f.getByLabel("Заметка").fill("RG:b3-empty");
  await f.getByLabel(/Платёжный документ/).setInputFiles(`${FIX}/empty.pdf`);
  await f.getByRole("button", { name: "Добавить оплату" }).click();
  await expect(f.getByRole("alert")).toContainText("пустой");
  await expect(f.getByRole("alert")).not.toContainText("undefined");
  expect(payCount(`notes='RG:b3-empty'`)).toBe(0);

  // сервер: файл с именем и 0 байт
  const r = await callForm(page, "/payments", "createAuctionPayment", ["RG-B3", "$K1"], { kind: "ADVANCE", status: "COMPLETED", method: "BANK_TRANSFER", paidAt: "2026-10-01", amount: "5", mode: "amount", notes: "RG:b3-srv" }, { name: "x.pdf", data: Buffer.alloc(0) });
  expect(r.text).toMatch(/пустой/);
  expect(payCount(`notes='RG:b3-srv'`)).toBe(0);

  // БЕЗ файла: форма не должна ругаться на «пустой файл» (в браузере пустой input шлёт File с пустым именем)
  await page.goto(aucUrl("RG-B3"));
  f = addForm(page);
  await f.getByLabel("или сумма, ₽").fill("123,45");
  await f.getByLabel("Заметка").fill("RG:b3-nofile");
  await f.getByRole("button", { name: "Добавить оплату" }).click();
  await expect.poll(() => payRow("RG:b3-nofile"), "оплата без файла должна сохраниться").toMatch(/^123\.45\|/);

  // правка без файла
  await page.goto(aucUrl("RG-B3"));
  const row = rowOf(page, "RG:b3-nofile");
  await row.getByRole("button", { name: "Править" }).click();
  await row.getByLabel("Заметка").fill("RG:b3-nofile2");
  await row.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => payRow("RG:b3-nofile2"), "правка заметки без файла должна сохраниться").toMatch(/^123\.45\|/);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Б3b. расширение платёжки определяется по сигнатуре, а не по имени", async ({ page }) => {
  cleanRg();
  mkAuction("RG-B3B", 100_000);
  dialogs(page);
  await loginAs(page, "anna@qa-test.ru");
  for (const [file, ext] of [["pdf-as.jpg", "pdf"], ["jpg-as.pdf", "jpg"]] as const) {
    await page.goto(aucUrl("RG-B3B"));
    const f = addForm(page);
    await f.getByLabel("или сумма, ₽").fill("10");
    await f.getByLabel("Заметка").fill("RG:sig-" + ext);
    await f.getByLabel(/Платёжный документ/).setInputFiles(`${FIX}/${file}`);
    await f.getByRole("button", { name: "Добавить оплату" }).click();
    await expect.poll(() => sql(`select d."originalName"||'|'||d."mimeType" from "Payment" p join "PurchaseDocument" d on d.id=p."documentId" where p.notes='RG:sig-${ext}'`)).toMatch(new RegExp(`\\.${ext}\\|`));
  }
});

test("Б4. аванс «Без аукциона»: будущая дата (confirm), запятая и пробелы, 0,006 → 0,01, правка и удаление", async ({ page }) => {
  cleanRg();
  const errors = watchErrors(page);
  const d = dialogs(page);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto("/payments");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Добавить платёж", exact: true }) });
  const fill = async (amount: string, note: string, date?: string) => {
    await form.getByLabel("Поставщик").selectOption(SUP);
    await form.getByLabel("Сумма, ₽").fill(amount);
    await form.getByLabel("Заметка").fill(note);
    if (date) await form.getByLabel("Дата").fill(date);
  };
  // будущая дата: отказ -> ничего, согласие -> записано
  d.policy.accept = false;
  await fill("1 234,56", "RG:adv", nextYear());
  await form.getByRole("button", { name: "Добавить платёж" }).click();
  await expect.poll(() => d.msgs.length).toBe(1);
  expect(d.msgs[0]).toMatch(/в будущем/);
  await page.waitForTimeout(500);
  expect(payCount(`notes='RG:adv'`)).toBe(0);
  d.policy.accept = true;
  await form.getByRole("button", { name: "Добавить платёж" }).click();
  await expect.poll(() => payRow("RG:adv")).toMatch(new RegExp(`^1234\\.56\\|\\|COMPLETED\\|ADVANCE\\|BANK_TRANSFER\\|${nextYear()}`));
  // 0,006 -> 0,01; 0,004 -> ошибка
  await page.goto("/payments");
  await fill("0,006", "RG:adv-006");
  await form.getByRole("button", { name: "Добавить платёж" }).click();
  await expect.poll(() => payRow("RG:adv-006")).toMatch(/^0\.01\|/);
  await fill("0,004", "RG:adv-004");
  await form.getByRole("button", { name: "Добавить платёж" }).click();
  await expect(form.getByRole("alert")).toContainText("меньше 0,005");
  expect(payCount(`notes='RG:adv-004'`)).toBe(0);
  // правка
  await page.goto("/payments");
  const row = rowOf(page, "RG:adv");
  await row.getByRole("button", { name: "Править" }).click();
  await row.getByLabel("Сумма, ₽").fill("2,5");
  await row.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => payRow("RG:adv")).toMatch(/^2\.50\|/);
  // удаление
  await page.goto("/payments");
  await rowOf(page, "RG:adv").getByRole("button", { name: "Удалить" }).click();
  await expect.poll(() => payCount(`notes='RG:adv'`)).toBe(0);
  sql(`delete from "Payment" where notes like 'RG:adv%'`);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Баннер ?error=: только известные коды; произвольный текст и разметка не выводятся", async ({ page }) => {
  await loginAs(page, "anna@qa-test.ru");
  await page.goto("/payments?error=forbidden");
  await expect(page.locator("main")).toContainText("Недостаточно прав");
  await page.goto("/payments?error=" + encodeURIComponent("<b>HACKED-TEXT</b>"));
  await expect(page.locator("main")).not.toContainText("HACKED-TEXT");
  await expect(page.locator("main b")).toHaveCount(0);
  await page.goto("/payments?error=" + encodeURIComponent("Ваш пароль устарел, введите на evil.example"));
  await expect(page.locator("main")).not.toContainText("evil.example");
  await page.goto("/payments?error=__proto__");
  await expect(page.locator("main")).not.toContainText("__proto__");
  await page.goto("/payments?error=toString"); // не должно брать из прототипа объекта
  await expect(page.locator("main")).not.toContainText("function");
});

test("имена посредников берутся из данных организации (Bob не видит чужих)", async ({ browser, page }) => {
  await loginAs(page, "anna@qa-test.ru");
  await page.goto("/payments");
  const supName = sql(`select name from "Supplier" where id='${SUP}'`);
  const intro = norm(await page.locator("main p").first().innerText());
  // у Anna хоть один аукцион есть и в подводке названы реальные поставщики аукционов
  expect(intro).toMatch(/посреднику \(поставщику\)/);
  const names = sql(`select distinct s.name from "Purchase" p join "Supplier" s on s.id=p."supplierId" where p."organizationId"='${ORG}' and p."auctionSession" is not null and p.id not like 'rg%'`).split("\n").filter(Boolean);
  for (const n of names.slice(0, 3)) expect(intro).toContain(n);
  void supName;

  mkAuction("RG-BOB", 1000, { org: "org_b", sup: "s_b", wh: "w_b", mat: "m_b" });
  const cb = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, locale: "ru-RU" });
  const pb = await cb.newPage();
  await loginAs(pb, "bob@other-org.ru");
  await pb.goto("/payments");
  const txt = norm(await pb.locator("main").innerText());
  expect(txt).toContain("Supplier B");
  for (const n of names) expect(txt, `Bob не должен видеть поставщика «${n}» другой организации`).not.toContain(n);
  expect(txt).not.toMatch(/Веллмех/i);
  expect(txt).not.toContain("RG-B1");
  await cb.close();
});

test("подписи полей: клик по label ставит фокус в поле (формы аукциона, аванса, оплаты закупки)", async ({ page }) => {
  cleanRg();
  const pid = mkAuction("RG-LBL", 100_000);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl("RG-LBL"));
  const focusedAfterLabelClick = async (scope: ReturnType<typeof addForm>, label: string | RegExp) => {
    await scope.getByText(label, { exact: typeof label === "string" }).first().click();
    return page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a ? `${a.tagName}:${a.getAttribute("name") ?? ""}` : "";
    });
  };
  const af = addForm(page);
  expect(await focusedAfterLabelClick(af, "% от стоимости аукциона")).toBe("INPUT:percent");
  expect(await focusedAfterLabelClick(af, "или сумма, ₽")).toBe("INPUT:amount");
  expect(await focusedAfterLabelClick(af, "Заметка")).toBe("INPUT:notes");
  expect(await focusedAfterLabelClick(af, "Тип оплаты")).toBe("SELECT:kind");
  expect(await focusedAfterLabelClick(af, "Статус")).toBe("SELECT:status");
  expect(await focusedAfterLabelClick(af, "Способ")).toBe("SELECT:method");
  expect(await focusedAfterLabelClick(af, "Дата оплаты")).toBe("INPUT:paidAt");
  expect(await focusedAfterLabelClick(af, /Платёжный документ/)).toBe("INPUT:file");
  const adv = page.locator("form", { has: page.getByRole("button", { name: "Добавить платёж", exact: true }) });
  expect(await focusedAfterLabelClick(adv, "Поставщик")).toBe("SELECT:supplierId");
  expect(await focusedAfterLabelClick(adv, "Сумма, ₽")).toBe("INPUT:amount");
  expect(await focusedAfterLabelClick(adv, "Заметка")).toBe("INPUT:notes");
  expect(await focusedAfterLabelClick(adv, "Дата")).toBe("INPUT:paidAt");
  // поиск по аукционам
  await page.getByText("Поиск", { exact: true }).click();
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id)).toBe("auction-q");
  // форма оплаты в карточке закупки
  await page.goto(`/purchases/${pid}`);
  const pf = page.locator("form", { has: page.getByRole("button", { name: /Добавить оплату/ }) });
  expect(await focusedAfterLabelClick(pf, "Сумма, ₽")).toBe("INPUT:amount");
  expect(await focusedAfterLabelClick(pf, "Способ оплаты")).toBe("SELECT:method");
  expect(await focusedAfterLabelClick(pf, "Дата")).toBe("INPUT:paidAt");
  expect(await focusedAfterLabelClick(pf, "Заметка")).toBe("INPUT:notes");
});

test("список аукционов: порядок (актуальные с остатком → оплаченные → старые), поиск, «С остатком», «Переплата»", async ({ page }) => {
  cleanRg();
  mkAuction("RG-S1", 100_000, { daysAgo: 1 }); // свежий с остатком
  mkAuction("RG-S2", 100_000, { daysAgo: 1 }); // оплачен
  mkAuction("RG-S3", 100_000, { daysAgo: 800 }); // старый с остатком
  mkAuction("RG-S4", 100_000, { daysAgo: 1 }); // переплата
  mkAuction("RG-S5", 100_000, { daysAgo: 3 }); // свежий с остатком, старее S1
  insertPay("rg_pay_s2", { auction: "RG-S2", amount: 120_000, notes: "RG:s2" });
  insertPay("rg_pay_s4", { auction: "RG-S4", amount: 130_000, notes: "RG:s4" });
  await loginAs(page, "anna@qa-test.ru");
  const names = async () => (await page.locator('a[href*="auction="][href*="%23"], a[href*="auction="]').filter({ has: page.locator("dl") }).locator("div.font-medium").allInnerTexts()).map(norm);
  await page.goto("/payments?q=RG-S");
  expect(await names()).toEqual(["RG-S1", "RG-S5", "RG-S2", "RG-S4", "RG-S3"].map((x) => x));
  await expect(page.getByText(/Показано 5 из \d+/)).toBeVisible();
  // регистр и спецсимволы в поиске
  await page.goto("/payments?q=" + encodeURIComponent("rg-s3"));
  expect(await names()).toEqual(["RG-S3"]);
  await page.goto("/payments?q=" + encodeURIComponent("%"));
  expect((await names()).length).toBe(0);
  await expect(page.locator("main")).toContainText("По этому поиску и фильтру аукционов нет");
  // «С остатком» (через кнопку, с учётом поиска)
  await page.goto("/payments?q=RG-S");
  await page.getByRole("link", { name: "С остатком" }).click();
  await page.waitForURL(/f=rest/);
  expect(await names()).toEqual(["RG-S1", "RG-S5", "RG-S3"]);
  await page.getByRole("link", { name: "Все", exact: true }).click();
  await page.waitForURL((u) => !u.search.includes("f=rest"));
  expect((await names()).length).toBe(5);
  // поиск через форму
  await page.getByLabel("Поиск").fill("RG-S4");
  await page.getByRole("button", { name: "Найти" }).click();
  await page.waitForURL(/q=RG-S4/);
  expect(await names()).toEqual(["RG-S4"]);
  const card = page.locator('a[href*="auction=RG-S4"]').first();
  await expect(card).toContainText("Переплата");
  await expect(card).toContainText("переплата 10 000,00");
  expect(norm(await page.locator("main").innerText())).not.toMatch(/NaN|undefined|Infinity/);
});

// =====================================================================================
test.describe("«Закрыть остаток: оплачено до начала учёта»", () => {
  const closeBtn = (page: Page) => page.getByRole("button", { name: "Закрыть остаток: оплачено до начала учёта" });

  test("confirm с датой; оплата COMPLETED/OTHER на весь остаток; бейдж; Сводка и /payments = SQL; удаление = откат", async ({ page }) => {
    cleanRg();
    mkAuction("RG-C1", 100_000); // 120 000
    insertPay("rg_pay_c1", { auction: "RG-C1", amount: 20_000, notes: "RG:c1" });
    insertPay("rg_pay_c1p", { auction: "RG-C1", amount: 5_000, status: "PENDING", notes: "RG:c1p" }); // запланированная остаток не уменьшает
    const errors = watchErrors(page);
    const d = dialogs(page);
    await loginAs(page, "anna@qa-test.ru");
    const debt = async () => {
      await page.goto("/dashboard");
      const m = norm(await page.locator("main").innerText()).match(/Долг поставщикам[^\d-]*(-?[\d ]+,\d\d) ₽/);
      return m ? Number(m[1].replace(/ /g, "").replace(",", ".")) : NaN;
    };
    const topCards = async () => {
      await page.goto("/payments");
      const t = norm(await page.locator("main").innerText());
      const g = (l: string) => Number(t.match(new RegExp(l + " (-?[\\d ]+,\\d\\d) ₽"))![1].replace(/ /g, "").replace(",", "."));
      return { total: g("Стоимость аукционов, с НДС"), paid: g("Оплачено"), planned: g("Запланировано"), rest: g("Остаток к оплате") };
    };
    const sqlAll = () => {
      const [tot, paid, planned] = sql(`
        with a as (select split_part(p."auctionSession",E'\\n',1) n, p.id,
          coalesce((select sum(case when i."costPlan"->>'unitCostInclVat' is not null and i."costPlan"->>'materialExclVat' is not null and i."costPlan"->>'expenseExclVat' is not null then (i."costPlan"->>'unitCostInclVat')::numeric*i.quantity else i.subtotal*p."exchangeRate"*(1+i."vatRate"/100) end) from "PurchaseItem" i where i."purchaseId"=p.id),0)
          + coalesce((select sum(e.amount*(1+e."vatRate"/100)) from "PurchaseExpense" e where e."purchaseId"=p.id),0) tot, p.status
          from "Purchase" p where p."organizationId"='${ORG}' and p."auctionSession" is not null)
        select round(coalesce((select sum(tot) from a where status<>'CANCELLED'),0),2),
          (select coalesce(sum(amount),0) from "Payment" where "organizationId"='${ORG}' and status='COMPLETED' and ("auctionSession" is not null and "purchaseId" is null or "purchaseId" in (select id from a))),
          (select coalesce(sum(amount),0) from "Payment" where "organizationId"='${ORG}' and status='PENDING' and ("auctionSession" is not null and "purchaseId" is null or "purchaseId" in (select id from a)))`).split("|").map(Number);
      return { tot, paid, planned };
    };

    await page.goto(aucUrl("RG-C1"));
    await expect(closeBtn(page)).toBeVisible();
    const debt0 = await debt();
    const cards0 = await topCards();
    await page.goto(aucUrl("RG-C1"));
    await closeBtn(page).click();
    const dlg = page.getByRole("dialog", { name: "Подтверждение закрытия остатка" });
    await expect(dlg).toContainText("100 000,00 ₽"); // остаток = 120 000 − 20 000 (план 5 000 не вычитается)
    // отмена — ничего не создаёт
    await dlg.getByRole("button", { name: "Отмена" }).click();
    expect(payCount(`"auctionSession"='RG-C1' and notes='${CLOSING_NOTE}'`)).toBe(0);
    await closeBtn(page).click();
    await dlg.getByLabel("Дата оплаты").fill("2026-03-01");
    await dlg.getByRole("button", { name: "Подтвердить закрытие" }).click();
    await expect.poll(() => sql(`select kind,status,amount,method,to_char("paidAt",'YYYY-MM-DD'),"purchaseId" is null,"documentId" is null from "Payment" where "auctionSession"='RG-C1' and notes='${CLOSING_NOTE}'`)).toBe("OTHER|COMPLETED|100000.00|OTHER|2026-03-01|t|t");
    expect(d.msgs.length, "закрытие остатка идёт через встроенный диалог, не window.confirm").toBe(0);

    await page.goto(aucUrl("RG-C1"));
    await expect(closeBtn(page)).toHaveCount(0);
    await expect(page.locator("main")).toContainText("закрытие остатка"); // бейдж
    const card = norm(await page.locator("main").innerText());
    expect(card).toMatch(/Оплачен/);
    expect(card).toMatch(/Остаток 0,00 ₽|ОСТАТОК 0,00 ₽/i);
    // Сводка и /payments сходятся с SQL
    const debt1 = await debt();
    expect(Math.abs(debt0 - debt1 - 100_000), `Сводка: долг упал на ${debt0 - debt1}, ожидалось 100 000`).toBeLessThan(0.02);
    const cards1 = await topCards();
    const s = sqlAll();
    expect(Math.abs(cards1.total - s.tot)).toBeLessThan(0.02);
    expect(Math.abs(cards1.paid - s.paid)).toBeLessThan(0.02);
    expect(Math.abs(cards1.planned - s.planned)).toBeLessThan(0.02);
    expect(Math.abs(cards0.paid + 100_000 - cards1.paid)).toBeLessThan(0.02);

    // удаление = откат
    await page.goto(aucUrl("RG-C1"));
    d.msgs.length = 0;
    await rowOfClosing(page).getByRole("button", { name: "Удалить" }).click();
    await expect.poll(() => payCount(`"auctionSession"='RG-C1' and notes='${CLOSING_NOTE}'`)).toBe(0);
    expect(d.msgs[0]).toMatch(/Удалить закрытие остатка/);
    await page.goto(aucUrl("RG-C1"));
    await expect(closeBtn(page)).toBeVisible();
    expect(Math.abs((await debt()) - debt0)).toBeLessThan(0.02);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("двойное нажатие и гонка двух вкладок: создаётся ровно одна оплата", async ({ page, browser }) => {
    cleanRg();
    mkAuction("RG-C2", 100_000);
    dialogs(page);
    await loginAs(page, "anna@qa-test.ru");
    await page.goto(aucUrl("RG-C2"));
    await closeBtn(page).click();
    const dlg = page.getByRole("dialog", { name: "Подтверждение закрытия остатка" });
    await dlg.getByRole("button", { name: "Подтвердить закрытие" }).dblclick();
    await page.waitForTimeout(2000);
    expect(payCount(`"auctionSession"='RG-C2' and notes='${CLOSING_NOTE}'`), "двойной клик").toBe(1);

    sql(`delete from "Payment" where "auctionSession"='RG-C2'`);
    const mk = async () => {
      const c = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, locale: "ru-RU" });
      const p = await c.newPage();
      await loginAs(p, "anna@qa-test.ru");
      await p.goto(aucUrl("RG-C2"));
      await closeBtn(p).click();
      return { c, p };
    };
    const [x, y, z] = [await mk(), await mk(), await mk()];
    await Promise.all([x, y, z].map(({ p }) => p.getByRole("button", { name: "Подтвердить закрытие" }).click()));
    await x.p.waitForTimeout(2500);
    expect(payCount(`"auctionSession"='RG-C2' and notes='${CLOSING_NOTE}'`), "три вкладки одновременно").toBe(1);
    // проигравшие вкладки показывают понятную ошибку
    const errs = (await Promise.all([x, y, z].map(({ p }) => p.getByRole("alert").allInnerTexts()))).flat().join(" ");
    expect(errs).toMatch(/Остатка к оплате нет/);
    await Promise.all([x, y, z].map(({ c }) => c.close()));
  });

  test("права и изоляция: наблюдатель не видит кнопку и не может вызвать; бухгалтер может; чужая организация закрывает только своё", async ({ browser, page }) => {
    cleanRg();
    mkAuction("RG-C3", 100_000);
    mkAuction("RG-C3", 50_000, { org: "org_b", sup: "s_b", wh: "w_b", mat: "m_b" }); // одноимённый аукцион в другой организации
    // наблюдатель
    const cv = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, locale: "ru-RU" });
    const pv = await cv.newPage();
    await loginAs(pv, "viewer@qa-test.ru");
    await pv.goto(aucUrl("RG-C3"));
    await expect(closeBtn(pv)).toHaveCount(0);
    const rv = await callJson(pv, "/payments", "closeAuctionRemainder", ["RG-C3", "2026-03-01"]);
    expect(payCount(`"auctionSession"='RG-C3' and notes='${CLOSING_NOTE}'`), `наблюдатель создал оплату: ${rv.text}`).toBe(0);
    await cv.close();
    // Bob закрывает своё
    const cb = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, locale: "ru-RU" });
    const pb = await cb.newPage();
    await loginAs(pb, "bob@other-org.ru");
    const rb = await callJson(pb, "/payments", "closeAuctionRemainder", ["RG-C3", "2026-03-01"]);
    expect(rb.text).toMatch(/ok/);
    expect(payCount(`"organizationId"='org_b' and "auctionSession"='RG-C3' and amount=60000`), "у Bob закрыто 50 000 × 1,2").toBe(1);
    expect(payCount(`"organizationId"='${ORG}' and "auctionSession"='RG-C3'`), "организация Anna не затронута").toBe(0);
    // Bob: чужой аукцион, которого у него нет
    mkAuction("RG-C3X", 10_000);
    const rx = await callJson(pb, "/payments", "closeAuctionRemainder", ["RG-C3X", "2026-03-01"]);
    expect(rx.text).toMatch(/не найден/);
    expect(payCount(`"auctionSession"='RG-C3X'`)).toBe(0);
    // мусор вместо даты и аргументов
    for (const args of [["RG-C3X", "не дата"], ["RG-C3X", ""], ["RG-C3X", null], [null, null], ["RG-C3X", "2026-02-30"], ["RG-C3X"], []] as unknown[][]) {
      const r = await callJson(pb, "/payments", "closeAuctionRemainder", args);
      expect(r.status, JSON.stringify(args)).toBeLessThan(500);
    }
    await cb.close();
    // бухгалтер может
    await loginAs(page, "acc@qa-test.ru");
    await page.goto(aucUrl("RG-C3"));
    await closeBtn(page).click();
    await page.getByRole("button", { name: "Подтвердить закрытие" }).click();
    await expect.poll(() => payCount(`"organizationId"='${ORG}' and "auctionSession"='RG-C3' and notes='${CLOSING_NOTE}'`)).toBe(1);
  });

  test("закрытие переплаченного/оплаченного аукциона отклоняется; дата в будущем и мусорная дата", async ({ page }) => {
    cleanRg();
    mkAuction("RG-C4", 100_000);
    insertPay("rg_pay_c4", { auction: "RG-C4", amount: 120_000 });
    dialogs(page);
    await loginAs(page, "anna@qa-test.ru");
    await page.goto(aucUrl("RG-C4"));
    await expect(closeBtn(page)).toHaveCount(0); // остатка нет — кнопки нет
    const r = await callJson(page, "/payments", "closeAuctionRemainder", ["RG-C4", "2026-03-01"]);
    expect(r.text).toMatch(/Остатка к оплате нет/);
    expect(payCount(`"auctionSession"='RG-C4' and notes='${CLOSING_NOTE}'`)).toBe(0);
    mkAuction("RG-C5", 100_000);
    for (const bad of ["2026-02-30", "1800-01-01", "2101-01-01", "abc", ""]) {
      const rr = await callJson(page, "/payments", "closeAuctionRemainder", ["RG-C5", bad]);
      expect(rr.text, bad).toMatch(/error/);
    }
    expect(payCount(`"auctionSession"='RG-C5'`)).toBe(0);
  });
});

test("закрытие остатка датой в будущем: ожидается предупреждение или отказ (как в форме оплаты)", async ({ page }) => {
  cleanRg();
  mkAuction("RG-C6", 100_000);
  const d = dialogs(page);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl("RG-C6"));
  await page.getByRole("button", { name: "Закрыть остаток: оплачено до начала учёта" }).click();
  const dlg = page.getByRole("dialog", { name: "Подтверждение закрытия остатка" });
  await dlg.getByLabel("Дата оплаты").fill(nextYear());
  d.policy.accept = false;
  await dlg.getByRole("button", { name: "Подтвердить закрытие" }).click();
  await page.waitForTimeout(1500);
  const saved = payCount(`"auctionSession"='RG-C6' and notes='${CLOSING_NOTE}'`);
  expect(saved, "закрытие остатка датой в будущем записано как «Оплачено» без предупреждения (в форме оплаты предупреждение есть)").toBe(0);
});

test("оба режима НДС: суммы оплат/стоимость/остаток на /payments не зависят от переключателя, консоль чистая", async ({ page }) => {
  cleanRg();
  mkAuction("RG-VAT", 100_000);
  insertPay("rg_pay_vat", { auction: "RG-VAT", amount: 30_000, notes: "RG:vat" });
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  const u = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3291");
  const seen: string[] = [];
  for (const mode of ["incl", "excl"]) {
    await page.context().addCookies([{ name: "vatDisplay", value: mode, url: u.origin }]);
    await page.goto(aucUrl("RG-VAT"));
    const t = norm(await page.locator("main").innerText());
    seen.push([t.match(/Полная стоимость, с НДС (\S+ ?\S* ₽)/)?.[1], t.match(/ОСТАТОК (\S+ ?\S* ₽)/)?.[1]].join("/"));
    expect(t).toContain("120 000,00 ₽");
    expect(t).toContain("90 000,00 ₽");
    expect(t).not.toMatch(/NaN|undefined|Infinity/);
  }
  expect(seen[0]).toBe(seen[1]);
  expect(errors, errors.join("\n")).toEqual([]);
});

const rowOfClosing = (page: Page) => page.locator("div.rounded-lg.border.bg-white.p-3").filter({ hasText: CLOSING_NOTE }).last();
