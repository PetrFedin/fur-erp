import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { watchErrors } from "./helpers";

// Самодостаточные проверки раздела «Оплаты» (/payments): оплаты по аукциону (посредник — ООО «Веллмех»).
// Стенд: scripts/e2e.sh up pay 3271 (E2E_BASE_URL=http://localhost:3271), база fur_erp_e2e_pay,
// после up: cp -R uploads/purchase-docs /tmp/fur-e2e/pay-uploads/
const DB = "fur_erp_e2e_pay";
export function sql(q: string): string {
  return execSync(`docker exec -i fur-erp-db-1 psql -U fur_erp -d ${DB} -At -F '|' -v ON_ERROR_STOP=1`, { encoding: "utf8", input: q }).trim();
}
const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const SP = "СП 09-26";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3271";
const UPLOADS = "/tmp/fur-e2e/pay-uploads";
const ORG = "cmuo7vwvk0000lsu5pghd5jka";
const HASH = "$2b$10$4GjnSssJqUQKMd1CV4W48.ElNt4xt63QzGqtRFKhIb6GnMVT89.0G"; // TestPass123!
const PW = "TestPass123!";
const FIX = "/tmp/fur-e2e/fixtures";

const aucUrl = (a: string) => `/payments?auction=${encodeURIComponent(a)}#auction-block`;

export async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(PW);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}

/** Всегда принимает window.confirm и запоминает тексты. */
export function autoConfirm(page: Page, accept = true) {
  const msgs: string[] = [];
  page.on("dialog", async (d) => {
    msgs.push(d.message());
    if (accept) await d.accept();
    else await d.dismiss();
  });
  return msgs;
}

/** SQL: тотал аукциона = сумма итогов не отменённых закупок (с НДС, ₽) по расчёту из costPlan либо цене позиций. */
export function sqlTotals(): Record<string, { n: number; total: number }> {
  const out = sql(`
with t as (
 select p.id, p."auctionSession" a, p.status,
  coalesce((select sum(case when i."costPlan"->>'unitCostInclVat' is not null and i."costPlan"->>'materialExclVat' is not null and i."costPlan"->>'expenseExclVat' is not null
        then (i."costPlan"->>'unitCostInclVat')::numeric*i.quantity
        else i.subtotal*p."exchangeRate"*(1+i."vatRate"/100) end) from "PurchaseItem" i where i."purchaseId"=p.id),0)
  + coalesce((select sum(e.amount*(1+e."vatRate"/100)) from "PurchaseExpense" e where e."purchaseId"=p.id),0) tot
 from "Purchase" p where p."organizationId"='${ORG}' and p."auctionSession" is not null)
select split_part(a,E'\\n',1), count(*) filter (where status<>'CANCELLED'), round(coalesce(sum(tot) filter (where status<>'CANCELLED'),0),2) from t group by 1`);
  const r: Record<string, { n: number; total: number }> = {};
  for (const l of out.split("\n")) {
    const [name, n, total] = l.split("|");
    r[name] = { n: Number(n), total: Number(total) };
  }
  return r;
}
/** Оплачено/запланировано по аукциону из SQL (оплаты аукциона + оплаты его закупок, в т.ч. отменённых). */
export function sqlPaid(name: string, status: "COMPLETED" | "PENDING"): number {
  const v = sql(`select coalesce(sum(p.amount),0) from "Payment" p where p."organizationId"='${ORG}' and p.status='${status}' and (
    (p."purchaseId" is null and p."auctionSession"='${name}') or
    (p."purchaseId" in (select id from "Purchase" where "organizationId"='${ORG}' and split_part("auctionSession",E'\\n',1)='${name}')))`);
  return Number(v);
}

export const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
export const parseRub = (s: string) => Number(norm(s).replace(/[^\d,\-]/g, "").replace(",", "."));

test.beforeAll(() => {
  mkdirSync(FIX, { recursive: true });
  const users = [["u_viewer", "viewer", "VIEWER"], ["u_wh", "wh", "WAREHOUSE"], ["u_acc", "acc", "ACCOUNTANT"], ["u_tech", "tech", "TECHNOLOGIST"], ["u_purch", "purch", "PURCHASER"], ["u_admin", "admin", "ADMIN"]];
  sql(users.map(([id, e, r]) => `insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('${id}','${ORG}','${e}@qa-test.ru','${HASH}','QA ${e}','${r}',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash","isActive"=true`).join(";") + ";");
  sql(`insert into "Organization"(id,name,slug,"updatedAt") values ('org_b','Other Org','other-org',now()) on conflict do nothing`);
  sql(`insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('u_b','org_b','bob@other-org.ru','${HASH}','Bob','OWNER',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash"`);
  sql(`insert into "Supplier"(id,"organizationId",name,"updatedAt") values ('s_b','org_b','Supplier B',now()) on conflict do nothing`);
  sql(`insert into "Warehouse"(id,"organizationId",name) values ('w_b','org_b','WH B') on conflict do nothing`);
  sql(`insert into "RawMaterial"(id,"organizationId",name,"updatedAt") values ('m_b','org_b','Соболь B',now()) on conflict do nothing`);
  // Аукцион org B с тем же названием, что и у нас (проверка изоляции) и свой.
  sql(`insert into "Purchase"(id,"organizationId",number,"supplierId","warehouseId",currency,"exchangeRate","auctionSession","invoiceNumber","updatedAt") values ('p_b','org_b','Б-1','s_b','w_b','USD',80,'СП 09-26','B1',now()),('p_b2','org_b','Б-2','s_b','w_b','USD',80,'B-AUC','B2',now()) on conflict do nothing`);
  sql(`insert into "PurchaseItem"(id,"purchaseId","rawMaterialId",quantity,"unitPrice",subtotal,"vatRate","lotNumber") values ('pi_b','p_b','m_b',10,100,1000,20,'B-LOT'),('pi_b2','p_b2','m_b',10,100,1000,20,'B-LOT2') on conflict do nothing`);
  // фикстуры файлов
  writeFileSync(`${FIX}/ok.pdf`, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  writeFileSync(`${FIX}/empty.pdf`, "");
  writeFileSync(`${FIX}/fake.pdf`, "MZ this is not a pdf, just text");
  writeFileSync(`${FIX}/exe-as.pdf`, Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]));
  writeFileSync(`${FIX}/text.txt`, "hello");
  // jpg: минимальная сигнатура
  writeFileSync(`${FIX}/ok.jpg`, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"), Buffer.from([0xff, 0xd9])]));
  writeFileSync(`${FIX}/pdf-as.jpg`, "%PDF-1.4 pdf renamed to jpg\n%%EOF");
  writeFileSync(`${FIX}/jpg-as.pdf`, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0xff, 0xd9]));
  execSync(`cd ${FIX} && rm -f ok.xlsx fake.xlsx && mkdir -p x/xl && echo '<x/>' > 'x/[Content_Types].xml' && echo '<x/>' > x/xl/workbook.xml && (cd x && zip -qr ../ok.xlsx . ) && cp ok.xlsx zip-as.xlsx && cp ok.xlsx zip-as.docx && echo hi > h.txt && zip -q fake.xlsx h.txt`);
  execSync(`cd ${FIX} && head -c 26214400 /dev/zero > big0 && (printf '%%PDF-1.4\\n'; head -c 26214500 /dev/zero) > big.pdf && (printf '%%PDF-1.4\\n'; head -c 25000000 /dev/zero) > ok25.pdf`);
  mkdirSync(`${UPLOADS}/purchase-docs`, { recursive: true });
});

test.describe.configure({ mode: "serial" });

// ---------- (1) список аукционов ----------
test("1. /payments: список, итоги, статусы, полоса, сверка с SQL", async ({ page }) => {
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto("/payments");
  const tot = sqlTotals();
  const names = Object.keys(tot).filter((n) => n && n !== "");
  console.log("SQL totals", JSON.stringify(tot));
  const cards = page.locator('a[href^="/payments?auction="]');
  const cardCount = await cards.count();
  console.log("cards:", cardCount, "expected:", names.length);
  expect(cardCount).toBe(names.filter((n) => tot[n].n > 0).length);
  let sumTotal = 0;
  for (const n of Object.keys(tot)) {
    if (tot[n].n === 0) continue;
    sumTotal += tot[n].total;
    const href = `/payments?auction=${encodeURIComponent(n)}#auction-block`;
    const card = page.locator(`a[href="${href}"]`).first();
    const txt = norm(await card.innerText());
    const ok = txt.includes(norm(rub(tot[n].total)));
    console.log(n.slice(0, 30), ok ? "OK" : "MISMATCH", txt.slice(0, 160), "sql", tot[n].total);
  }
  const stat = norm(await page.locator("text=Стоимость аукционов, с НДС").locator("xpath=..").innerText());
  console.log("STAT:", stat, "sql sum", sumTotal);
  await page.screenshot({ path: "/tmp/fur-e2e/shots/1-list.png", fullPage: true });
  await expectNoErr(errors);
});

async function expectNoErr(errors: string[]) {
  expect(errors, errors.join("\n")).toEqual([]);
}

// ---------- общий помощник: заполнить и отправить форму оплаты ----------
type PayOpts = { kind?: string; status?: string; paidAt?: string; method?: string; percent?: string; amount?: string; notes?: string; file?: string; fill?: "Остаток" };
async function addPayment(page: Page, o: PayOpts, scope = page.locator("form:has(button:text-is('Добавить оплату'))")) {
  const f = scope;
  if (o.kind) await f.locator('select[name=kind]').selectOption(o.kind);
  if (o.status) await f.locator('select[name=status]').selectOption(o.status);
  if (o.method) await f.locator('select[name=method]').selectOption(o.method);
  if (o.paidAt) await f.locator('input[name=paidAt]').fill(o.paidAt);
  if (o.percent !== undefined) await f.locator('input[name=percent]').fill(o.percent);
  if (o.amount !== undefined) await f.locator('input[name=amount]').fill(o.amount);
  if (o.fill) await f.getByRole("button", { name: /Остаток:/ }).click();
  if (o.notes) await f.locator('input[name=notes]').fill(o.notes);
  if (o.file) await f.locator('input[type=file]').setInputFiles(o.file);
}
async function submitAdd(page: Page) {
  await page.locator("form:has(button:text-is('Добавить оплату'))").getByRole("button", { name: "Добавить оплату" }).click();
}
const payRows = () => sql(`select kind,status,amount,percent,"documentId" is not null,to_char("paidAt",'YYYY-MM-DD'),method,coalesce(notes,'') from "Payment" where "organizationId"='${ORG}' and "auctionSession"='${SP}' order by "createdAt"`);
const nPay = () => Number(sql(`select count(*) from "Payment" where "organizationId"='${ORG}'`));

test("2a. аванс 94% и в рублях, связь %<->₽", async ({ page }) => {
  const errors = watchErrors(page);
  const dialogs = autoConfirm(page);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl(SP));
  const form = page.locator("form:has(button:text-is('Добавить оплату'))");
  await expect(form).toBeVisible();
  const total = sqlTotals()[SP].total;
  // % -> сумма
  await form.locator("input[name=percent]").fill("94");
  const a94 = await form.locator("input[name=amount]").inputValue();
  console.log("94% ->", a94, "expected", (Math.round(total * 94) / 100).toFixed(2));
  // сумма -> %
  await form.locator("input[name=amount]").fill("60 831 100");
  const pct = await form.locator("input[name=percent]").inputValue();
  console.log("60 831 100 ->", pct, "%");
  await form.locator("input[name=percent]").fill("33,333");
  console.log("33,333% ->", await form.locator("input[name=amount]").inputValue());
  await page.screenshot({ path: "/tmp/fur-e2e/shots/2a-form.png", fullPage: true });
  // 94% отправляем
  await form.locator("input[name=percent]").fill("94");
  await submitAdd(page);
  await page.waitForTimeout(1500);
  console.log("rows:", payRows(), "dialogs", dialogs);
  await page.screenshot({ path: "/tmp/fur-e2e/shots/2a-after.png", fullPage: true });
  // в рублях
  await addPayment(page, { kind: "PARTIAL", amount: "1 000 000,555" });
  await submitAdd(page);
  await page.waitForTimeout(1500);
  console.log("rows:", payRows(), "dialogs", dialogs);
  await expectNoErr(errors);
});

const resetPay = () => sql(`delete from "Payment" where "organizationId"='${ORG}'; delete from "PurchaseDocument" where "organizationId"='${ORG}' and kind='PAYMENT_PROOF';`);
const formErr = async (page: Page) => (await page.locator("form [role=alert]").allInnerTexts()).join(" | ");

test("2b. граничные суммы и проценты", async ({ page }) => {
  const errors = watchErrors(page);
  const dialogs = autoConfirm(page, false);
  resetPay();
  await loginAs(page, "anna@qa-test.ru");
  const cases: [string, PayOpts][] = [
    ["amount 0", { amount: "0" }],
    ["amount -5", { amount: "-5" }],
    ["amount abc", { amount: "abc" }],
    ["amount empty+percent empty", {}],
    ["amount 0,004", { amount: "0,004" }],
    ["amount 1e5", { amount: "1e5" }],
    ["amount 1,5,5", { amount: "1,5,5" }],
    ["amount 1e12", { amount: "1000000000000" }],
    ["amount 999 999 999 999 (max)", { amount: "999999999999" }],
    ["percent 0", { percent: "0" }],
    ["percent -3", { percent: "-3" }],
    ["percent 1001", { percent: "1001" }],
    ["percent abc", { percent: "abc" }],
    ["percent 0,00001", { percent: "0,00001" }],
    ["percent 1000 (confirm dismissed)", { percent: "1000" }],
  ];
  for (const [name, o] of cases) {
    await page.goto(aucUrl(SP));
    await addPayment(page, o);
    const before = nPay();
    await submitAdd(page);
    await page.waitForTimeout(900);
    console.log(`[${name}] err="${await formErr(page)}" dialogs=${JSON.stringify(dialogs.splice(0))} saved=${nPay() - before}`);
  }
  await expectNoErr(errors);
});

test("2c. запятая, пробелы, округление; сохранённые значения", async ({ page }) => {
  const errors = watchErrors(page);
  autoConfirm(page);
  resetPay();
  await loginAs(page, "anna@qa-test.ru");
  const amounts = ["1 234,567", "1234.5", "  2 000  ", "0,006", "0,01", "10,125", "10,135"];
  for (const a of amounts) {
    await page.goto(aucUrl(SP));
    await addPayment(page, { amount: a });
    await submitAdd(page);
    await page.waitForTimeout(700);
    console.log(`[${a}] err="${await formErr(page)}"`);
  }
  console.log(payRows());
  await expectNoErr(errors);
});

const sumOf = (st: string) => Number(sql(`select coalesce(sum(amount),0) from "Payment" where "organizationId"='${ORG}' and "auctionSession"='${SP}' and status='${st}'`));

test("2d. Остаток, запланирована->оплачена, переплата, будущая дата", async ({ page }) => {
  const errors = watchErrors(page);
  const dialogs = autoConfirm(page, true);
  resetPay();
  await loginAs(page, "anna@qa-test.ru");
  const total = sqlTotals()[SP].total;
  await page.goto(aucUrl(SP));
  await addPayment(page, { percent: "94" });
  await submitAdd(page);
  await page.waitForTimeout(1200);
  // запланированная
  const future = "2026-12-15";
  await page.goto(aucUrl(SP));
  await addPayment(page, { kind: "PARTIAL", status: "PENDING", paidAt: future, amount: "1000000" });
  await submitAdd(page);
  await page.waitForTimeout(1200);
  console.log("after planned: dialogs", dialogs.splice(0), "paid", sumOf("COMPLETED"), "planned", sumOf("PENDING"));
  // Остаток для FINAL
  await page.goto(aucUrl(SP));
  const form = page.locator("form:has(button:text-is('Добавить оплату'))");
  await form.locator("select[name=kind]").selectOption("FINAL");
  const btn = form.getByRole("button", { name: /Остаток:/ });
  const btnText = norm(await btn.innerText());
  const expectedRest = Math.round((total - sumOf("COMPLETED") - sumOf("PENDING")) * 100) / 100;
  console.log("button:", btnText, "expected rest", expectedRest);
  await btn.click();
  console.log("amount after click:", await form.locator("input[name=amount]").inputValue(), "percent:", await form.locator("input[name=percent]").inputValue(), "info:", norm(await form.locator("p.text-sm").first().innerText()));
  await submitAdd(page);
  await page.waitForTimeout(1200);
  console.log("after FINAL: dialogs", dialogs.splice(0), "paid", sumOf("COMPLETED"), "planned", sumOf("PENDING"), "total", total, "sum", sumOf("COMPLETED") + sumOf("PENDING"));
  await page.goto(aucUrl(SP));
  console.log("card:", norm(await page.locator(`a[href="${aucUrl(SP)}"]`).first().innerText()));
  await page.screenshot({ path: "/tmp/fur-e2e/shots/2d-after-final.png", fullPage: true });
  // планируемая -> оплачена: правка
  const row = page.locator("div.border-dashed").first();
  await row.getByRole("button", { name: "Править" }).click();
  const ef = row.locator("form");
  await ef.locator("select[name=status]").selectOption("COMPLETED");
  await ef.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(1500);
  console.log("after edit planned->paid: dialogs", dialogs.splice(0), "paid", sumOf("COMPLETED"), "planned", sumOf("PENDING"), "err", await formErr(page));
  console.log(payRows());
  // переплата: ещё 1 000 (принять)
  await page.goto(aucUrl(SP));
  await addPayment(page, { kind: "OTHER", amount: "1000" });
  await submitAdd(page);
  await page.waitForTimeout(1200);
  console.log("overpay dialogs", dialogs.splice(0), "paid", sumOf("COMPLETED"));
  await page.goto(aucUrl(SP));
  console.log("card:", norm(await page.locator(`a[href="${aucUrl(SP)}"]`).first().innerText()));
  console.log("banner:", norm((await page.locator("p.bg-blue-50").allInnerTexts()).join("|")));
  await page.screenshot({ path: "/tmp/fur-e2e/shots/2d-overpaid.png", fullPage: true });
  // будущая дата оплаченной
  await addPayment(page, { paidAt: "2027-05-01", amount: "5" });
  await submitAdd(page);
  await page.waitForTimeout(1000);
  console.log("future-date dialogs:", dialogs.splice(0), payRows().split("\n").slice(-1));
  await expectNoErr(errors);
});

const proofDir = `${UPLOADS}/purchase-docs/${ORG}/payments`;
const filesOnDisk = () => { try { return execSync(`ls ${proofDir} 2>/dev/null | wc -l`, { encoding: "utf8" }).trim(); } catch { return "0"; } };
const docs = () => sql(`select d.id,d."originalName",d."mimeType",d."sizeBytes",d."storagePath",d.batch,d.title from "PurchaseDocument" d where d."organizationId"='${ORG}' and d.kind='PAYMENT_PROOF' order by d."createdAt"`);

test("2e. платёжки: типы, подмена, размер, пустой", async ({ page }) => {
  const errors = watchErrors(page);
  const dialogs = autoConfirm(page, true);
  resetPay();
  execSync(`rm -rf ${proofDir}`);
  await loginAs(page, "anna@qa-test.ru");
  const files = ["ok.pdf", "ok.jpg", "ok.xlsx", "zip-as.docx", "pdf-as.jpg", "jpg-as.pdf", "fake.xlsx", "exe-as.pdf", "text.txt", "empty.pdf", "big.pdf", "ok25.pdf"];
  for (const f of files) {
    await page.goto(aucUrl(SP));
    const before = nPay();
    const d0 = filesOnDisk();
    await addPayment(page, { amount: "100", file: `${FIX}/${f}`, notes: f });
    await submitAdd(page);
    await page.waitForTimeout(f.startsWith("big") || f === "ok25.pdf" ? 3000 : 1000);
    console.log(`[${f}] err="${await formErr(page)}" saved=${nPay() - before} disk ${d0}->${filesOnDisk()} dialogs=${JSON.stringify(dialogs.splice(0))}`);
  }
  console.log(docs());
  console.log("PAY with doc:", payRows());
  await expectNoErr(errors);
});

test("2f. скачивание, замена, снятие, удаление платёжки и оплаты", async ({ page }) => {
  const errors = watchErrors(page);
  const dialogs = autoConfirm(page, true);
  resetPay();
  execSync(`rm -rf ${proofDir}`);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl(SP));
  await addPayment(page, { amount: "500", file: `${FIX}/ok.pdf`, notes: "первая" });
  await submitAdd(page);
  await page.waitForTimeout(1200);
  await page.goto(aucUrl(SP));
  await addPayment(page, { amount: "700", file: `${FIX}/ok.jpg`, notes: "вторая" });
  await submitAdd(page);
  await page.waitForTimeout(1200);
  console.log("docs", docs().split("\n").length, "disk", filesOnDisk());
  await page.goto(aucUrl(SP));
  // скачивание
  const dl = page.getByRole("link", { name: "Скачать" }).first();
  const href = await dl.getAttribute("href");
  const r = await page.request.get(href!);
  console.log("download:", r.status(), r.headers()["content-type"], r.headers()["content-disposition"], (await r.body()).length);
  const open = await page.request.get(href!.replace("download=1&", ""));
  console.log("open inline:", open.status(), open.headers()["content-disposition"]);
  // замена платёжки у первой оплаты (ok.pdf -> ok.xlsx)
  const rowOf = (note: string) => page.locator("div.rounded-lg.border.bg-white.p-3").filter({ hasText: new RegExp("Заметка: " + note + "(?![\\wа-я-])") });
  const r1 = rowOf("первая");
  await r1.getByRole("button", { name: "Править" }).click();
  await r1.locator("input[type=file]").setInputFiles(`${FIX}/ok.xlsx`);
  await r1.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(1500);
  console.log("после замены: docs", docs().split("\n").map((l) => l.split("|").slice(1, 3).join("/")), "disk", filesOnDisk());
  // правка без файла: документ остаётся
  await page.goto(aucUrl(SP));
  const r1b = rowOf("первая");
  await r1b.getByRole("button", { name: "Править" }).click();
  await r1b.locator("input[name=notes]").fill("первая-правка");
  await r1b.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(1200);
  console.log("после правки заметки: docs", docs().split("\n").length, "pay:", payRows().split("\n"));
  // снятие документа
  await page.goto(aucUrl(SP));
  const r1c = rowOf("первая-правка");
  await r1c.getByRole("button", { name: "Править" }).click();
  await r1c.locator("input[name=removeDocument]").check();
  await r1c.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(1200);
  console.log("после снятия: docs", docs().split("\n").length, "disk", filesOnDisk());
  // замена сломанным файлом: ошибка, старый остаётся
  await page.goto(aucUrl(SP));
  const r2 = rowOf("вторая");
  await r2.getByRole("button", { name: "Править" }).click();
  await r2.locator("input[type=file]").setInputFiles(`${FIX}/fake.pdf`);
  await r2.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(1200);
  console.log("замена сломанным: err", await formErr(page), "docs", docs().split("\n").length, "disk", filesOnDisk());
  // удаление оплаты с докуметом: dismissed confirm
  autoConfirm; 
  await page.goto(aucUrl(SP));
  const r2b = rowOf("вторая");
  await r2b.getByRole("button", { name: "Удалить" }).click();
  await page.waitForTimeout(1500);
  console.log("после удаления: dialogs", dialogs.splice(0), "pay", nPay(), "docs", docs().split("\n").filter(Boolean).length, "disk", filesOnDisk());
  await expectNoErr(errors);
});

test("2g. платёжка видна в режиме «Аукцион» /lots; удаление там", async ({ page }) => {
  const errors = watchErrors(page);
  autoConfirm(page, true);
  resetPay();
  execSync(`rm -rf ${proofDir}`);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl(SP));
  await addPayment(page, { amount: "500", file: `${FIX}/ok.pdf`, notes: "docpay" });
  await submitAdd(page);
  await page.waitForTimeout(1200);
  await page.goto(`/lots?auction=${encodeURIComponent(SP)}`);
  const txt = norm(await page.locator("main").innerText());
  console.log("lots page mentions payment proof:", /Платёжка/.test(txt), /Платёжный документ/.test(txt));
  const m = txt.match(/.{80}Платёжка.{120}/);
  console.log("context:", m?.[0]);
  await page.screenshot({ path: "/tmp/fur-e2e/shots/2g-lots.png", fullPage: true });
  const del = page.getByRole("button", { name: /Удалить/ });
  console.log("delete buttons on lots page:", await del.count());
  await expectNoErr(errors);
});

test("2h. удаление платёжки из /lots не ломает оплату", async ({ page }) => {
  const errors = watchErrors(page);
  const dialogs = autoConfirm(page, true);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(`/lots?auction=${encodeURIComponent(SP)}`);
  const row = page.locator("li, tr, div").filter({ hasText: "Платёжка: Аванс" }).filter({ has: page.getByRole("button", { name: "Удалить" }) }).last();
  await row.getByRole("button", { name: "Удалить" }).first().click();
  await page.waitForTimeout(1500);
  console.log("dialogs", dialogs.splice(0));
  console.log("docs", docs(), "pay", payRows(), "disk", filesOnDisk());
  await page.goto(aucUrl(SP));
  console.log(norm(await page.locator("div.rounded-lg.border.bg-white.p-3").last().innerText()).slice(0, 300));
  await expectNoErr(errors);
});

// ---------- (3) Сводка: долг ----------
const SUPPLIER = "cmupc49fy003jls83tdqxr606";
const WH = () => sql(`select "warehouseId" from "Purchase" where "organizationId"='${ORG}' limit 1`);
function pay(id: string, o: { purchase?: string; auction?: string; status?: string; amount: number; kind?: string; paidAt?: string; notes?: string }) {
  sql(`insert into "Payment"(id,"organizationId","supplierId","purchaseId","auctionSession",amount,status,kind,"paidAt",notes) values ('${id}','${ORG}','${SUPPLIER}',${o.purchase ? `'${o.purchase}'` : "null"},${o.auction ? `'${o.auction}'` : "null"},${o.amount},'${o.status ?? "COMPLETED"}','${o.kind ?? "OTHER"}','${o.paidAt ?? "2026-09-01"}',${o.notes ? `'${o.notes}'` : "null"})`);
}
/** Ожидаемый долг из SQL: Σ по аукционам max(стоимость − оплачено, 0) + закупки без аукциона, минус авансы без привязки (в рамках единственного поставщика). */
export function expectedDebt(): { total: number; perAuction: Record<string, number> } {
  const tot = sqlTotals();
  const perAuction: Record<string, number> = {};
  let sum = 0;
  for (const n of Object.keys(tot)) {
    const d = Math.max(tot[n].total - sqlPaid(n, "COMPLETED"), 0);
    if (d > 0.005) { perAuction[n] = Math.round(d * 100) / 100; sum += d; }
  }
  // закупки без аукциона
  const noAuc = sql(`select p.id, coalesce((select sum(case when i."costPlan"->>'unitCostInclVat' is not null and i."costPlan"->>'materialExclVat' is not null and i."costPlan"->>'expenseExclVat' is not null then (i."costPlan"->>'unitCostInclVat')::numeric*i.quantity else i.subtotal*p."exchangeRate"*(1+i."vatRate"/100) end) from "PurchaseItem" i where i."purchaseId"=p.id),0)+coalesce((select sum(e.amount*(1+e."vatRate"/100)) from "PurchaseExpense" e where e."purchaseId"=p.id),0) - coalesce((select sum(amount) from "Payment" x where x."purchaseId"=p.id and x.status='COMPLETED'),0) from "Purchase" p where p."organizationId"='${ORG}' and p.status<>'CANCELLED' and (p."auctionSession" is null or btrim(split_part(p."auctionSession",E'\\n',1))='')`);
  for (const l of noAuc.split("\n").filter(Boolean)) { const v = Number(l.split("|")[1]); if (v > 0) sum += v; }
  const adv = Number(sql(`select coalesce(sum(amount),0) from "Payment" where "organizationId"='${ORG}' and "purchaseId" is null and "auctionSession" is null and status='COMPLETED'`));
  return { total: Math.round(Math.max(sum - adv, 0) * 100) / 100, perAuction };
}

async function dashDebt(page: Page) {
  await page.goto("/dashboard");
  const kpi = page.locator("div", { hasText: /^Долг поставщикам/ }).first();
  const body = norm(await page.locator("main").innerText());
  const m = body.match(/Долг поставщикам[^\d-]*(-?[\d  ]+,\d\d) ₽/);
  const rows = await page.locator("a[href^='/payments?auction=']").allInnerTexts();
  return { kpi: m ? parseRub(m[1]) : NaN, rows: rows.map(norm), body };
}

test("3. Сводка: долг по аукционам = SQL (оплаты аукциона, закупок, авансы, отменённые, запланированные)", async ({ page }) => {
  const errors = watchErrors(page);
  resetPay();
  sql(`delete from "Purchase" where id in ('t_cancel','t_cancel_pay')`);
  await loginAs(page, "anna@qa-test.ru");
  let d = await dashDebt(page);
  let e = expectedDebt();
  console.log("0) базовое: app", d.kpi, "sql", e.total);
  const sp1 = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' order by number limit 1`);
  const sp2 = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' order by number desc limit 1`);
  // 1) оплата аукциона
  pay("t_a1", { auction: SP, amount: 10_000_000, kind: "ADVANCE" });
  pay("t_a2", { auction: SP, amount: 3_000_000, status: "PENDING" });
  d = await dashDebt(page); e = expectedDebt();
  console.log("1) оплата аукциона 10M + план 3M: app", d.kpi, "sql", e.total, "СП09-26 sql", e.perAuction[SP]);
  // 2) оплата закупки внутри аукциона
  pay("t_p1", { purchase: sp1, amount: 2_000_000 });
  pay("t_p2", { purchase: sp1, amount: 500_000, status: "PENDING" });
  d = await dashDebt(page); e = expectedDebt();
  console.log("2) + оплата закупки 2M + план 0.5M: app", d.kpi, "sql", e.total);
  // 3) отменённая закупка аукциона с оплатой
  sql(`insert into "Purchase"(id,"organizationId",number,"supplierId","warehouseId",status,currency,"exchangeRate","auctionSession","updatedAt") values ('t_cancel','${ORG}','ТЕСТ-ОТМ','${SUPPLIER}','${WH()}','CANCELLED','RUB',1,'${SP}',now())`);
  sql(`insert into "PurchaseItem"(id,"purchaseId","rawMaterialId",quantity,"unitPrice",subtotal,"vatRate") select 't_cancel_i','t_cancel',"rawMaterialId",1,9999999,9999999,20 from "PurchaseItem" limit 1`);
  pay("t_c1", { purchase: "t_cancel", amount: 1_000_000 });
  d = await dashDebt(page); e = expectedDebt();
  console.log("3) + отменённая закупка (9 999 999 не входит) с оплатой 1M: app", d.kpi, "sql", e.total);
  // 4) аванс без привязки
  pay("t_adv", { amount: 5_000_000, kind: "ADVANCE" });
  pay("t_adv2", { amount: 7_000_000, status: "PENDING" });
  d = await dashDebt(page); e = expectedDebt();
  console.log("4) + аванс без привязки 5M (+план 7M): app", d.kpi, "sql", e.total);
  console.log("   top rows:", d.rows.slice(0, 5));
  // 5) переплата аукциона
  pay("t_over", { auction: SP, amount: 100_000_000 });
  d = await dashDebt(page); e = expectedDebt();
  console.log("5) переплата СП 09-26 100M: app", d.kpi, "sql", e.total, "СП в разбивке:", d.rows.some((r) => r.startsWith(SP)));
  await page.screenshot({ path: "/tmp/fur-e2e/shots/3-dash.png", fullPage: true });
  // сверка карточки аукциона на /payments с SQL
  await page.goto(aucUrl(SP));
  const card = norm(await page.locator(`a[href="${aucUrl(SP)}"]`).first().innerText());
  console.log("card:", card, "sql paid", sqlPaid(SP, "COMPLETED"), "planned", sqlPaid(SP, "PENDING"));
  await expectNoErr(errors);
});

test("4. карточка закупки и список: «Оплачено» только COMPLETED, ссылка на аукцион", async ({ page }) => {
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  const sp1 = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' and id not like 't_%' order by number limit 1`);
  const num = sql(`select number from "Purchase" where id='${sp1}'`);
  await page.goto(`/purchases/${sp1}`);
  const body = norm(await page.locator("main").innerText());
  console.log("purchase", num, "->", body.match(/Оплачено[^А-Яа-я]{0,40}/g));
  console.log("auction line:", body.match(/Оплаты Веллмех по аукциону[^.]*\./)?.[0]);
  console.log("payments block:", body.match(/Оплат(ы|а)\b.{0,300}$/)?.[0]?.slice(0, 300));
  const link = page.getByRole("link", { name: /Оплаты Веллмех по аукциону/ });
  console.log("link href", await link.getAttribute("href"));
  await page.screenshot({ path: "/tmp/fur-e2e/shots/4-purchase.png", fullPage: true });
  await page.goto(`/purchases?auction=${encodeURIComponent(SP)}`);
  const rows = await page.locator("tbody tr").allInnerTexts();
  console.log(rows.map((r) => norm(r)).filter((r) => r.includes(num) || r.includes("ТЕСТ")).join("\n"));
  console.log("header:", norm(await page.locator("thead").innerText()));
  await page.screenshot({ path: "/tmp/fur-e2e/shots/4-list.png", fullPage: true });
  await expectNoErr(errors);
});

const cleanTest = () => { resetPay(); sql(`delete from "Purchase" where id in ('t_cancel')`); };

test("5a. две одновременные «Остаток» (confirm отклоняется)", async ({ browser }) => {
  cleanTest();
  const total = sqlTotals()[SP].total;
  const mk = async () => {
    const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
    const p = await ctx.newPage();
    const d = autoConfirm(p, false);
    await loginAs(p, "anna@qa-test.ru");
    await p.goto(aucUrl(SP));
    await addPayment(p, { kind: "FINAL", fill: "Остаток" });
    return { ctx, p, d };
  };
  const a = await mk();
  const b = await mk();
  console.log("amounts:", await a.p.locator("form:has(button:text-is('Добавить оплату')) input[name=amount]").inputValue(), await b.p.locator("form:has(button:text-is('Добавить оплату')) input[name=amount]").inputValue());
  await Promise.all([submitAdd(a.p), submitAdd(b.p)]);
  await a.p.waitForTimeout(2500);
  console.log("saved rows:", payRows().split("\n").filter(Boolean).length, "dialogs a", a.d, "b", b.d, "paid", sumOf("COMPLETED"), "total", total);
  // Если подтверждать: итог = переплата (ожидаемо, это confirm-путь)
  await a.ctx.close(); await b.ctx.close();
});

test("5b. 8 параллельных оплат по 10% — блокировка аукциона; confirm принят", async ({ browser }) => {
  cleanTest();
  const total = sqlTotals()[SP].total;
  const pages = [];
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
    const p = await ctx.newPage();
    autoConfirm(p, true);
    await loginAs(p, "anna@qa-test.ru");
    await p.goto(aucUrl(SP));
    await addPayment(p, { percent: "30", notes: "par" + i });
    pages.push({ ctx, p });
  }
  await Promise.all(pages.map(({ p }) => submitAdd(p)));
  await pages[0].p.waitForTimeout(4000);
  const paid = sumOf("COMPLETED");
  console.log("4 параллельных по 30%: сохранено", payRows().split("\n").filter(Boolean).length, "оплачено", paid, "ожидали 4×", Math.round(total * 30) / 100);
  for (const { ctx } of pages) await ctx.close();
});

test("5c. одновременное удаление и удаление/правка", async ({ browser }) => {
  cleanTest();
  const ctx1 = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
  const ctx2 = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
  const [p1, p2] = [await ctx1.newPage(), await ctx2.newPage()];
  autoConfirm(p1, true); autoConfirm(p2, true);
  const e1 = watchErrors(p1), e2 = watchErrors(p2);
  await loginAs(p1, "anna@qa-test.ru"); await loginAs(p2, "anna@qa-test.ru");
  await p1.goto(aucUrl(SP));
  await addPayment(p1, { amount: "777", notes: "del", file: `${FIX}/ok.pdf` });
  await submitAdd(p1);
  await p1.waitForTimeout(1500);
  await p1.goto(aucUrl(SP)); await p2.goto(aucUrl(SP));
  console.log("disk before:", filesOnDisk(), "docs", docs().split("\n").filter(Boolean).length);
  await Promise.all([p1.getByRole("button", { name: "Удалить" }).first().click(), p2.getByRole("button", { name: "Удалить" }).first().click()]);
  await p1.waitForTimeout(2500);
  console.log("после двойного удаления: pay", nPay(), "docs", docs().split("\n").filter(Boolean).length, "disk", filesOnDisk());
  console.log("err p1:", await p1.locator("p.text-xs.text-red-600").allInnerTexts(), "err p2:", await p2.locator("p.text-xs.text-red-600").allInnerTexts());
  // удалить vs править
  await p1.goto(aucUrl(SP));
  await addPayment(p1, { amount: "888", notes: "x2", file: `${FIX}/ok.pdf` });
  await submitAdd(p1);
  await p1.waitForTimeout(1500);
  await p1.goto(aucUrl(SP)); await p2.goto(aucUrl(SP));
  const row2 = p2.locator("div.rounded-lg.border.bg-white.p-3").last();
  await row2.getByRole("button", { name: "Править" }).click();
  await row2.locator("input[name=notes]").fill("edited");
  await Promise.all([p1.getByRole("button", { name: "Удалить" }).first().click(), row2.getByRole("button", { name: "Сохранить" }).click()]);
  await p1.waitForTimeout(2500);
  console.log("удалить vs править: pay", nPay(), "docs", docs().split("\n").filter(Boolean).length, "disk", filesOnDisk(), "p2 err:", await p2.locator("form [role=alert]").allInnerTexts());
  console.log("errors", e1, e2);
  await ctx1.close(); await ctx2.close();
});

test("6-pre. захват формата запроса server action", async ({ page }) => {
  cleanTest();
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl(SP));
  const reqs: any[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) reqs.push({ h: r.headers(), body: r.postData()?.slice(0, 1500) }); });
  await addPayment(page, { amount: "321", notes: "cap" });
  await submitAdd(page);
  await page.waitForTimeout(1200);
  console.log(JSON.stringify(reqs[0], null, 1));
  await page.goto(aucUrl(SP));
  await page.locator("div.rounded-lg.border.bg-white.p-3").last().getByRole("button", { name: "Удалить" }).click().catch(() => {});
});

// ---------- (6) права и изоляция: прямые вызовы server actions ----------
const IDS = {
  create: "6031e125f3b9bc41cde19329911de576d7878fbd3e",
  update: "609f0e8562bb8a4434bda8906d4e207579677024ef",
  del: "40966c69ee5cc85cc5b909b99ec3d562932d957ac2",
  advance: "407ca949fd9d66b7c8f5ec339bcb5664220d4b371d",
  addPurchasePay: "6037f406b0cdbdfccaddb7bd829daa3d98fa94709a",
  docDelete: "608deda54d11c08330d49221941e6241253a374002",
  docReplace: "60e2174d2f9d80dae30d1a645eed3a1a232f28c8e4",
  docUpdate: "60ebb3edac0bac839c7f46a5f0b1b540aecfddd9be",
};
async function callAction(page: Page, id: string, args: unknown[], fields?: Record<string, string>, file?: { name: string; path: string }) {
  // Тело как у браузера: поля формы с префиксом «_1_», «0» (аргументы, FormData = "$K1") — последним.
  const b = "----WebKitFormBoundaryQA" + Date.now();
  const parts: Buffer[] = [];
  const add = (name: string, value: string | Buffer, filename?: string) => {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${name}"${filename !== undefined ? `; filename="${filename}"` : ""}\r\n${filename !== undefined ? "Content-Type: application/octet-stream\r\n" : ""}\r\n`));
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    parts.push(Buffer.from("\r\n"));
  };
  for (const [k, v] of Object.entries(fields ?? {})) add(`_1_${k}`, v);
  if (file) add("_1_file", require("node:fs").readFileSync(file.path), file.name);
  add("0", JSON.stringify(args));
  parts.push(Buffer.from(`--${b}--\r\n`));
  const r = await page.request.post("/payments", {
    headers: { "Next-Action": id, accept: "text/x-component", "content-type": `multipart/form-data; boundary=${b}` },
    data: Buffer.concat(parts),
    maxRedirects: 0,
  });
  const text = await r.text();
  const res = text.match(/\n1:(\{[^\n]*\})/)?.[1] ?? text.slice(0, 160);
  return { status: r.status(), text: res.replace(/\s+/g, " ") };
}
const payFields = (extra: Record<string, string> = {}) => ({ kind: "ADVANCE", status: "COMPLETED", method: "BANK_TRANSFER", paidAt: "2026-10-01", amount: "111", mode: "amount", notes: "perm", ...extra });
const cnt = (cond: string) => Number(sql(`select count(*) from "Payment" where ${cond}`));

test("6a. роли: кто может вносить оплаты (UI и сервер)", async ({ browser }) => {
  cleanTest();
  pay("t_seed", { auction: SP, amount: 1000, notes: "seed" });
  const roles: [string, string, boolean][] = [["viewer", "VIEWER", false], ["wh", "WAREHOUSE", false], ["tech", "TECHNOLOGIST", false], ["acc", "ACCOUNTANT", true], ["purch", "PURCHASER", true], ["admin", "ADMIN", true], ["anna", "OWNER", true]];
  for (const [e, role, can] of roles) {
    const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await loginAs(page, `${e}@qa-test.ru`);
    await page.goto(aucUrl(SP));
    const uiForm = await page.locator("form:has(button:text-is('Добавить оплату'))").count();
    const advForm = await page.getByText("Аванс / предоплата поставщику").count();
    const before = cnt(`"organizationId"='${ORG}'`);
    const r = await callAction(page, IDS.create, [SP, "$K1"], payFields({ notes: "perm-" + role }));
    const after = cnt(`"organizationId"='${ORG}'`);
    // изменение/удаление чужой (вашей) оплаты
    const anyPay = sql(`select id from "Payment" where id='t_seed'`);
    const upd = anyPay ? await callAction(page, IDS.update, [anyPay, "$K1"], payFields({ amount: "222", notes: "upd-" + role })) : { status: 0, text: "" };
    const updated = anyPay ? sql(`select notes from "Payment" where id='${anyPay}'`) : "";
    const adv = await callAction(page, IDS.advance, ["$K1"], { supplierId: SUPPLIER, amount: "5", method: "CASH", paidAt: "2026-10-01" }).catch((x) => ({ status: -1, text: String(x) }));
    const advSaved = cnt(`"organizationId"='${ORG}' and "auctionSession" is null and "purchaseId" is null and amount=5`);
    console.log(`[${role}] ожидаем ${can ? "МОЖЕТ" : "НЕЛЬЗЯ"} | UI-форма=${uiForm} форма-аванса=${advForm} | create: HTTP ${r.status} сохранено=${after - before} ${r.text.slice(0, 120)} | update: ${upd.status} notes="${updated}" | advance: ${adv.status} сохранено=${advSaved}`);
    if (!can) {
      const del = anyPay ? await callAction(page, IDS.del, [anyPay]) : { status: 0, text: "" };
      console.log(`   delete: HTTP ${del.status} ещё есть=${cnt(`id='${anyPay}'`)} ${del.text.slice(0, 100)}`);
    }
    await ctx.close();
    sql(`delete from "Payment" where "organizationId"='${ORG}' and amount=5 and "auctionSession" is null`);
    if (errors.length) console.log("   errors:", errors.slice(0, 3));
  }
});



test("6b. чужая организация не видит и не меняет оплаты и документы", async ({ browser }) => {
  cleanTest();
  execSync(`rm -rf ${proofDir}`);
  // у org A: оплата с документом
  const ca = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
  const pa = await ca.newPage();
  autoConfirm(pa, true);
  await loginAs(pa, "anna@qa-test.ru");
  await pa.goto(aucUrl(SP));
  await addPayment(pa, { amount: "4242", notes: "A-secret", file: `${FIX}/ok.pdf` });
  await submitAdd(pa);
  await pa.waitForTimeout(1200);
  const payA = sql(`select id from "Payment" where notes='A-secret'`);
  const docA = sql(`select "documentId" from "Payment" where id='${payA}'`);
  const supA = SUPPLIER;
  const purA = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' and id not like 't\\_%' limit 1`);
  const snapA = sql(`select count(*), coalesce(sum(amount),0) from "Payment" where "organizationId"='${ORG}'`);

  const cb = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
  const pb = await cb.newPage();
  const eb = watchErrors(pb);
  autoConfirm(pb, true);
  await loginAs(pb, "bob@other-org.ru");
  await pb.goto("/payments");
  const txtB = norm(await pb.locator("main").innerText());
  console.log("Bob видит аукционы:", txtB.match(/(СП 09-26|B-AUC|Закупка меха|FH 06-26)/g));
  console.log("Bob: стоимость аукционов:", txtB.match(/Стоимость аукционов, с НДС ([\d  ,]+ ₽)/)?.[1]);
  await pb.goto(aucUrl("Закупка меха 04-26"));
  console.log("Bob открыл аукцион org A:", /не найден/.test(norm(await pb.locator("main").innerText())));
  await pb.goto(aucUrl(SP));
  console.log("Bob на СП 09-26 (его org):", norm(await pb.locator(`a[href="${aucUrl(SP)}"]`).first().innerText()).slice(0, 140));
  console.log("Bob видит 'A-secret'/4242:", /A-secret|4 242/.test(norm(await pb.locator("main").innerText())));
  // прямые вызовы
  const r1 = await callAction(pb, IDS.update, [payA, "$K1"], payFields({ amount: "1", notes: "HACK" }));
  const r2 = await callAction(pb, IDS.del, [payA]);
  const r3 = await callAction(pb, IDS.create, ["Закупка меха 04-26", "$K1"], payFields({ notes: "HACK-create-A-auction" }));
  const r4 = await callAction(pb, IDS.create, [SP, "$K1"], payFields({ notes: "HACK-supplierA", supplierId: supA }));
  const r5 = await callAction(pb, IDS.advance, ["$K1"], { supplierId: supA, amount: "7", method: "CASH", paidAt: "2026-10-01" });
  const r6 = await callAction(pb, IDS.addPurchasePay, [purA, "$K1"], { amount: "9", method: "CASH", paidAt: "2026-10-01", notes: "HACK-purchase" });
  const r7 = await callAction(pb, IDS.docDelete, [purA, docA]);
  const r8 = await callAction(pb, IDS.docUpdate, [docA, "$K1"], { title: "HACK", kind: "OTHER" });
  const r9 = await callAction(pb, IDS.docReplace, [docA, "$K1"], {}, { name: "h.pdf", path: `${FIX}/ok.pdf` });
  console.log("update A pay:", r1.text.slice(0, 100), "| delete A pay:", r2.text.slice(0, 100));
  console.log("create in A auction:", r3.text.slice(0, 100));
  console.log("create supplier A in own:", r4.text.slice(0, 100));
  console.log("advance supplier A:", r5.status, r5.text.slice(0, 80), "| purchase pay A:", r6.text.slice(0, 80));
  console.log("doc delete/update/replace:", r7.text.slice(0, 60), "|", r8.text.slice(0, 60), "|", r9.text.slice(0, 80));
  console.log("org A snapshot before/after:", snapA, "|", sql(`select count(*), coalesce(sum(amount),0) from "Payment" where "organizationId"='${ORG}'`));
  console.log("A pay intact:", sql(`select amount,notes,"documentId" is not null from "Payment" where id='${payA}'`), "doc:", sql(`select title,kind,"originalName" from "PurchaseDocument" where id='${docA}'`), "disk", filesOnDisk());
  console.log("HACK rows:", sql(`select "organizationId",notes,"supplierId",amount from "Payment" where notes like 'HACK%'`));
  // скачивание документов через границу организаций
  const g1 = await pb.request.get(`/api/purchase-docs/${docA}`);
  console.log("Bob GET doc A:", g1.status());
  const g2 = await pa.request.get(`/api/purchase-docs/${docA}`);
  console.log("Anna GET doc A:", g2.status());
  const g3 = await pb.request.get(`/api/purchase-docs/${docA}?download=1`, { headers: {} });
  console.log("Bob GET download:", g3.status());
  // Bob создаёт в своём аукционе с документом; Анна пробует получить его
  await pb.goto(aucUrl(SP));
  await addPayment(pb, { amount: "50", notes: "B-own", file: `${FIX}/ok.pdf` });
  await submitAdd(pb);
  await pb.waitForTimeout(1200);
  const docB = sql(`select "documentId" from "Payment" where notes='B-own'`);
  console.log("Bob свою оплату создал:", !!docB, "org:", sql(`select "organizationId" from "Payment" where notes='B-own'`), "Anna GET doc B:", (await pa.request.get(`/api/purchase-docs/${docB}`)).status());
  // Анна: правка/удаление оплаты Bob
  const q1 = await callAction(pa, IDS.update, [sql(`select id from "Payment" where notes='B-own'`), "$K1"], payFields({ notes: "HACK-A" }));
  const q2 = await callAction(pa, IDS.del, [sql(`select id from "Payment" where notes='B-own'`)]);
  console.log("Anna -> pay B:", q1.text.slice(0, 80), "|", q2.text.slice(0, 80), "still:", sql(`select notes from "Payment" where "organizationId"='org_b'`));
  // Сводка Анны не учла платёж Bob
  await pa.goto(aucUrl(SP));
  console.log("Anna card:", norm(await pa.locator(`a[href="${aucUrl(SP)}"]`).first().innerText()).slice(0, 170));
  await expectNoErr(eb);
  sql(`delete from "Payment" where "organizationId"='org_b'; delete from "PurchaseDocument" where "organizationId"='org_b'`);
  await ca.close(); await cb.close();
});

test("6c. серверная валидация (прямые вызовы без клиентских проверок)", async ({ page }) => {
  cleanTest();
  sql(`delete from "Purchase" where id='t_cancel'`);
  await loginAs(page, "anna@qa-test.ru");
  const spP = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' limit 1`);
  pay("t_pp", { purchase: spP, amount: 1234 });
  const base = payFields();
  const tests: [string, Record<string, string>][] = [
    ["kind=HACK", { kind: "HACK" }], ["status=CANCELLED", { status: "CANCELLED" }], ["method=BTC", { method: "BTC" }],
    ["paidAt=2026-02-30", { paidAt: "2026-02-30" }], ["paidAt=1800-01-01", { paidAt: "1800-01-01" }], ["paidAt=''", { paidAt: "" }],
    ["paidAt=2101-01-01", { paidAt: "2101-01-01" }], ["paidAt=2026-10-01T25:00", { paidAt: "2026-10-01T25:00" }],
    ["notes 1001", { notes: "x".repeat(1001) }], ["mode=percent,percent=94 (ok)", { mode: "percent", percent: "94", amount: "" }],
    ["mode=percent, percent пусто", { mode: "percent", percent: "" }],
    ["amount=NaN", { amount: "NaN" }], ["amount=Infinity", { amount: "Infinity" }], ["amount=+5", { amount: "+5" }], ["amount='5 5'", { amount: "5 5" }],
    ["amount=0.001", { amount: "0.001" }], ["amount=1.005", { amount: "1.005" }], ["amount=٣", { amount: "٣" }],
  ];
  for (const [name, f] of tests) {
    const before = cnt(`"organizationId"='${ORG}'`);
    const r = await callAction(page, IDS.create, [SP, "$K1"], { ...base, confirmOverpay: "", ...f, notes: f.notes ?? "v-" + name });
    const after = cnt(`"organizationId"='${ORG}'`);
    console.log(`[${name}] -> ${r.text.slice(0, 120)} | saved=${after - before}${after > before ? " " + sql(`select amount,percent,to_char("paidAt",'YYYY-MM-DD') from "Payment" where "organizationId"='${ORG}' order by "createdAt" desc limit 1`) : ""}`);
  }
  // перепродукция: подмена auction
  for (const a of ["", "   ", "НЕТ ТАКОГО", SP + "\nвторая строка", SP.toLowerCase()]) {
    const r = await callAction(page, IDS.create, [a, "$K1"], { ...base, notes: "auc:" + JSON.stringify(a) });
    console.log(`auction=${JSON.stringify(a)} ->`, r.text.slice(0, 90));
  }
  // update/delete оплаты закупки через действия аукциона
  const u = await callAction(page, IDS.update, ["t_pp", "$K1"], payFields({ amount: "1" }));
  const d = await callAction(page, IDS.del, ["t_pp"]);
  console.log("update purchase-pay via auction action:", u.text.slice(0, 80), "| delete:", d.text.slice(0, 80), "| still:", sql(`select amount from "Payment" where id='t_pp'`));
  // два файла / не-файл в поле file
  const big = await callAction(page, IDS.create, [SP, "$K1"], payFields({ notes: "bigfile" }), { name: "big.pdf", path: `${FIX}/big.pdf` });
  console.log("26.2MB direct:", big.status, big.text.slice(0, 150), "saved", cnt(`notes='bigfile'`));
  const big2 = await callAction(page, IDS.create, [SP, "$K1"], payFields({ notes: "big30" }), { name: "big.pdf", path: `${FIX}/big30.pdf` }).catch((e) => ({ status: -1, text: String(e).slice(0, 100) }));
  console.log("30MB direct:", big2.status, big2.text.slice(0, 150), "saved", cnt(`notes='big30'`), "disk", filesOnDisk());
});

test("7a. мобильный вид 375px: список, аукцион, формы, правка; переполнение по ширине", async ({ browser }) => {
  cleanTest();
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  autoConfirm(page, true);
  pay("t_m1", { auction: SP, amount: 20_000_000, notes: "mob", kind: "ADVANCE" });
  pay("t_m2", { auction: SP, amount: 2_000_000, notes: "mob-plan", status: "PENDING", paidAt: "2026-09-01", kind: "PARTIAL" });
  await loginAs(page, "anna@qa-test.ru");
  const overflow = async (tag: string) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, wide: Array.from(document.querySelectorAll("*")).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((e) => e.tagName + "." + String(e.className).slice(0, 60)) }));
    console.log(`[${tag}] scrollWidth=${o.sw} innerWidth=${o.iw} wide:`, o.wide);
  };
  await page.goto("/payments");
  await overflow("list");
  await page.screenshot({ path: "/tmp/fur-e2e/shots/7a-list.png", fullPage: false });
  await page.goto(aucUrl(SP));
  await overflow("auction");
  await page.screenshot({ path: "/tmp/fur-e2e/shots/7a-auction.png", fullPage: true });
  const row = page.locator("div.rounded-lg.border.bg-white.p-3").filter({ hasText: "Заметка: mob-plan" });
  await row.getByRole("button", { name: "Править" }).click();
  await overflow("edit-open");
  await page.screenshot({ path: "/tmp/fur-e2e/shots/7a-edit.png", fullPage: true });
  await page.goto("/dashboard");
  await overflow("dashboard");
  await page.screenshot({ path: "/tmp/fur-e2e/shots/7a-dash.png", fullPage: true });
  // тап-цели кнопок
  await page.goto(aucUrl(SP));
  const sizes = await page.evaluate(() => Array.from(document.querySelectorAll("button, a")).filter((e) => /Править|Удалить|Скачать|Открыть|Добавить оплату/.test(e.textContent || "")).slice(0, 8).map((e) => `${(e.textContent || "").trim()}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
  console.log("tap targets:", sizes);
  await expectNoErr(errors);
  await ctx.close();
});

test("7b. режимы НДС: суммы оплат не зависят от переключателя", async ({ browser }) => {
  const res: Record<string, any> = {};
  for (const mode of ["incl", "excl"]) {
    const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
    await ctx.addCookies([{ name: "vatDisplay", value: mode, url: BASE }]);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await loginAs(page, "anna@qa-test.ru");
    await page.goto(aucUrl(SP));
    const card = norm(await page.locator(`a[href="${aucUrl(SP)}"]`).first().innerText());
    const top = norm((await page.locator("main").innerText())).match(/Стоимость аукционов, с НДС [\d  ,]+ ₽/)?.[0];
    await page.goto("/dashboard");
    const dash = norm(await page.locator("main").innerText()).match(/Долг поставщикам[^₽]*₽/g)?.slice(0, 2);
    const sp1 = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' and id not like 't\\_%' limit 1`);
    await page.goto(`/purchases/${sp1}`);
    const pu = norm(await page.locator("main").innerText());
    res[mode] = { card, top, dash, purchaseLine: pu.match(/Оплаты Веллмех[^.]*\./)?.[0], summary: pu.match(/Итого \(RUB\)[^А-Я]*/)?.[0], rest: pu.match(/Остаток к оплате[^А-Я]*/)?.[0], errors };
    await ctx.close();
  }
  console.log(JSON.stringify(res, null, 1));
});

test("2i. правка оплаты: % -> пересчёт суммы при изменении стоимости/округления", async ({ page }) => {
  cleanTest();
  const errors = watchErrors(page);
  const dialogs = autoConfirm(page, true);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(aucUrl(SP));
  await addPayment(page, { percent: "33,3333", notes: "pct" });
  await submitAdd(page);
  await page.waitForTimeout(1200);
  const before = sql(`select amount,percent from "Payment" where notes='pct'`);
  // правим только заметку
  await page.goto(aucUrl(SP));
  const row = page.locator("div.rounded-lg.border.bg-white.p-3").filter({ hasText: "Заметка: pct" });
  await row.getByRole("button", { name: "Править" }).click();
  console.log("форма правки: amount=", await row.locator("input[name=amount]").inputValue(), "percent=", await row.locator("input[name=percent]").inputValue());
  await row.locator("input[name=notes]").fill("pct-edited");
  await row.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(1200);
  const after = sql(`select amount,percent from "Payment" where notes='pct-edited'`);
  console.log("только заметка: до", before, "после", after);
  // меняем стоимость аукциона (правка цены позиции в закупке) и снова правим только заметку
  const amtBefore = Number(after.split("|")[0]);
  sql(`update "PurchaseItem" set "costPlan"=jsonb_set("costPlan",'{unitCostInclVat}', to_jsonb((("costPlan"->>'unitCostInclVat')::numeric*1.01)::text)) where "purchaseId"=(select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' order by number limit 1)`);
  await page.goto(aucUrl(SP));
  console.log("новая стоимость аукциона:", norm(await page.locator("text=Полная стоимость, с НДС").locator("xpath=..").innerText()));
  const row2 = page.locator("div.rounded-lg.border.bg-white.p-3").filter({ hasText: "Заметка: pct-edited" });
  console.log("в истории сумма до правки:", norm(await row2.innerText()).slice(0, 80));
  await row2.getByRole("button", { name: "Править" }).click();
  await row2.locator("input[name=notes]").fill("pct-edited2");
  await row2.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(1200);
  console.log("после смены стоимости и правки заметки: сумма", amtBefore, "->", sql(`select amount,percent from "Payment" where notes='pct-edited2'`));
  console.log("dialogs", dialogs);
  // вернуть
  sql(`update "PurchaseItem" set "costPlan"=jsonb_set("costPlan",'{unitCostInclVat}', to_jsonb((("costPlan"->>'unitCostInclVat')::numeric/1.01)::text)) where "purchaseId"=(select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' order by number limit 1)`);
  await expectNoErr(errors);
});

test("2j. дебаг: актуальность стоимости на странице после правки позиций", async ({ page }) => {
  await loginAs(page, "anna@qa-test.ru");
  const idp = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' order by number limit 1`);
  const show = async (t: string) => { await page.goto(aucUrl(SP)); console.log(t, norm(await page.locator("main").innerText()).match(/Полная стоимость, с НДС ([\d  ,]+ ₽)/)?.[1], "| карточка:", norm(await page.locator(`a[href="${aucUrl(SP)}"]`).first().innerText()).match(/Стоимость ([\d  ,]+ ₽)/)?.[1], "sql", sqlTotals()[SP].total); };
  await show("до");
  sql(`update "PurchaseItem" set "costPlan"=jsonb_set("costPlan",'{unitCostInclVat}', to_jsonb((("costPlan"->>'unitCostInclVat')::numeric*1.01)::text)) where "purchaseId"='${idp}'`);
  await show("после +1%");
  await page.waitForTimeout(1500);
  await show("через 1.5с");
  sql(`update "PurchaseItem" set "costPlan"=jsonb_set("costPlan",'{unitCostInclVat}', to_jsonb((("costPlan"->>'unitCostInclVat')::numeric/1.01)::text)) where "purchaseId"='${idp}'`);
  await show("вернули");
});

test("2k. дебаг 2", async ({ page }) => {
  await loginAs(page, "anna@qa-test.ru");
  const idp = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' order by number limit 1`);
  const bump = (f: number) => sql(`update "PurchaseItem" set "costPlan"=jsonb_set("costPlan",'{unitCostInclVat}', to_jsonb((("costPlan"->>'unitCostInclVat')::numeric*${f})::text)) where "purchaseId"='${idp}'`);
  const card = async () => { await page.goto("/payments"); return norm(await page.locator(`a[href="${aucUrl(SP)}"]`).first().innerText()).match(/Стоимость ([\d  ,]+ ₽)/)?.[1]; };
  const dash = async () => (await dashDebt(page)).kpi;
  console.log("до", await card(), await dash());
  bump(1.01);
  console.log("после", await card(), await dash(), sqlTotals()[SP].total);
  bump(1 / 1.01);
  console.log("вернули", await card(), await dash());
});

test("2l. правка: переплата с confirm, отмена, платёж ровно на всю стоимость", async ({ page }) => {
  cleanTest();
  const errors = watchErrors(page);
  let accept = false;
  const msgs: string[] = [];
  page.on("dialog", async (d) => { msgs.push(d.message()); accept ? await d.accept() : await d.dismiss(); });
  await loginAs(page, "anna@qa-test.ru");
  const total = sqlTotals()[SP].total;
  pay("t_e1", { auction: SP, amount: total - 1000, notes: "E1", kind: "ADVANCE" });
  pay("t_e2", { auction: SP, amount: 1000, notes: "E2", kind: "FINAL" });
  await page.goto("/payments?auction=" + encodeURIComponent(SP));
  const edit = async (note: string, fill: (r: any) => Promise<void>) => {
    const row = page.locator("div.rounded-lg.border.bg-white.p-3").filter({ hasText: "Заметка: " + note });
    await row.getByRole("button", { name: "Править" }).click();
    await fill(row);
    await row.getByRole("button", { name: "Сохранить" }).click();
    await page.waitForTimeout(1300);
  };
  // без изменений суммы: ровно total — без confirm
  await edit("E2", async (r) => { await r.locator("input[name=notes]").fill("E2b"); });
  console.log("правка заметки у платежа, заполняющего 100%: диалоги", msgs.splice(0), sql(`select amount,notes from "Payment" where id='t_e2'`));
  // увеличить до 5000: confirm, отказ
  await edit("E2b", async (r) => { await r.locator("input[name=amount]").fill("5000"); });
  console.log("увеличили до 5000, отказ:", msgs.splice(0), sql(`select amount from "Payment" where id='t_e2'`));
  // подтверждаем
  await page.reload();
  accept = true;
  await edit("E2b", async (r) => { await r.locator("input[name=amount]").fill("5000"); });
  console.log("подтвердили:", msgs.splice(0), sql(`select amount from "Payment" where id='t_e2'`));
  // планируемая -> оплачено при переплате
  pay("t_e3", { auction: SP, amount: 10, status: "PENDING", notes: "E3", paidAt: "2026-08-01" });
  await page.reload();
  await edit("E3", async (r) => { await r.locator("select[name=status]").selectOption("COMPLETED"); });
  console.log("PENDING->COMPLETED при переплате:", msgs.splice(0), sql(`select status from "Payment" where id='t_e3'`));
  // правка с некорректными данными
  await page.reload();
  accept = true;
  await edit("E3", async (r) => { await r.locator("input[name=amount]").fill("-1"); });
  console.log("amount=-1:", await formErr(page), sql(`select amount from "Payment" where id='t_e3'`));
  await page.reload();
  await edit("E3", async (r) => { await r.locator("input[name=paidAt]").fill(""); });
  console.log("paidAt пусто (клиент required):", await formErr(page));
  await expectNoErr(errors);
});

test("3b. оплата прямо в закупку аукциона: нет проверки переплаты по аукциону", async ({ page }) => {
  cleanTest();
  await loginAs(page, "anna@qa-test.ru");
  const total = sqlTotals()[SP].total;
  pay("t_f1", { auction: SP, amount: total - 100, notes: "почти всё" });
  const sp1 = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' order by number limit 1`);
  const msgs = autoConfirm(page, true);
  await page.goto(`/purchases/${sp1}`);
  // UI: форма оплаты на закупке
  const form = page.locator("form:has(input[name=amount]):has(button:has-text('оплат'))").first();
  console.log("форма оплаты в закупке найдена:", await form.count());
  const r = await callAction(page, IDS.addPurchasePay, [sp1, "$K1"], { amount: "5000000", method: "BANK_TRANSFER", paidAt: "2026-10-01", notes: "purchase-overpay" });
  console.log("оплата закупки 5 000 000 при остатке аукциона 100 ₽:", r.text.slice(0, 100), "dialogs", msgs, "saved", cnt(`notes='purchase-overpay'`));
  await page.goto("/payments?auction=" + encodeURIComponent(SP));
  console.log(norm(await page.locator(`a[href="${aucUrl(SP)}"]`).first().innerText()));
  // оплата отменённой закупке
  sql(`delete from "Purchase" where id='t_cancel'`);
});

test("3c. отменённые закупки: аукцион только из отменённых; отмена одной закупки при оплатах", async ({ page }) => {
  cleanTest();
  sql(`delete from "Purchase" where id in ('t_cancel','t_only_c')`);
  const errors = watchErrors(page);
  autoConfirm(page, true);
  await loginAs(page, "anna@qa-test.ru");
  sql(`insert into "Purchase"(id,"organizationId",number,"supplierId","warehouseId",status,currency,"exchangeRate","auctionSession","updatedAt") values ('t_only_c','${ORG}','ТЕСТ-ОТМ2','${SUPPLIER}','${WH()}','CANCELLED','RUB',1,'ТЕСТ-ОТМЕНА',now())`);
  sql(`insert into "PurchaseItem"(id,"purchaseId","rawMaterialId",quantity,"unitPrice",subtotal,"vatRate") select 't_only_ci','t_only_c',"rawMaterialId",1,1000,1000,20 from "PurchaseItem" limit 1`);
  pay("t_oc1", { auction: "ТЕСТ-ОТМЕНА", amount: 1000, notes: "oc" });
  pay("t_oc2", { purchase: "t_only_c", amount: 500, notes: "ocp" });
  await page.goto("/payments");
  const card = page.locator(`a[href="${aucUrl("ТЕСТ-ОТМЕНА")}"]`).first();
  console.log("карточка аукциона из отменённых:", (await card.count()) ? norm(await card.innerText()) : "НЕТ КАРТОЧКИ");
  await page.goto("/payments?auction=" + encodeURIComponent("ТЕСТ-ОТМЕНА"));
  const txt = norm(await page.locator("main").innerText());
  console.log("блок:", txt.match(/Аукцион: ТЕСТ-ОТМЕНА.{0,500}/)?.[0]);
  console.log("форма добавления есть:", await page.locator("form:has(button:text-is('Добавить оплату'))").count(), "| текст про отсутствие закупок:", /нет действующих|Закупок: 0/.test(txt));
  console.log("кнопки Править/Удалить:", await page.getByRole("button", { name: "Править" }).count(), await page.getByRole("button", { name: "Удалить" }).count());
  await page.screenshot({ path: "/tmp/fur-e2e/shots/3c-cancelled.png", fullPage: true });
  console.log("дашборд: аукцион в долгах:", (await dashDebt(page)).rows.some((r) => r.startsWith("ТЕСТ-ОТМЕНА")));
  await expectNoErr(errors);
  sql(`delete from "Payment" where "auctionSession"='ТЕСТ-ОТМЕНА' or "purchaseId"='t_only_c'; delete from "Purchase" where id='t_only_c'`);
});

test("7c. устойчивость страницы к странным параметрам; формулировки; Bob", async ({ browser }) => {
  cleanTest();
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  const urls = ["/payments?auction=%00", "/payments?auction=" + "a".repeat(5000), "/payments?auction=%3Cscript%3Ealert(1)%3C/script%3E", "/payments?auction=' OR 1=1 --", "/payments?auction=сп 09-26", "/payments?auction=СП%2009-26%0A", "/payments?error=%3Cb%3Eboom%3C/b%3E", "/payments?tab=clients&auction=x", "/payments?auction=a&auction=b", "/payments?tab=garbage"];
  for (const u of urls) {
    const r = await page.goto(u);
    const t = norm(await page.locator("main").innerText());
    console.log(u.slice(0, 60), "->", r?.status(), t.match(/не найден[^.]*\./)?.[0]?.slice(0, 60) ?? "", t.includes("boom") ? "[flash: " + (await page.locator("p.bg-red-50").innerHTML()) + "]" : "");
  }
  // текст страницы: ищем «платим аукциону» и подобные
  await page.goto(aucUrl(SP));
  const all = norm(await page.locator("body").innerText());
  console.log("упоминания 'аукцион' рядом с оплатой/платить:", all.match(/.{40}(плат[а-я]+ аукцион[а-я]*|аукцион[а-я]* плат[а-я]+).{40}/gi));
  // Bob: текст
  const cb = await browser.newContext({ baseURL: BASE, locale: "ru-RU" });
  const pb = await cb.newPage();
  await loginAs(pb, "bob@other-org.ru");
  await pb.goto(aucUrl("B-AUC"));
  const bt = norm(await pb.locator("main").innerText());
  console.log("Bob (поставщик 'Supplier B') видит «Веллмех» в тексте:", /Веллмех/.test(bt), "|", bt.match(/.{30}Веллмех.{30}/g)?.slice(0, 3));
  await expectNoErr(errors);
  await ctx.close(); await cb.close();
});

test("2m. аванс без аукциона (форма «Без аукциона»)", async ({ page }) => {
  cleanTest();
  const errors = watchErrors(page);
  const msgs = autoConfirm(page, true);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto("/payments");
  const f = page.locator("form:has(button:text-is('Добавить платёж'))");
  await f.locator("select[name=supplierId]").selectOption(SUPPLIER);
  await f.locator("input[name=amount]").fill("0");
  await f.getByRole("button", { name: "Добавить платёж" }).click();
  await page.waitForTimeout(1000);
  console.log("amount=0:", page.url(), norm(await page.locator("p.bg-red-50").allInnerTexts().then((a) => a.join("|"))));
  await page.goto("/payments");
  await f.locator("select[name=supplierId]").selectOption(SUPPLIER);
  await f.locator("input[name=amount]").fill("123.45");
  await f.locator("input[name=paidAt]").fill("2027-01-01");
  await f.getByRole("button", { name: "Добавить платёж" }).click();
  await page.waitForTimeout(1200);
  console.log("123.456 будущая дата:", page.url(), msgs, sql(`select amount,status,kind,to_char("paidAt",'YYYY-MM-DD') from "Payment" where "auctionSession" is null and "purchaseId" is null`));
  console.log("в списке «Без аукциона»:", norm(await page.locator("div.grid.rounded-lg").allInnerTexts().then((a) => a.join(" || "))).slice(0, 200));
  await expectNoErr(errors);
});

test("7d. мобильная форма: добавление оплаты 94% с файлом и «Остаток»", async ({ browser }) => {
  cleanTest();
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  const msgs = autoConfirm(page, true);
  await loginAs(page, "anna@qa-test.ru");
  await page.goto("/payments?auction=" + encodeURIComponent(SP));
  const form = page.locator("form:has(button:text-is('Добавить оплату'))");
  await form.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/fur-e2e/shots/7d-form.png" });
  await addPayment(page, { percent: "94", file: `${FIX}/ok.jpg`, notes: "m94" });
  await form.getByRole("button", { name: "Добавить оплату" }).tap();
  await page.waitForTimeout(1500);
  await addPayment(page, { kind: "FINAL", fill: "Остаток", notes: "mfinal" });
  await page.screenshot({ path: "/tmp/fur-e2e/shots/7d-final.png" });
  await form.getByRole("button", { name: "Добавить оплату" }).tap();
  await page.waitForTimeout(1500);
  console.log(payRows(), msgs);
  const o = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log("scrollWidth", o);
  await page.screenshot({ path: "/tmp/fur-e2e/shots/7d-after.png", fullPage: true });
  await expectNoErr(errors);
  await ctx.close();
});

test("1b. сверка итогов /lots?auction=СП 09-26 с /payments", async ({ page }) => {
  cleanTest();
  const errors = watchErrors(page);
  await loginAs(page, "anna@qa-test.ru");
  for (const mode of ["incl", "excl"]) {
    await page.context().addCookies([{ name: "vatDisplay", value: mode, url: BASE }]);
    await page.goto(`/lots?auction=${encodeURIComponent(SP)}`);
    const t = norm(await page.locator("main").innerText());
    console.log(mode, "lots:", t.match(/.{0,60}(Итого|Оплат|Остаток|стоимость|Стоимость)[^.]{0,120}/g)?.slice(0, 8));
  }
  await page.context().addCookies([{ name: "vatDisplay", value: "incl", url: BASE }]);
  await expectNoErr(errors);
});

test("1c. /lots показывает оплату: COMPLETED, без PENDING", async ({ page }) => {
  cleanTest();
  pay("t_l1", { auction: SP, amount: 10_000_000 });
  pay("t_l2", { auction: SP, amount: 3_000_000, status: "PENDING" });
  await loginAs(page, "anna@qa-test.ru");
  await page.goto(`/lots?auction=${encodeURIComponent(SP)}`);
  const t = norm(await page.locator("main").innerText());
  const i = t.indexOf("Оплачено поставщику"); console.log(t.slice(i, i + 200));
});
