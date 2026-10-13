import { test, expect } from "@playwright/test";
import { login } from "./helpers";
import * as fs from "fs";

// Сводка: числа в обоих режимах НДС (сверка с SQL — в /tmp/fur-qa), плюс обход страниц.
const MENU = [
  "/dashboard", "/lots", "/lots?tab=lining", "/raw-materials", "/purchases", "/purchases/new",
  "/production", "/production/new", "/shipments", "/shipments/new", "/fittings", "/fittings/new",
  "/articles", "/settings", "/materials", "/materials/new", "/suppliers", "/clients", "/payments",
  "/payments?tab=clients", "/supply-plan", "/attention", "/verify", "/documents", "/reconciliation", "/document-analysis", "/history", "/warehouses", "/settings/expense-categories", "/users",
  "/models", "/models/new", "/finished-stock", "/lining", "/suppliers/new", "/clients/new", "/warehouses/new", "/users/new",
];
const DETAIL: string[] = JSON.parse(fs.readFileSync("/tmp/fur-qa/pages.json", "utf8")).detail;
const BAD = /NaN|undefined|\[object Object\]|Infinity/;

for (const mode of ["incl", "excl"]) {
  test(`обход страниц, режим ${mode}`, async ({ page, context }) => {
    test.setTimeout(300_000);
    await login(page);
    await context.addCookies([{ name: "vatDisplay", value: mode, url: "http://localhost:3204" }]);
    const problems: string[] = [];
    let cur = "";
    page.on("pageerror", (e) => problems.push(`${cur} pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${cur} console: ${m.text().slice(0, 200)}`); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("_next/static")) problems.push(`${cur} HTTP ${r.status()} ${r.url()}`); });
    page.on("dialog", (d) => { problems.push(`${cur} DIALOG ${d.message()}`); d.dismiss(); });
    const texts: Record<string, string> = {};
    for (const p of [...MENU, ...DETAIL]) {
      cur = p;
      const res = await page.goto(p);
      await page.waitForLoadState("networkidle");
      const t = await page.locator("body").innerText();
      texts[p] = t;
      const m = t.match(BAD);
      if (m) problems.push(`${p} BADTEXT ${m[0]} ... ${t.slice(Math.max(0, t.search(BAD) - 40), t.search(BAD) + 40).replace(/\n/g, " ")}`);
      const xss = await page.evaluate(() => (window as any).__xss);
      if (xss) problems.push(`${p} XSS EXECUTED ${xss}`);
      const inj = await page.locator("body script:not([src])").evaluateAll((els) => els.filter((e) => /__xss/.test(e.textContent || "") && !/self\.__next_f/.test(e.textContent || "")).length);
      if (inj) problems.push(`${p} injected script elems ${inj}`);
      if (res && res.status() >= 400) problems.push(`${p} final status ${res.status()} url=${page.url()}`);
      if (page.url() !== "http://localhost:3204" + p) problems.push(`${p} -> redirected to ${page.url()}`);
    }
    fs.writeFileSync(`/tmp/fur-qa/crawl-${mode}.json`, JSON.stringify(texts, null, 1));
    fs.writeFileSync(`/tmp/fur-qa/problems-${mode}.txt`, problems.join("\n"));
    console.log(problems.join("\n") || "NO PROBLEMS");
  });
}
