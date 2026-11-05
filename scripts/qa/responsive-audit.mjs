// Аудит вёрстки на iPhone и iPad: заходит под демо-владельцем, обходит страницы, ищет горизонтальную прокрутку страницы,
// элементы, вылезающие за экран, наложение текста друг на друга и тесные цели касания; снимки — в папку out.
// Запуск: node scripts/qa/responsive-audit.mjs <out> [http://localhost:3200] [маршрут …]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? "/tmp/resp"; const base = process.argv[3] ?? "http://localhost:3200";
const only = process.argv.slice(4);
const ROUTES = only.length ? only : ["/dashboard","/scheme","/cashflow","/lots","/purchases","/production","/production/batches","/articles","/models","/finished-stock","/repair","/shipments","/calendar","/sales","/sales/movement","/payments","/payments/cashflow","/budget","/plan","/plan/seasons","/supply-plan","/chat","/settings","/settings/furs","/settings/colors","/settings/categories","/settings/contractors","/settings/import","/clients","/suppliers","/warehouses","/materials","/users","/attention","/verify","/documents","/reconciliation","/document-analysis","/history","/comments","/integrity","/inbox","/analytics","/raw-materials","/lining","/fittings"];
const VIEWS = [{ name: "iphone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, dsf: 2 }, { name: "ipad", viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, dsf: 2 }];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const v of VIEWS) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.dsf });
  const page = await ctx.newPage();
  await page.goto(base + "/login"); await page.fill('input[type=email],input[name=email]', "anna@qa-test.ru"); await page.fill('input[type=password],input[name=password]', "TestPass123!"); await page.keyboard.press("Enter");
  await page.waitForURL(/dashboard|\/$/, { timeout: 60000 }).catch(() => {});
  for (const r of ROUTES) {
    const slug = r.replace(/\//g, "_").replace(/^_/, "") || "root";
    try {
      const resp = await page.goto(base + r, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(600);
      const res = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll" || o === "hidden") && p.scrollWidth > p.clientWidth + 1) return true; if ((o === "auto" || o === "scroll" || o === "hidden") && p.getBoundingClientRect().width <= W + 1) return false; } return false; };
        const vis = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0 && s.opacity !== "0"; };
        const desc = (el) => (el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "") + " «" + (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40) + "»");
        const over = [];
        for (const el of document.body.querySelectorAll("*")) { if (!vis(el)) continue; const b = el.getBoundingClientRect(); if ((b.right > W + 2 || b.left < -2) && !inScroller(el) && getComputedStyle(el).position !== "fixed") { over.push(desc(el) + ` [${Math.round(b.left)}..${Math.round(b.right)}]`); if (over.length >= 8) break; } }
        // наложение текстовых листьев
        const leaves = [...document.body.querySelectorAll("*")].filter((el) => vis(el) && el.children.length === 0 && (el.textContent || "").trim().length > 1 && !el.closest("svg,script,style"));
        const rects = leaves.map((el) => ({ el, b: el.getBoundingClientRect() })).filter((x) => x.b.top < 20000);
        const clash = [];
        for (let i = 0; i < rects.length && clash.length < 8; i++) for (let j = i + 1; j < Math.min(rects.length, i + 40); j++) { const a = rects[i].b, c = rects[j].b; const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); if (ix > 6 && iy > 6 && !rects[i].el.contains(rects[j].el) && !rects[j].el.contains(rects[i].el)) { const pa = getComputedStyle(rects[i].el).position, pc = getComputedStyle(rects[j].el).position; if (pa === "fixed" || pc === "fixed") continue; clash.push(desc(rects[i].el) + " ⟷ " + desc(rects[j].el)); break; } }
        const small = [...document.querySelectorAll("a,button,input,select,[role=button]")].filter((el) => vis(el) && !el.closest("[hidden]")).filter((el) => { const b = el.getBoundingClientRect(); return (b.height < 40 || b.width < 40) && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio"; }).length;
        const tinyText = [...document.body.querySelectorAll("*")].filter((el) => vis(el) && el.children.length === 0 && (el.textContent || "").trim().length > 2 && parseFloat(getComputedStyle(el).fontSize) < 11 && !el.closest("svg")).length;
        return { docOverflow: sw - W, over, clash, small, tinyText, h: document.documentElement.scrollHeight };
      });
      await page.screenshot({ path: `${out}/${v.name}_${slug}.png`, fullPage: true, timeout: 60000 }).catch(() => {});
      report.push({ view: v.name, route: r, status: resp?.status(), ...res });
      console.log(v.name, r, resp?.status(), "ov", res.docOverflow, "elOver", res.over.length, "clash", res.clash.length, "small", res.small, "tiny", res.tinyText);
    } catch (e) { report.push({ view: v.name, route: r, error: String(e).slice(0, 120) }); console.log(v.name, r, "ERR", String(e).slice(0, 80)); }
  }
  await ctx.close();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
