/**
 * Сквозная проверка (smoke) работающего сервера: все страницы разделов открываются у владельца без ошибки сервера.
 * Не проверяет цифры (это делают остальные тесты) — ловит падения рендера, сломанные импорты, ошибки запросов к базе.
 *
 * Запуск (сервер уже стоит в боевом режиме на копии базы, например на заготовке FIXTURE=demo):
 *   DATABASE_URL=postgresql://…/fur_erp_smoke_test BASE_URL=http://localhost:3301 node node_modules/.bin/tsx scripts/test-smoke.ts
 * Скрипт сам заводит в копии проверочного владельца (smoke@smoke.test, пароль случайный, нигде не печатается).
 * База обязана называться *_test / *scratch* — иначе отказ.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const BASE = (process.env.BASE_URL ?? "http://localhost:3301").replace(/\/$/, "");
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/_test|scratch/.test(dbUrl.split("/").pop() ?? "")) { console.error("Отказ: база должна быть копией (*_test / *scratch*)"); process.exit(2); }

let fails = 0, total = 0;
const ok = (c: boolean, m: string) => { total++; if (!c) { fails++; console.log(`FAIL ${m}`); } };

type Res = { status: number; headers: Headers; text: string; location: string | null; ms: number };
async function req(p: string, o: { cookie?: string; method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Res> {
  const t0 = Date.now();
  const r = await fetch(BASE + p, { method: o.method ?? "GET", redirect: "manual", headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) }, body: o.body });
  return { status: r.status, headers: r.headers, text: await r.text(), location: r.headers.get("location"), ms: Date.now() - t0 };
}
const setCookies = (h: Headers) => (h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
const jar = (parts: string[]) => parts.filter((c) => !/=$/.test(c)).join("; ");

async function login(email: string, password: string): Promise<string | null> {
  const c = await req("/api/auth/csrf");
  const csrfCookies = setCookies(c.headers);
  const csrf = (JSON.parse(c.text) as { csrfToken: string }).csrfToken;
  const body = new URLSearchParams({ csrfToken: csrf, email, password, callbackUrl: BASE + "/", json: "true" }).toString();
  const r = await req("/api/auth/callback/credentials", { method: "POST", cookie: jar(csrfCookies), headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const all = [...csrfCookies, ...setCookies(r.headers)];
  return all.some((x) => x.startsWith("furerp.session-token=")) ? jar(all) : null;
}

/** Признаки упавшего рендера в ответе Next: страница ошибки целиком или ошибка внутри потоковой границы. */
function renderError(r: Res): string | null {
  if (r.status >= 500) return `HTTP ${r.status}`;
  if (r.text.includes("__next_error__")) return "страница ошибки Next";
  if (/\$RX\(/.test(r.text)) return "ошибка внутри границы Suspense ($RX)";
  if (/Application error|Internal Server Error/.test(r.text)) return "текст ошибки приложения";
  return null;
}

// Страницы разделов владельца (без параметров). Кабинет поставщика (/supplier/*) — другая роль, его периметр проверяет test-security.
const PAGES = [
  "/dashboard", "/attention", "/scheme", "/verify", "/data-check", "/integrity", "/history", "/history/comments", "/comments", "/inbox", "/chat",
  "/purchases", "/purchases/new", "/purchases/batch", "/purchases/lining/new", "/lots", "/lots/contractor-hides", "/lining", "/raw-materials",
  "/payments", "/payments/cashflow", "/cashflow", "/reconciliation", "/documents", "/document-analysis",
  "/production", "/production/new", "/production/batches", "/production/import", "/repair", "/finished-stock", "/shipments", "/shipments/new",
  "/sales", "/sales/movement", "/catalog", "/articles", "/models", "/models/new", "/materials", "/materials/new", "/fittings", "/fittings/new",
  "/analytics", "/analytics/margin", "/analytics/pricing", "/analytics/products", "/analytics/raw", "/analytics/raw/recon",
  "/budget", "/budget/compare", "/budget/plan27", "/plan", "/plan/seasons", "/supply-plan", "/calendar",
  "/suppliers", "/suppliers/new", "/clients", "/clients/new", "/warehouses", "/warehouses/new", "/expense-categories",
  "/settings", "/settings/articles-ref", "/settings/auctions", "/settings/categories", "/settings/channels", "/settings/colors",
  "/settings/contractors", "/settings/expense-categories", "/settings/fur-attrs", "/settings/furs", "/settings/import", "/users", "/users/new",
];

(async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const email = "smoke@smoke.test";
  const password = randomBytes(12).toString("base64url") + "aZ9!";
  const passwordHash = await bcrypt.hash(password, 4);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "OWNER", organizationId: org.id, supplierId: null, isActive: true },
    create: { email, name: "Smoke", passwordHash, role: "OWNER", organizationId: org.id },
  });

  // Без входа — на страницу входа, не ошибка.
  const anon = await req("/dashboard");
  ok([302, 303, 307, 308].includes(anon.status) && /\/login/.test(anon.location ?? ""), `без входа /dashboard → на вход (получено ${anon.status} ${anon.location ?? ""})`);

  const cookie = await login(email, password);
  ok(cookie !== null, "вход проверочного владельца");
  if (!cookie) { console.log(`\nПровалов: ${fails} из ${total}`); process.exit(1); }

  // Карточки: первая закупка, первое ТЗ, первый лот, первый артикул — ссылки берутся из базы.
  const purchase = await prisma.purchase.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const order = await prisma.productionOrder.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const lot = await prisma.rawMaterialLot.findFirst({ where: { organizationId: org.id }, select: { id: true } });
  const cards = [purchase && `/purchases/${purchase.id}`, order && `/production/${order.id}`, lot && `/analytics/raw/lot/${lot.id}`].filter(Boolean) as string[];
  ok(cards.length === 3, `в базе есть закупка, ТЗ и лот для карточек (${cards.length} из 3)`);

  const slow: string[] = [];
  for (const p of [...PAGES, ...cards]) {
    const r = await req(p, { cookie });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      // Переадресация внутри приложения допустима (раздел переехал); на вход — нет: сессия должна действовать.
      ok(!/\/login/.test(r.location ?? ""), `${p}: переадресация на вход при действующей сессии`);
      continue;
    }
    const err = renderError(r);
    ok(r.status === 200 && err === null, `${p}: ${err ?? `HTTP ${r.status}`}`);
    if (r.ms > 5000) slow.push(`${p} ${(r.ms / 1000).toFixed(1)} с`);
  }
  if (slow.length) console.log(`медленные страницы (> 5 с): ${slow.join(", ")}`);

  await prisma.user.delete({ where: { email } }).catch(() => null);
  await prisma.$disconnect();
  console.log(fails ? `\nПровалов: ${fails} из ${total}` : `\nВсё в порядке (${total} проверок, страниц ${PAGES.length + cards.length})`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
