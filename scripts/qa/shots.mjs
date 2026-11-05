// Снимки страницы кусками: приложение прокручивается внутри <main>, поэтому обычный fullPage снимает только первый экран.
// Здесь прокручиваем <main> по экрану и снимаем каждый кусок (шапка остаётся в кадре, как у человека на телефоне).
// Запуск: node scripts/qa/shots.mjs <папка> [--expand] [--views iphone,ipad] [--base http://localhost:3200] маршрут …
// --expand: перед съёмкой раскрывает первые 8 свёрнутых строк/карточек (aria-expanded=false) — видно внутренности.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const a = process.argv.slice(2);
const out = a.shift();
let expand = false, base = "http://localhost:3200", views = ["iphone", "ipad"]; const routes = [];
for (let i = 0; i < a.length; i++) { if (a[i] === "--expand") expand = true; else if (a[i] === "--base") base = a[++i]; else if (a[i] === "--views") views = a[++i].split(","); else routes.push(a[i]); }
const V = { iphone: { viewport: { width: 390, height: 844 } }, ipad: { viewport: { width: 820, height: 1180 } } };
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const v of views) {
  const ctx = await browser.newContext({ ...V[v], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(base + "/login"); await page.fill('input[type=email],input[name=email]', "anna@qa-test.ru"); await page.fill('input[type=password],input[name=password]', "TestPass123!"); await page.keyboard.press("Enter");
  await page.waitForURL(/dashboard|\/$/, { timeout: 60000 }).catch(() => {});
  for (const r of routes) {
    const slug = r.replace(/[\/?=&]/g, "_").replace(/^_/, "") || "root";
    try {
      await page.goto(base + r, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(800);
      if (expand) {
        for (let k = 0; k < 8; k++) { const b = page.locator('main [aria-expanded="false"]:not(dialog *)').first(); if (!(await b.count())) break; await b.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(250); }
      }
      const info = await page.evaluate(() => { const m = document.querySelector("main"); return m ? { h: m.scrollHeight, ch: m.clientHeight } : { h: document.documentElement.scrollHeight, ch: innerHeight }; });
      const step = Math.max(300, info.ch - 40), n = Math.min(14, Math.ceil(info.h / step));
      for (let i = 0; i < n; i++) {
        await page.evaluate((y) => { const m = document.querySelector("main"); if (m) m.scrollTo(0, y); else scrollTo(0, y); }, i * step);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${out}/${v}_${slug}_${String(i + 1).padStart(2, "0")}.png`, timeout: 30000 });
      }
      console.log(v, r, "кусков", n, "высота", info.h);
    } catch (e) { console.log(v, r, "ОШИБКА", String(e).slice(0, 100)); }
  }
  await ctx.close();
}
await browser.close();
