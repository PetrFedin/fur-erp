import { test, expect, type Page, type Browser } from "@playwright/test";
import { execSync } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import { login } from "./helpers";

// ФАЗА A: итоговая проверка адаптива, чисел, прав и цены изделия. Стенд: scripts/e2e.sh up fin 3321.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3321";
const SHOTS = "/private/tmp/claude-501/-Users-petr-Documents-claude/08bd0e6a-136a-45f3-83ae-5c2dff1283f5/scratchpad/shots";
const OUT = "/tmp/fur-e2e/final-audit.jsonl";
export function sql(q: string): string {
  return execSync(`docker exec -i fur-erp-db-1 psql -U fur_erp -d fur_erp_e2e_fin -At -F '|' -v ON_ERROR_STOP=1`, { encoding: "utf8", input: q }).trim();
}
const log = (o: unknown) => appendFileSync(OUT, JSON.stringify(o) + "\n");

const PAGES: { name: string; url: string }[] = [
  { name: "dashboard", url: "/dashboard" },
  { name: "purchases", url: "/purchases" },
  { name: "purchase1", url: "/purchases/cmupc47zx0005ls7y21zjhric" },
  { name: "purchase2", url: "/purchases/cmupc480j000fls7y1gqe2l9y" },
  { name: "purchase3", url: "/purchases/cmupc482m005nls7yzojwsw4p" },
  { name: "production", url: "/production" },
  { name: "tz1", url: "/production/cmupc48gq01e9ls7y9leydosw" },
  { name: "tz88", url: "/production/cmupc48xo02m3ls7ygetrmfgx" },
  { name: "tz156", url: "/production/cmupc499e03k1ls7yt9xrtm80" },
  { name: "batches", url: "/production/batches" },
  { name: "batch1", url: "/production/batches/1" },
  { name: "batch5", url: "/production/batches/5" },
  { name: "lots-fur", url: "/lots" },
  { name: "lots-lining", url: "/lots?tab=lining" },
  { name: "lots-summary", url: "/lots?tab=summary" },
  { name: "lots-auc-inv", url: "/lots?auction=" + encodeURIComponent("СП 09-26") },
  { name: "lots-auc-lots", url: "/lots?auction=" + encodeURIComponent("СП 09-26") + "&view=lots" },
  { name: "payments", url: "/payments" },
  { name: "payments-clients", url: "/payments?tab=clients" },
  { name: "payments-auc", url: "/payments?auction=" + encodeURIComponent("СП 09-26") + "#auction-block" },
  { name: "articles", url: "/articles" },
  { name: "supply-plan", url: "/supply-plan" },
  { name: "settings-supply-plan", url: "/settings/supply-plan" },
  { name: "attention", url: "/attention" },
  { name: "raw-materials", url: "/raw-materials" },
];

async function audit(page: Page, vp: string, p: { name: string; url: string }) {
  const errors: string[] = [];
  const onC = (m: import("@playwright/test").ConsoleMessage) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text().slice(0, 250)}`); };
  const onE = (e: Error) => errors.push("pageerror: " + e.message.slice(0, 250));
  page.on("console", onC); page.on("pageerror", onE);
  const t0 = Date.now();
  const resp = await page.goto(p.url, { waitUntil: "load" });
  const tLoad = Date.now() - t0;
  await page.waitForLoadState("networkidle").catch(() => {});
  const tIdle = Date.now() - t0;
  const info = await page.evaluate(() => {
    const de = document.documentElement;
    const vw = window.innerWidth;
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const ids: Record<string, number> = {};
    document.querySelectorAll("[id]").forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
    const dups = Object.entries(ids).filter(([, n]) => n > 1).map(([k, n]) => `${k}x${n}`);
    const scrollers: string[] = [];
    document.querySelectorAll("*").forEach((e) => {
      const cs = getComputedStyle(e);
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && e.scrollWidth > e.clientWidth + 1 && visible(e)) scrollers.push(`${e.tagName}.${(e.className + "").slice(0, 50)} sw=${e.scrollWidth} cw=${e.clientWidth}`);
    });
    const text = document.body.innerText;
    const bad = [...text.matchAll(/(NaN|undefined|\[object|Infinity|null\b)/g)].map((m) => text.slice(Math.max(0, m.index! - 25), m.index! + 20).replace(/\n/g, " "));
    // элементы, торчащие за правый край (вне скролл-контейнеров не определяем — просто счётчик)
    let over = 0; const overEx: string[] = [];
    document.querySelectorAll("body *").forEach((e) => {
      if (!visible(e)) return;
      const r = e.getBoundingClientRect();
      if (r.right > vw + 1) { // исключаем потомков скролл-контейнеров
        let a: Element | null = e.parentElement, inScroll = false;
        while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { inScroll = true; break; } a = a.parentElement; }
        if (!inScroll) { over++; if (overEx.length < 3) overEx.push(`${e.tagName}.${(e.className + "").slice(0, 40)} right=${Math.round(r.right)}`); }
      }
    });
    return { vw, sw: de.scrollWidth, cw: de.clientWidth, bsw: document.body.scrollWidth, dups, scrollers: scrollers.slice(0, 6), bad: bad.slice(0, 5), over, overEx, title: document.title, h1: document.querySelector("h1")?.textContent };
  });
  page.off("console", onC); page.off("pageerror", onE);
  const rec = { vp, name: p.name, status: resp?.status(), tLoad, tIdle, ...info, hscroll: info.sw > info.cw + 1 || info.bsw > info.cw + 1, errors: errors.slice(0, 6) };
  log(rec);
  return rec;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => writeFileSync(OUT, ""));

for (const vp of ["desktop", "mobile"] as const) {
  test(`audit ${vp}`, async ({ browser }) => {
    test.setTimeout(600_000);
    const ctx = await browser.newContext(vp === "mobile"
      ? { baseURL: BASE, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "ru-RU", deviceScaleFactor: 2 }
      : { baseURL: BASE, viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    const page = await ctx.newPage();
    await login(page);
    for (const p of PAGES) {
      const r = await audit(page, vp, p);
      if (["dashboard", "purchases", "tz88", "batches", "lots-fur", "lots-auc-inv", "lots-auc-lots", "payments", "articles", "supply-plan", "attention", "lots-summary", "purchase1"].includes(p.name)) {
        await page.screenshot({ path: `${SHOTS}/${vp}-${p.name}.png`, fullPage: false });
      }
      console.log(vp, p.name, r.status, r.tLoad, r.tIdle, r.hscroll ? "HSCROLL" : "", r.dups.length ? "DUPS " + r.dups : "", r.bad.length ? "BAD " + r.bad.join("|") : "", r.errors.length ? "ERR " + r.errors.join("|") : "");
    }
    await ctx.close();
  });
}

// ---------- Карточка против таблицы: числа первых 5 строк ----------
const CMP_PAGES = ["purchases", "production", "batches", "lots-fur", "lots-lining", "lots-auc-inv", "lots-auc-lots", "payments", "payments-clients", "articles", "attention", "raw-materials", "dashboard", "lots-summary", "supply-plan", "tz88", "purchase2", "batch5"];
test("карточки против таблиц", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await login(page);
  for (const name of CMP_PAGES) {
    const p = PAGES.find((x) => x.name === name)!;
    await page.goto(p.url); await page.waitForLoadState("networkidle");
    const res = await page.evaluate(() => {
      const norm = (s: string) => s.replace(/(?<=\d)[   ](?=\d{3}(?!\d))/g, "").replace(/−/g, "-");
      const toks = (s: string) => norm(s).match(/\d+(?:[.,]\d+)?/g) ?? [];
      const out: { pair: number; rowsT: number; rowsC: number; diffs: string[]; sample?: string }[] = [];
      let i = 0;
      document.querySelectorAll("div.hidden").forEach((tb) => {
        if (!tb.className.includes("md:block")) return;
        const cards = tb.nextElementSibling;
        if (!cards || !cards.className.includes("md:hidden")) return;
        const rows = [...tb.querySelectorAll("tbody tr")];
        const cs = [...cards.children];
        const diffs: string[] = [];
        for (let r = 0; r < (rows.length === cs.length ? Math.min(5, rows.length) : 0); r++) {
          const spaced = (el: Element) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let o = ""; let n: Node | null; while ((n = w.nextNode())) o += (n.textContent ?? "") + " "; return o; };
          const tt = toks(spaced(rows[r])).filter((t) => t.length >= 2); const ct = new Set(toks(spaced(cs[r])));
          const miss = tt.filter((t) => !ct.has(t));
          if (miss.length) diffs.push(`row${r}: нет в карточке [${miss.join(",")}] | таблица: ${spaced(rows[r]).replace(/\s+/g, " ").slice(0, 140)} | карточка: ${spaced(cs[r]).replace(/\s+/g, " ").slice(0, 200)}`);
        }
        out.push({ pair: i++, rowsT: rows.length, rowsC: cs.length, diffs, sample: (cs[0]?.textContent ?? "").replace(/\s+/g, " ").slice(0, 140) });
      });
      return out;
    });
    console.log("CMP", name, JSON.stringify(res, null, 1));
  }
  await ctx.close();
});

// ---------- Цена изделия: только PLANNED / IN_PROGRESS ----------
const snap = (id: string) => sql(`select status||':'||count(*)||':'||coalesce(string_agg(distinct "retailPrice"::text, ','),'-') from "ProductionOrder" where "productModelId"='${id}' group by status order by status`);
const MODEL_A = "cmupc48id01inls7yfqgtd1rs"; // 2 IN_PROGRESS + 8 COMPLETED
const MODEL_B = "cmupc48x402kvls7y3sqdvto1"; // 2 PLANNED + 4 COMPLETED
test("цена изделия: Enter и blur, desktop и mobile", async ({ browser }) => {
  test.setTimeout(180_000);
  for (const mobile of [false, true]) {
    const ctx = await browser.newContext(mobile ? { baseURL: BASE, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "ru-RU" } : { baseURL: BASE, viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    const page = await ctx.newPage();
    const errs: string[] = []; page.on("pageerror", (e) => errs.push(e.message));
    const dialogs: string[] = []; page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept(); });
    await login(page);
    await page.goto("/articles"); await page.waitForLoadState("networkidle");
    const pre = [snap(MODEL_A), snap(MODEL_B)];
    console.log("PRICE pre", mobile, JSON.stringify(pre));
    const sel = (id: string) => mobile ? `#price-m-${id} input` : `#price-${id} input`;
    // A: Enter
    const a = page.locator(sel(MODEL_A));
    const aVal = mobile ? "2111111.5" : "2222222";
    await a.fill(aVal); await a.press("Enter"); await page.waitForTimeout(1200);
    console.log("PRICE A after Enter", mobile, snap(MODEL_A), "| sellingPrice:", sql(`select "sellingPrice" from "ProductModel" where id='${MODEL_A}'`), "dialogs:", dialogs.join(";"));
    // B: blur
    const b = page.locator(sel(MODEL_B));
    await b.fill(mobile ? "333333" : "444444"); await page.locator("h1").first().click(); await page.waitForTimeout(1200);
    console.log("PRICE B after blur", mobile, snap(MODEL_B), "| sellingPrice:", sql(`select "sellingPrice" from "ProductModel" where id='${MODEL_B}'`), "dialogs:", dialogs.join(";"));
    // перезагрузка: значение сохранилось и статус «Задана»
    await page.reload(); await page.waitForLoadState("networkidle");
    console.log("PRICE reload value", mobile, await page.locator(sel(MODEL_A)).inputValue(), await page.locator(`#price${mobile ? "-m" : ""}-${MODEL_A}`).innerText());
    // крайние значения
    for (const bad of ["-5", "0", "", "1e9", "99999999999999"]) {
      await page.locator(sel(MODEL_B)).fill(bad); await page.locator(sel(MODEL_B)).press("Enter"); await page.waitForTimeout(700);
      console.log("PRICE edge", mobile, JSON.stringify(bad), "sellingPrice:", sql(`select "sellingPrice" from "ProductModel" where id='${MODEL_B}'`), snap(MODEL_B), "dialogs:", dialogs.slice(-1).join(";"));
    }
    console.log("PRICE pageerrors", errs.join("|"));
    await ctx.close();
  }
});

// ---------- Роли ----------
const HASH = "$2b$10$4GjnSssJqUQKMd1CV4W48.ElNt4xt63QzGqtRFKhIb6GnMVT89.0G"; // тестовый пароль из фикстур e2e/payments.spec.ts
const ORG = "cmuo7vwvk0000lsu5pghd5jka";
const ROLES: [string, string][] = [["viewer", "VIEWER"], ["wh", "WAREHOUSE"], ["acc", "ACCOUNTANT"], ["purch", "PURCHASER"], ["tech", "TECHNOLOGIST"], ["admin", "ADMIN"]];
const ROLE_PAGES = ["/dashboard", "/purchases", "/purchases/new", "/purchases/cmupc480j000fls7y1gqe2l9y", "/production", "/production/new", "/production/cmupc48xo02m3ls7ygetrmfgx", "/production/batches", "/production/batches/1", "/lots", "/lots?tab=summary", "/lots?auction=" + encodeURIComponent("СП 09-26"), "/payments", "/payments?auction=" + encodeURIComponent("СП 09-26"), "/payments?tab=clients", "/articles", "/supply-plan", "/attention", "/users", "/users/new", "/suppliers/new", "/clients/new", "/warehouses/new", "/materials/new", "/models/new", "/fittings/new", "/shipments/new", "/settings", "/finished-stock", "/models"];
function seedRoles() {
  sql(ROLES.map(([e, r]) => `insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('u_${e}','${ORG}','${e}@qa-test.ru','${HASH}','QA ${e}','${r}',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash","isActive"=true,role=excluded.role`).join(";") + ";");
  sql(`insert into "Organization"(id,name,slug,"updatedAt") values ('org_b','Other Org','other-org',now()) on conflict do nothing`);
  sql(`insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('u_b','org_b','bob@other-org.ru','${HASH}','Bob','OWNER',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash"`);
}
async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill("TestPass123!");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/dashboard/);
}
const CTRL_JS = () => {
  const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
  const out = new Set<string>();
  document.querySelectorAll("main button:not([disabled]), main a[href*='/new'], main input:not([type=hidden]):not([type=search]):not([type=checkbox]):not([type=radio]), main textarea, main select").forEach((e) => {
    if (!vis(e)) return;
    const t = ((e as HTMLElement).innerText || (e as HTMLInputElement).name || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    out.add(e.tagName.toLowerCase() + ":" + t);
  });
  return [...out].sort();
};
test("роли: страницы и кнопки", async ({ browser }) => {
  test.setTimeout(900_000);
  seedRoles();
  const result: Record<string, Record<string, string>> = {};
  for (const [email, role] of [["anna", "OWNER"], ...ROLES.map(([e, r]) => [e, r])]) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    const page = await ctx.newPage();
    await loginAs(page, `${email}@qa-test.ru`);
    result[role] = {};
    for (const u of ROLE_PAGES) {
      const t0 = Date.now();
      const resp = await page.goto(u, { timeout: 20_000 }).catch((e) => { console.log("GOTO-FAIL", role, u, String(e).slice(0, 100)); return null; }); await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      const final = new URL(page.url()); const path = final.pathname + final.search;
      const ctrls = path.startsWith("/login") ? ["LOGIN"] : await page.evaluate(CTRL_JS);
      const redirected = path !== u && decodeURIComponent(path) !== decodeURIComponent(u);
      console.log("ROLE", role, u, Date.now() - t0, "ms");
      result[role][u] = `${resp?.status()}${redirected ? " ->" + path : ""} | ${ctrls.join(" ; ")}`;
    }
    await ctx.close();
    writeFileSync("/tmp/fur-e2e/roles.json", JSON.stringify(result, null, 1));
  }
  writeFileSync("/tmp/fur-e2e/roles.json", JSON.stringify(result, null, 1));
});

test("роли: запрещённые изменения и чужая организация", async ({ browser }) => {
  test.setTimeout(300_000);
  seedRoles();
  sql(`insert into "Supplier"(id,"organizationId",name,"updatedAt") values ('s_b','org_b','Supplier B',now()) on conflict do nothing`);
  sql(`insert into "Warehouse"(id,"organizationId",name) values ('w_b','org_b','WH B') on conflict do nothing`);
  sql(`insert into "RawMaterial"(id,"organizationId",name,"updatedAt") values ('m_b','org_b','Соболь B',now()) on conflict do nothing`);
  sql(`insert into "Purchase"(id,"organizationId",number,"supplierId","warehouseId",currency,"exchangeRate","auctionSession","invoiceNumber","updatedAt") values ('p_b','org_b','Б-1','s_b','w_b','USD',80,'СП 09-26','B1',now()) on conflict do nothing`);
  sql(`insert into "PurchaseItem"(id,"purchaseId","rawMaterialId",quantity,"unitPrice",subtotal,"vatRate","lotNumber") values ('pi_b','p_b','m_b',10,100,1000,20,'B-LOT') on conflict do nothing`);
  const before = sql(`select "sellingPrice" from "ProductModel" where id='${MODEL_B}'`);
  const planBefore = sql(`select count(*) from "SupplyPlanEntry"`);
  for (const [email, role] of [["viewer", "VIEWER"], ["wh", "WAREHOUSE"], ["acc", "ACCOUNTANT"], ["purch", "PURCHASER"]]) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    const page = await ctx.newPage();
    const dialogs: string[] = []; page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept(); });
    await loginAs(page, `${email}@qa-test.ru`);
    await page.goto("/articles"); await page.waitForLoadState("networkidle");
    const inp = page.locator(`#price-${MODEL_B} input`);
    const shown = await inp.count();
    await inp.fill("777777"); await inp.press("Enter"); await page.waitForTimeout(1500);
    console.log("FORBID", role, "articles input shown:", shown, "-> url:", page.url().replace(BASE, ""), "sellingPrice:", sql(`select "sellingPrice" from "ProductModel" where id='${MODEL_B}'`), "was", before, "dialogs:", dialogs.join(";"), "| text:", (await page.locator("[role=alert]").allInnerTexts()).join("|").slice(0, 100));
    await page.goto("/supply-plan"); await page.waitForLoadState("networkidle");
    const formBtn = page.getByRole("button", { name: /Добавить в план/ });
    console.log("FORBID", role, "supply-plan add button shown:", await formBtn.count());
    await ctx.close();
  }
  console.log("FORBID sellingPrice after", sql(`select "sellingPrice" from "ProductModel" where id='${MODEL_B}'`), "plan entries", planBefore, "->", sql(`select count(*) from "SupplyPlanEntry"`));
  // чужая организация
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await loginAs(page, "bob@other-org.ru");
  for (const u of ["/purchases", "/production", "/production/batches", "/lots", "/lots?tab=summary", "/payments", "/payments?auction=" + encodeURIComponent("СП 09-26"), "/articles", "/supply-plan", "/attention", "/dashboard", "/lots?auction=" + encodeURIComponent("СП 09-26")]) {
    await page.goto(u); await page.waitForLoadState("networkidle");
    const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    const leaks = ["Веллмех", "З-2026-00", "П-2026-00", "584", "M001A", "Меркури", "Соболь\t", "219 217"].filter((x) => t.includes(x));
    console.log("ISOL", u, "len", t.length, "leaks:", leaks.join(","), "|", t.slice(0, 160));
  }
  for (const u of ["/purchases/cmupc480j000fls7y1gqe2l9y", "/production/cmupc48xo02m3ls7ygetrmfgx", "/production/batches/1", "/production/batches/5", "/models/cmupc48id01inls7yfqgtd1rs", "/suppliers/s_b", "/warehouses/w_b"]) {
    const r = await page.goto(u);
    console.log("ISOL direct", u, r?.status(), (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 100));
  }
  // его собственные данные видны и считаются только по его организации
  await page.goto("/payments?auction=" + encodeURIComponent("СП 09-26")); await page.waitForLoadState("networkidle");
  console.log("ISOL own auction text:", (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400));
  await ctx.close();
});

// ---------- Лимит файла 25 МБ ----------
test("лимит файла 25 МБ (документы закупки)", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await login(page);
  for (const f of ["ok24.pdf", "exact25.pdf", "over25.pdf", "big27.pdf"]) {
    await page.goto("/purchases/cmupc53a2002blseqy8omnan4"); await page.waitForLoadState("networkidle");
    const form = page.locator("form", { has: page.locator("input[type=file]") }).first();
    await form.locator("input[type=file]").setInputFiles(`/tmp/fur-e2e/fx/${f}`);
    await form.getByRole("button", { name: /Загрузить/ }).click();
    const res = form.locator("p.text-red-600, p.text-emerald-600").first();
    await res.waitFor({ timeout: 60_000 }).catch(() => {});
    console.log("UPLOAD", f, "->", (await res.innerText().catch(() => "нет сообщения")).trim(), "| docs in DB:", sql(`select count(*) from "PurchaseDocument" where "purchaseId"='cmupc53a2002blseqy8omnan4'`));
  }
  await ctx.close();
});

// ---------- Раскрытие «Подробнее» / аккордеонов, затем те же проверки ----------
const EXPAND_PAGES = (process.env.EXP_PAGES ? process.env.EXP_PAGES.split(",") : ["purchases", "purchase2", "production", "tz88", "batches", "batch5", "lots-fur", "lots-lining", "lots-summary", "lots-auc-inv", "lots-auc-lots", "payments", "payments-auc", "articles", "supply-plan", "attention", "dashboard"]);
for (const vp of ["mobile", "desktop"] as const) {
  test(`раскрытие: ${vp}`, async ({ browser }) => {
    test.setTimeout(600_000);
    const ctx = await browser.newContext(vp === "mobile"
      ? { baseURL: BASE, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "ru-RU" }
      : { baseURL: BASE, viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    const page = await ctx.newPage(); page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push("pageerror " + e.message.slice(0, 200)));
    await login(page);
    for (const name of EXPAND_PAGES) {
      const p = PAGES.find((x) => x.name === name)!;
      errors.length = 0;
      await page.goto(p.url); await page.waitForLoadState("networkidle");
      // 1) отдельно проверяем «Подробнее» первой карточки кликом пользователя (только mobile)
      let clickRes = "";
      if (vp === "mobile") {
        const s = page.locator("details > summary", { hasText: "Подробнее" }).filter({ visible: true }).first();
        if (await s.count()) {
          await s.scrollIntoViewIfNeeded(); await s.click();
          const det = s.locator("xpath=..");
          clickRes = `Подробнее: open=${await det.evaluate((d: HTMLDetailsElement) => d.open)} text=${(await det.innerText()).replace(/\s+/g, " ").slice(0, 80)}`;
        } else clickRes = "нет «Подробнее»";
      }
      // 2) раскрыть всё
      let clicks = 0;
      for (let round = 0; round < 2; round++) {
        clicks += await page.evaluate(() => {
          document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true));
          let n = 0;
          [...document.querySelectorAll("main button[aria-expanded=false]")].slice(0, 15).forEach((b) => { (b as HTMLElement).click(); n++; });
          [...document.querySelectorAll("main a, main button")].filter((x) => /Развернуть все/.test(x.textContent ?? "")).slice(0, 2).forEach((x) => { (x as HTMLElement).click(); n++; });
          return n;
        });
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => {
        const de = document.documentElement; const m = document.querySelector("main")!;
        const ids: Record<string, number> = {}; document.querySelectorAll("[id]").forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
        const text = document.body.innerText;
        const bad = [...text.matchAll(/(NaN|undefined|\[object|Infinity)/g)].map((x) => text.slice(Math.max(0, x.index! - 20), x.index! + 15).replace(/\n/g, " "));
        const scr: string[] = [];
        document.querySelectorAll("div.table-scroll").forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && e.scrollWidth > e.clientWidth + 1) scr.push(`${e.scrollWidth}/${e.clientWidth}`); });
        return { hs: Math.max(de.scrollWidth, document.body.scrollWidth, m.scrollWidth) > Math.max(de.clientWidth, m.clientWidth) + 1, dups: Object.entries(ids).filter(([, n]) => n > 1).map(([k, n]) => `${k}x${n}`), bad: bad.slice(0, 4), scr: scr.slice(0, 5), nScr: scr.length, h: m.scrollHeight };
      });
      console.log("EXP", vp, name, "clicks", clicks, clickRes, "|", r.hs ? "HSCROLL" : "", r.dups.length ? "DUPS " + r.dups.slice(0, 5) : "", r.bad.length ? "BAD " + r.bad : "", "scrollers:", r.nScr, r.scr.join(","), "h", r.h, errors.length ? "ERR " + errors.slice(0, 3).join("|") : "");
    }
    await ctx.close();
  });
}
