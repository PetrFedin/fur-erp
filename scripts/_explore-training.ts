import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3417";
const txt = readFileSync(process.env.HOME + "/Backups/fur-erp/demo-logins.txt", "utf8");
function cred(role: string) {
  const m = txt.match(new RegExp(`\\(${role}\\)\\s*\\n\\s*email:\\s*(\\S+)\\s*\\n\\s*пароль:\\s*(\\S+)`));
  if (!m) throw new Error("no cred " + role);
  return { email: m[1], password: m[2] };
}
const [role, ...paths] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  await ctx.addInitScript("window.__name=(f)=>f"); const p = await ctx.newPage();
  const c = cred(role);
  await p.goto(BASE + "/login");
  await p.getByLabel("Email").fill(c.email);
  await p.getByLabel("Пароль").fill(c.password);
  await p.getByRole("button", { name: "Войти" }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  for (const path of paths) {
    await p.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
    console.log("=== " + path + " -> " + p.url().replace(BASE, ""));
    const info = await p.evaluate(() => {
      const t = (e: Element) => (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const main = document.querySelector("main") ?? document.body;
      return {
        h: [...main.querySelectorAll("h1,h2,h3")].map(t).slice(0, 25),
        btn: [...main.querySelectorAll("button,[role=tab]")].map((e) => t(e) || e.getAttribute("aria-label") || "").filter(Boolean).slice(0, 50),
        a: [...main.querySelectorAll("a")].map((e) => t(e) + " -> " + e.getAttribute("href")).slice(0, 25),
        inp: [...main.querySelectorAll("input,select,textarea")].map((e) => (e.getAttribute("name") || "") + "|" + (e.getAttribute("placeholder") || e.getAttribute("aria-label") || "")).slice(0, 25),
      };
    });
    console.log(JSON.stringify(info, null, 0));
  }
  await b.close();
})();
