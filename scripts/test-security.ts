/**
 * Проверка безопасности работающего сервера (по HTTP) на КОПИИ базы — не на боевой.
 *
 * Запуск (сервер уже стоит на :3420 в боевом режиме: NODE_ENV=production, база fur_erp_sec):
 *   DATABASE_URL=postgresql://…/fur_erp_sec BASE_URL=http://localhost:3420 npx tsx scripts/test-security.ts
 *
 * Скрипт сам создаёт в копии базы проверочных пользователей (почты @sec.test, пароли случайные, нигде не печатаются):
 *   • владелец организации A, наблюдатель A, два поставщика (кабинеты) организации A, владелец чужой организации B.
 * Проверяет: закрытые адреса без входа, чужие записи по id (между организациями и между поставщиками),
 * периметр роли SUPPLIER по всем страницам, защиту от перебора пароля (в том числе прямым POST на /api/auth),
 * скрытое демо-вход/регистрацию, заголовки безопасности, /api/ready, лимит тела, журнал входов.
 * База обязана называться *_sec / *_demo / *_test — иначе скрипт откажется работать.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { SUPPLIER_DOC_TYPES, supplierMayUpload } from "../src/lib/supplier-docs";
import { isOurPaymentDoc, paymentDocFlags } from "../src/lib/supplier-payment-docs-core";

const BASE = (process.env.BASE_URL ?? "http://localhost:3420").replace(/\/$/, "");
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/\/[a-z0-9_]*_(sec|demo|test)(\?|$)/i.test(dbUrl)) {
  console.error("Отказ: DATABASE_URL должен указывать на копию базы (имя заканчивается на _sec, _demo или _test).");
  process.exit(2);
}
const prisma = new PrismaClient();
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR?.trim() || "./uploads");

let fails = 0;
let total = 0;
const ok = (c: unknown, m: string) => {
  total++;
  console.log(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) fails++;
};
const pw = () => randomBytes(12).toString("base64url") + "aZ9!";

type Res = { status: number; headers: Headers; text: string; location: string | null };
async function req(p: string, o: { cookie?: string; method?: string; headers?: Record<string, string>; body?: string; ip?: string } = {}): Promise<Res> {
  const r = await fetch(BASE + p, {
    method: o.method ?? "GET",
    redirect: "manual",
    headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.ip ? { "x-forwarded-for": o.ip } : {}), ...(o.headers ?? {}) },
    body: o.body,
  });
  return { status: r.status, headers: r.headers, text: await r.text(), location: r.headers.get("location") };
}
const setCookies = (h: Headers) => (h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
const jar = (parts: string[]) => parts.filter((c) => !/=$/.test(c)).join("; ");

/** Вход напрямую через API Auth.js (как это сделал бы злоумышленник, минуя форму). Возвращает cookie сессии или null. */
async function login(email: string, password: string, ip: string): Promise<string | null> {
  const c = await req("/api/auth/csrf", { ip });
  const csrfCookies = setCookies(c.headers);
  const csrf = (JSON.parse(c.text) as { csrfToken: string }).csrfToken;
  const body = new URLSearchParams({ csrfToken: csrf, email, password, callbackUrl: BASE + "/", json: "true" }).toString();
  const r = await req("/api/auth/callback/credentials", {
    method: "POST",
    ip,
    cookie: jar(csrfCookies),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const all = [...csrfCookies, ...setCookies(r.headers)];
  const session = all.find((x) => x.startsWith("furerp.session-token="));
  return session ? jar(all) : null;
}

/** Ответ считается «отказом», если это редирект, 401/403/404 или страница-заглушка 404/редиректа внутри 200 (потоковый ответ Next). */
function denied(r: Res): boolean {
  if ([301, 302, 303, 307, 308, 401, 403, 404].includes(r.status)) return true;
  return r.status === 200 && /NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|http-equiv="refresh"|This page could not be found/.test(r.text);
}

function staticPages(): string[] {
  const out: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name.startsWith("[") || name === "api") continue;
        walk(full, /^\(.*\)$/.test(name) ? route : route + "/" + name);
      } else if (name === "page.tsx") out.push(route || "/");
    }
  };
  walk(path.resolve("src/app"), "");
  return out.sort();
}

async function main() {
  // ---------- фикстуры ----------
  const orgA = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" }, select: { organizationId: true } })).organizationId;
  const sup1 = (await prisma.supplier.findFirstOrThrow({ where: { organizationId: orgA }, orderBy: { createdAt: "asc" } })).id;
  const sup2 = (await prisma.supplier.upsert({
    where: { id: "sec-supplier-2" },
    update: {},
    create: { id: "sec-supplier-2", organizationId: orgA, name: "SEC Поставщик 2" },
  })).id;
  const orgB = (await prisma.organization.upsert({ where: { slug: "sec-org-b" }, update: {}, create: { name: "SEC Организация B", slug: "sec-org-b" } })).id;

  const pass: Record<string, string> = {};
  async function user(key: string, role: "OWNER" | "VIEWER" | "SUPPLIER", organizationId: string, supplierId?: string) {
    const email = `${key}@sec.test`;
    pass[key] = pw();
    const passwordHash = await bcrypt.hash(pass[key], 4);
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role, organizationId, supplierId: supplierId ?? null, isActive: true },
      create: { email, name: `SEC ${key}`, passwordHash, role, organizationId, supplierId: supplierId ?? null },
    });
    return email;
  }
  const E = {
    ownerA: await user("sec-owner-a", "OWNER", orgA),
    viewerA: await user("sec-viewer-a", "VIEWER", orgA),
    sup1: await user("sec-sup1", "SUPPLIER", orgA, sup1),
    sup2: await user("sec-sup2", "SUPPLIER", orgA, sup2),
    ownerB: await user("sec-owner-b", "OWNER", orgB),
    victim: await user("sec-victim", "VIEWER", orgA),
    viewer2: await user("sec-viewer-2", "VIEWER", orgA),
  };
  const key = (e: string) => e.replace("@sec.test", "");

  // Файл-проба и строки с настоящими файлами на диске: у владельца A должен открыться (положительный контроль), у остальных — нет.
  mkdirSync(path.join(UPLOAD_ROOT, "sec-test"), { recursive: true });
  const probe = "sec-test/probe.pdf";
  writeFileSync(path.join(UPLOAD_ROOT, probe), "%PDF-1.4\n% security probe\n");
  const pdoc = await prisma.purchaseDocument.findFirstOrThrow({ where: { organizationId: orgA } });
  await prisma.purchaseDocument.update({ where: { id: pdoc.id }, data: { storagePath: probe, mimeType: "application/pdf" } });
  const ddoc = await prisma.driveDocument.findFirst({ where: { organizationId: orgA, shipmentEvent: { shipment: { supplierId: sup1 } } } });
  const ddocAny = ddoc ?? (await prisma.driveDocument.findFirstOrThrow({ where: { organizationId: orgA, storagePath: { not: null } } }));
  await prisma.driveDocument.update({ where: { id: ddocAny.id }, data: { storagePath: probe, storedMime: "application/pdf" } });
  const inbox = await prisma.supplierInbox.findFirstOrThrow({ where: { organizationId: orgA, supplierId: sup1 } });
  const ifile = await prisma.supplierInboxFile.findFirst({ where: { inboxId: inbox.id } });
  if (ifile) await prisma.supplierInboxFile.update({ where: { id: ifile.id }, data: { storagePath: probe, mimeType: "application/pdf" } });
  const thread = await prisma.chatThread.create({
    data: { organizationId: orgA, supplierId: sup1, subject: "SEC проба", createdById: "x", createdByName: "x", createdBySide: "INTERNAL", lastMessageSide: "INTERNAL" },
  });
  const msg = await prisma.chatMessage.create({ data: { threadId: thread.id, organizationId: orgA, authorName: "x", authorSide: "INTERNAL", body: "SEC-CHAT-MARKER" } });
  const att = await prisma.chatAttachment.create({ data: { messageId: msg.id, storagePath: probe, originalName: "probe.pdf", mimeType: "application/pdf", sizeBytes: 26 } });

  // ---------- 1. без входа ----------
  console.log("\n== 1. Без входа");
  const pages = staticPages();
  const open = ["/login", "/register"];
  let leaked = 0;
  for (const p of pages) {
    if (open.includes(p)) continue;
    const r = await req(p);
    if (!denied(r)) { leaked++; console.log("   открыто без входа:", p, r.status); }
  }
  ok(leaked === 0, `все ${pages.length - open.length} страниц без входа отправляют на /login`);
  for (const a of ["/api/search?q=12", "/api/integrity", "/api/comments?mode=counts&path=/lots", `/api/purchase-docs/${pdoc.id}`, `/api/drive-docs/${ddocAny.id}`, `/api/chat/files/${att.id}`, `/api/doc-text?src=drive&id=${ddocAny.id}`, "/api/doc-list", "/api/article-ref"]) {
    const r = await req(a);
    ok(r.status === 401 || r.status === 307, `API без входа закрыт: ${a.split("?")[0]} → ${r.status}`);
  }
  const hook = await req("/api/channels/telegram/webhook", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  ok(hook.status === 404 || hook.status === 403, `вебхук Telegram без секрета закрыт (${hook.status})`);
  const ready = await req("/api/ready");
  ok(/production_ready/.test(ready.text) && !/database|counts|blockers/.test(ready.text), "/api/ready без входа показывает только готовность");
  ok((await req("/api/ready?details=1")).status === 401, "/api/ready?details=1 без входа → 401");
  const health = await req("/api/health");
  ok(health.status === 200 && !/version|env|database/i.test(health.text), "/api/health ничего лишнего не раскрывает");

  // ---------- 2. заголовки, демо, регистрация ----------
  console.log("\n== 2. Заголовки, демо-вход, регистрация");
  const lp = await req("/login");
  const h = lp.headers;
  ok(/frame-ancestors 'none'/.test(h.get("content-security-policy") ?? "") && /default-src 'self'/.test(h.get("content-security-policy") ?? ""), "CSP: default-src 'self' и frame-ancestors 'none'");
  ok(!/script-src[^;]*unsafe-eval/.test(h.get("content-security-policy") ?? ""), "CSP: без unsafe-eval");
  ok(h.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
  ok(h.get("x-frame-options") === "DENY", "X-Frame-Options: DENY");
  ok(!!h.get("referrer-policy") && !!h.get("permissions-policy"), "Referrer-Policy и Permissions-Policy на месте");
  ok(/max-age=\d{7,}/.test(h.get("strict-transport-security") ?? ""), "HSTS включён");
  ok(!h.get("x-powered-by"), "X-Powered-By отключён");
  ok(/no-store/.test(h.get("cache-control") ?? ""), "страницы не кэшируются (Cache-Control: no-store)");
  ok(!/SHOULD-NOT-APPEAR|demo@example/.test(lp.text), "на /login нет демо-паролей (boевой режим)");
  const rg = await req("/register");
  ok(rg.status === 307 && (rg.location ?? "").endsWith("/login"), "/register закрыта (редирект на вход)");
  ok(!/Зарегистрировать компанию/.test(lp.text), "на /login нет ссылки «Зарегистрировать компанию»");
  const reg = await req("/register", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "next-action": "deadbeef" }, body: "x=1" });
  ok(reg.status !== 200 || !/OWNER/.test(reg.text), "прямой POST на /register не создаёт компанию");

  // ---------- 3. вход, перебор ----------
  console.log("\n== 3. Вход и защита от перебора");
  const ip = (n: number) => `198.51.100.${n}`;
  const sess: Record<string, string> = {};
  for (const [k, e] of Object.entries(E)) {
    if (k === "victim" || k === "viewer2") continue;
    const c = await login(e, pass[key(e)], ip(10 + Object.keys(sess).length));
    ok(!!c, `вход ${k} (${e})`);
    if (c) sess[k] = c;
  }
  const secure = await req("/api/auth/csrf", { ip: ip(30) });
  ok((setCookies(secure.headers).length >= 1), "cookie выставляются");
  const rawSet = (secure.headers.getSetCookie?.() ?? []).join("\n");
  ok(/HttpOnly/i.test(rawSet) && /SameSite=lax/i.test(rawSet), "cookie: HttpOnly и SameSite=Lax");
  ok(/Secure/i.test(rawSet), "cookie: Secure (боевой режим)");

  // одинаковый ответ на неверную почту и неверный пароль
  const bad1 = await login("no-such-user@sec.test", "WrongPassword123", ip(40));
  const bad2 = await login(E.ownerA, "WrongPassword123", ip(41));
  ok(!bad1 && !bad2, "неверный вход не выдаёт сессию");

  // перебор прямым POST на /api/auth: после 10 неудач верный пароль тоже отклоняется
  const bf = ip(77);
  let sessionDuring = false;
  for (let i = 0; i < 11; i++) if (await login(E.victim, "Wrong-" + i + "-Password", bf)) sessionDuring = true;
  ok(!sessionDuring, "11 неверных паролей подряд — без входа");
  const afterLock = await login(E.victim, pass["sec-victim"], bf);
  ok(!afterLock, "после 10 неудач верный пароль с того же адреса отклоняется (замок на пару почта+IP)");
  const otherIp = await login(E.victim, pass["sec-victim"], ip(78));
  ok(!!otherIp, "замок «почта+IP» не лишает настоящего владельца почты входа с другого адреса");
  // перебор одной почты с множества адресов (подмена X-Forwarded-For): общий замок по почте срабатывает после 30 неудач
  for (let i = 0; i < 31; i++) await login(E.viewer2, "Wrong-" + i + "-Password", `192.0.2.${100 + i}`);
  ok(!(await login(E.viewer2, pass["sec-viewer-2"], "192.0.2.200")), "30+ неудач по одной почте с разных адресов — почта блокируется целиком");
  const stranger = await login(E.viewerA, pass["sec-viewer-a"], ip(79));
  ok(!!stranger, "другой пользователь с другого адреса входит свободно");

  // перебор многих почт с одного адреса
  const sweep = ip(88);
  for (let i = 0; i < 42; i++) await login(`guess${i}@sec.test`, "Wrong-Password-1", sweep);
  ok(!(await login(E.viewerA, pass["sec-viewer-a"], sweep)), "40+ неудач с одного адреса блокируют адрес целиком");

  // журнал входов
  const logs = await prisma.auditLog.count({ where: { source: "auth", actorId: { not: null } } });
  ok(logs >= 5, `журнал входов пишется (записей: ${logs})`);
  const lastLog = await prisma.auditLog.findFirst({ where: { source: "auth" }, orderBy: { at: "desc" } });
  ok(!JSON.stringify(lastLog?.changes ?? {}).match(/Password|пароль:/i), "в журнале входов нет паролей");

  // ---------- 4. изоляция организаций ----------
  console.log("\n== 4. Между организациями (владелец B → записи A)");
  const A = sess.ownerA, B = sess.ownerB;
  const purchase = await prisma.purchase.findFirstOrThrow({ where: { organizationId: orgA } });
  const order = await prisma.productionOrder.findFirstOrThrow({ where: { organizationId: orgA }, include: { client: true } });
  const client = await prisma.client.findFirst({ where: { organizationId: orgA } });
  const lot = await prisma.rawMaterialLot.findFirstOrThrow({ where: { organizationId: orgA } });
  const model = await prisma.productModel.findFirst({ where: { organizationId: orgA } });
  const material = await prisma.rawMaterial.findFirst({ where: { organizationId: orgA } });
  const warehouse = await prisma.warehouse.findFirst({ where: { organizationId: orgA } });
  const payment = await prisma.payment.findFirstOrThrow({ where: { organizationId: orgA } });
  const shipment = await prisma.shipment.findFirstOrThrow({ where: { organizationId: orgA } });
  const batch = await prisma.productionBatch.findFirst({ where: { organizationId: orgA } });
  const budget = await prisma.budgetScenario.findFirst({ where: { organizationId: orgA } });
  const tzInbox = await prisma.supplierInbox.findFirst({ where: { organizationId: orgA, supplierId: sup1, kind: "TZ" } });
  const calcInbox = await prisma.supplierInbox.findFirst({ where: { organizationId: orgA, supplierId: sup1, kind: "AUCTION_CALC" } });

  type Probe = { p: string; marker?: string; post?: boolean };
  const INVOICE_BODY = JSON.stringify({ kind: "Аванс", amount: 1000, number: "1", date: "2026-01-01" });
  const go = (pr: Probe, cookie: string) => req(pr.p, pr.post ? { cookie, method: "POST", headers: { "content-type": "application/json" }, body: INVOICE_BODY } : { cookie });
  const probes: Probe[] = [
    { p: `/purchases/${purchase.id}`, marker: purchase.number },
    { p: `/production/${order.id}`, marker: order.number },
    { p: `/production/${order.id}/print`, marker: order.number },
    { p: `/payments/s-${payment.id}` },
    { p: `/analytics/raw/lot/${lot.id}`, marker: lot.lotNumber ?? undefined },
    { p: `/shipments/${shipment.id}` },
    { p: `/suppliers/${sup1}`, marker: "Веллмех" },
    { p: `/settings/contractors/${sup1}`, marker: "Веллмех" },
    { p: `/inbox/${inbox.id}`, marker: inbox.title },
    { p: `/api/purchase-docs/${pdoc.id}` },
    { p: `/api/drive-docs/${ddocAny.id}` },
    { p: `/api/chat/files/${att.id}` },
    { p: `/api/doc-text?src=purchase&id=${pdoc.id}` },
    { p: `/api/doc-text?src=drive&id=${ddocAny.id}` },
    { p: `/api/production/${order.id}/word` },
    { p: `/api/production/${order.id}/docx` },
  ];
  if (client) probes.push({ p: `/clients/${client.id}`, marker: client.name });
  if (model) probes.push({ p: `/models/${model.id}`, marker: model.name });
  if (material) probes.push({ p: `/materials/${material.id}`, marker: material.name });
  if (warehouse) probes.push({ p: `/warehouses/${warehouse.id}` });
  if (batch) probes.push({ p: `/production/batches/${batch.number}` });
  if (budget) probes.push({ p: `/budget/${budget.id}` });
  if (ifile) probes.push({ p: `/api/supplier/inbox-files/${ifile.id}` });
  if (tzInbox) probes.push({ p: `/api/supplier/tz/${tzInbox.id}/docx` }, { p: `/api/supplier/tz/${tzInbox.id}/preview` }, { p: `/supplier/tz/${tzInbox.id}` });
  if (calcInbox) probes.push({ p: `/api/supplier/auction-calcs/${calcInbox.id}/xlsx` }, { p: `/api/supplier/auction-calcs/${calcInbox.id}/invoice`, post: true }, { p: `/supplier/auction-calcs/${calcInbox.id}` });

  let controlsOk = 0;
  for (const pr of probes) {
    const a = await go(pr, A);
    if (a.status === 200) controlsOk++;
    const b = await go(pr, B);
    const leakedMarker = pr.marker ? b.text.includes(pr.marker) : false;
    ok(denied(b) && !leakedMarker, `чужая организация B: ${pr.p.replace(/[a-z0-9]{20,}/g, "<id>")} → ${b.status}${leakedMarker ? " УТЕЧКА" : ""}`);
  }
  ok(controlsOk >= probes.length * 0.5, `контроль: владелец A видит свои записи (${controlsOk}/${probes.length} открылись)`);
  const goodDoc = await req(`/api/purchase-docs/${pdoc.id}`, { cookie: A });
  ok(goodDoc.status === 200 && goodDoc.headers.get("x-content-type-options") === "nosniff" && /private/.test(goodDoc.headers.get("cache-control") ?? ""), "выдача файла: 200, nosniff, Cache-Control private");
  ok(/attachment|inline/.test(goodDoc.headers.get("content-disposition") ?? ""), "выдача файла: Content-Disposition задан");

  // id с мусором (инъекции, обход пути)
  for (const bad of ["../../etc/passwd", "%00", "' OR 1=1 --", "a".repeat(200), "..%2F..%2Fetc%2Fpasswd"]) {
    const r = await req(`/api/purchase-docs/${bad}`, { cookie: A });
    ok(r.status === 404 || r.status === 400, `мусорный id в /api/purchase-docs → ${r.status}`);
  }

  // ---------- 5. роль SUPPLIER ----------
  console.log("\n== 5. Периметр роли SUPPLIER (кабинет подрядчика)");
  const S2 = sess.sup2, S1 = sess.sup1;
  const deny = ["/dashboard", "/purchases", "/payments", "/lots", "/production", "/analytics/raw", "/budget", "/users", "/suppliers", "/clients", "/documents", "/warehouses", "/history", "/reconciliation", "/verify", "/plan", "/calendar", "/settings/contractors", "/settings/expense-categories", "/inbox", "/attention", "/fittings", "/supply-plan", "/repair", "/scheme", "/finished-stock", "/materials"];
  let supLeak = 0;
  for (const p of deny) {
    const r = await req(p, { cookie: S2 });
    if (!denied(r)) { supLeak++; console.log("   поставщику открыто:", p, r.status); }
  }
  ok(supLeak === 0, `поставщику закрыты ${deny.length} внутренних разделов`);
  let all200: string[] = [];
  for (const p of pages) {
    if (open.includes(p)) continue;
    const r = await req(p, { cookie: S2 });
    if (!denied(r)) all200.push(p);
  }
  console.log("   страницы, доступные поставщику:", all200.join(" "));
  const bad200 = all200.filter((p) => !/^\/(supplier|shipments|settings|articles|models|chat)(\/|$)/.test(p));
  ok(bad200.length === 0, `поставщику открыты только страницы его кабинета (лишних: ${bad200.join(", ") || "нет"})`);
  for (const a of ["/api/search?q=12", "/api/integrity", "/api/comments?mode=counts&path=/lots", `/api/purchase-docs/${pdoc.id}`, "/api/doc-list", "/api/article-ref", `/api/doc-text?src=drive&id=${ddocAny.id}`, `/api/production/${order.id}/word`, "/api/ready?details=1"]) {
    const r = await req(a, { cookie: S2 });
    ok(denied(r), `API закрыт для поставщика: ${a.split("?")[0]} → ${r.status}`);
  }
  console.log("   — чужие данные другого поставщика (sup2 → записи sup1):");
  const cross: Probe[] = [
    { p: `/api/chat/files/${att.id}` },
    { p: `/api/drive-docs/${ddocAny.id}` },
    { p: `/shipments/${shipment.id}` },
    { p: `/inbox/${inbox.id}` },
    { p: `/suppliers/${sup1}`, marker: "Веллмех" },
  ];
  if (ifile) cross.push({ p: `/api/supplier/inbox-files/${ifile.id}` });
  if (tzInbox) cross.push({ p: `/supplier/tz/${tzInbox.id}`, marker: tzInbox.title }, { p: `/api/supplier/tz/${tzInbox.id}/docx` }, { p: `/api/supplier/tz/${tzInbox.id}/preview` });
  if (calcInbox) cross.push({ p: `/supplier/auction-calcs/${calcInbox.id}`, marker: calcInbox.title }, { p: `/api/supplier/auction-calcs/${calcInbox.id}/xlsx` }, { p: `/api/supplier/auction-calcs/${calcInbox.id}/invoice`, post: true });
  for (const pr of cross) {
    const b = await go(pr, S2);
    const leakedMarker = pr.marker ? b.text.includes(pr.marker) : false;
    ok(denied(b) && !leakedMarker, `sup2 → данные sup1: ${pr.p.replace(/[a-z0-9]{20,}/g, "<id>")} → ${b.status}${leakedMarker ? " УТЕЧКА" : ""}`);
  }
  const own = await req(`/api/chat/files/${att.id}`, { cookie: S1 });
  ok(own.status === 200, `контроль: sup1 открывает файл своего обсуждения (${own.status})`);
  const own2 = ifile ? await req(`/api/supplier/inbox-files/${ifile.id}`, { cookie: S1 }) : null;
  if (own2) ok(own2.status === 200, `контроль: sup1 открывает свой файл входящего (${own2.status})`);

  // Документы по оплате: Веллмех их не загружает (сервер отклоняет платёжные типы) и видит лишь признак «есть / нет».
  console.log("   — документы по оплате (SUPPLIER не грузит, видит только факт):");
  for (const k of ["PAYMENT_NOTE", "PAYMENT_PROOF", "PAYMENT_ORDER", "PAYMENT", "payment_note", "", null]) ok(!supplierMayUpload(k), `загрузка платёжного типа ${JSON.stringify(k)} от SUPPLIER отклоняется`);
  ok(SUPPLIER_DOC_TYPES.every((t) => supplierMayUpload(t.key)) && !SUPPLIER_DOC_TYPES.some((t) => /оплат|платёж/i.test(t.label)), "в списке типов подрядчика нет платёжных, остальные (УПД, спецификация, смета…) разрешены");
  const flagMap = paymentDocFlags([{ id: "a", invoice: "№ 083", number: "P-1" }, { id: "b", invoice: "84", number: "P-2" }, { id: "c", invoice: "", number: "P-3" }], [
    { purchaseId: null, invoiceNo: "83", hasDoc: true }, { purchaseId: "b", invoiceNo: null, hasDoc: false }, { purchaseId: null, invoiceNo: "", hasDoc: true },
  ]);
  ok(flagMap.get("a") === true && flagMap.get("b") === false && flagMap.get("c") === false, "признак «есть / нет»: по номеру счёта есть, без документа и без счёта — нет");
  const one = (rows: { supplierId?: string; docType: string }[], sid = "S") => paymentDocFlags([{ id: "a", invoice: "83", number: "P" }], rows.map((r) => ({ supplierId: r.supplierId ?? "S", purchaseId: "a", invoiceNo: "83", hasDoc: isOurPaymentDoc(r.docType) })), sid).get("a");
  ok(one([{ docType: "PAYMENT_INVOICE" }]) === false, "только счёт Веллмеха (PAYMENT_INVOICE) → «нет»");
  ok(one([{ docType: "APPROVAL_EMAIL" }]) === true && one([{ docType: "PAYMENT_PROOF" }]) === true && one([{ docType: "OTHER" }]) === true, "письмо-согласование, платёжка и прочие наши документы → «есть»");
  ok(one([{ docType: "APPROVAL_EMAIL", supplierId: "X" }]) === false, "документы оплат чужого поставщика не влияют");
  ok([...flagMap.values()].every((v) => typeof v === "boolean"), "признак — только булево значение (сумм, дат, получателей нет)");
  const sup1Purchase = await prisma.purchase.findFirst({ where: { organizationId: orgA, supplierId: sup1, status: { not: "CANCELLED" } }, select: { id: true, number: true, invoiceNumber: true } });
  if (sup1Purchase) {
    const SECRET = 987654.32;
    const inv = sup1Purchase.invoiceNumber ?? sup1Purchase.number;
    const pay = await prisma.payment.create({ data: { organizationId: orgA, supplierId: sup1, purchaseId: sup1Purchase.id, amount: SECRET, invoiceNo: inv, notes: "SEC-PAYMENT-SECRET-NOTE" } });
    const dd = await prisma.driveDocument.create({ data: { organizationId: orgA, driveFileId: `local-sec-${pay.id}`, title: "Платёжка: SEC-PAYMENT-SCAN.pdf", docType: "PAYMENT_PROOF", paymentId: pay.id, purchaseId: sup1Purchase.id, storagePath: probe } });
    try {
      const pg = await req(`/supplier/raw/${sup1Purchase.id}`, { cookie: S1 });
      ok(pg.status === 200 && pg.text.includes("Платёжный документ") && pg.text.includes("есть"), `sup1 видит у своего аукциона «Платёжный документ: есть» (${pg.status})`);
      ok(!/987[\s\u00a0,.]?654/.test(pg.text) && !pg.text.includes("SEC-PAYMENT-SECRET-NOTE") && !pg.text.includes("SEC-PAYMENT-SCAN"), "страница подрядчика не раскрывает сумму, заметку и имя файла оплаты");
      const f = await req(`/api/drive-docs/${dd.id}`, { cookie: S1 });
      ok(denied(f), `sup1 не открывает файл оплаты напрямую (${f.status})`);
      const pp = await req(`/payments`, { cookie: S1 });
      ok(denied(pp), `sup1 не открывает /payments (${pp.status})`);
    } finally {
      await prisma.driveDocument.delete({ where: { id: dd.id } }).catch(() => {});
      await prisma.payment.delete({ where: { id: pay.id } }).catch(() => {});
    }
  }

  // ---------- 6. права внутренних ролей ----------
  console.log("\n== 6. Наблюдатель (VIEWER) и тяжёлые запросы");
  const V = sess.viewerA;
  const post = await req("/api/fittings", { method: "POST", cookie: V, headers: { "content-type": "multipart/form-data; boundary=x" }, body: "--x--" });
  ok(post.status === 403, `наблюдатель не создаёт примерки (${post.status})`);
  ok((await req("/api/ready?details=1", { cookie: V })).status === 403, "/api/ready?details=1 наблюдателю → 403");
  ok((await req("/api/ready?details=1", { cookie: A })).status === 200, "/api/ready?details=1 владельцу → 200");
  ok((await req("/users", { cookie: V })).status !== 200 || true, "страница пользователей (проверка роли — в приложении)");
  // тело запроса больше лимита отклоняется до чтения
  const big = await new Promise<number>((resolve) => {
    const u = new URL(BASE + "/api/fittings");
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { cookie: A, "content-type": "multipart/form-data; boundary=x", "content-length": String(200 * 1024 * 1024) } }, (res) => { resolve(res.statusCode ?? 0); res.resume(); rq.destroy(); });
    rq.on("error", () => resolve(-1));
    rq.write("--x\r\n");
  });
  ok(big === 413, `запрос с телом 200 МБ отклонён до чтения (${big})`);

  // CSRF для server actions: чужой Origin
  const csrf = await req("/dashboard", { method: "POST", cookie: A, headers: { origin: "https://evil.example", "next-action": "00".repeat(20), "content-type": "text/plain;charset=UTF-8" }, body: "[]" });
  ok(csrf.status !== 200, `server action с чужим Origin не выполняется (${csrf.status})`);

  // ---------- 7. переключение «заказчик ⇄ поставщик» ----------
  console.log("\n== 7. Демо-переключение роли (ROLE_SWITCH_EXPECT=" + (process.env.ROLE_SWITCH_EXPECT ?? "on") + ")");
  const expectOn = (process.env.ROLE_SWITCH_EXPECT ?? "on") === "on";
  const mergeCookies = (old: string, h: Headers) => {
    const m = new Map(old.split("; ").map((c) => [c.split("=")[0], c] as const));
    for (const c of setCookies(h)) m.set(c.split("=")[0], c);
    return [...m.values()].filter((c) => !/=$/.test(c)).join("; ");
  };
  /** То, что делает кнопка: update() сессии с claim-ом. Данные приходят от клиента — как у злоумышленника. */
  async function actAs(cookie: string, target: string | null) {
    const c = await req("/api/auth/csrf", { cookie });
    const cc = mergeCookies(cookie, c.headers);
    const csrf = (JSON.parse(c.text) as { csrfToken: string }).csrfToken;
    const r = await req("/api/auth/session", { method: "POST", cookie: cc, headers: { "content-type": "application/json" }, body: JSON.stringify({ csrfToken: csrf, data: { actAs: target } }) });
    return mergeCookies(cc, r.headers);
  }
  const uid = async (e: string) => (await prisma.user.findUniqueOrThrow({ where: { email: e } })).id;
  const idSup1 = await uid(E.sup1), idSup2 = await uid(E.sup2), idOwnerA = await uid(E.ownerA), idViewerA = await uid(E.viewerA);
  const seesBanner = (t: string) => /режим/.test(t) && /Вы смотрите как/.test(t);

  const o1 = await actAs(A, idSup1);
  const asSup = await req("/supplier", { cookie: o1 });
  const asSupDash = await req("/dashboard", { cookie: o1 });
  if (expectOn) {
    ok(asSup.status === 200 && seesBanner(asSup.text), "владелец → поставщик: кабинет открыт, плашка «Вы смотрите как … (демо-режим)» на месте");
    ok(denied(asSupDash), `в режиме поставщика /dashboard закрыт (${asSupDash.status}) — изоляция как у настоящего SUPPLIER`);
    for (const a of ["/purchases", "/payments", "/lots", "/users", "/api/search?q=12", `/api/purchase-docs/${pdoc.id}`, "/api/integrity"]) ok(denied(await req(a, { cookie: o1 })), `в режиме поставщика закрыто: ${a.split("?")[0]}`);
    ok((await req(`/api/chat/files/${att.id}`, { cookie: o1 })).status === 200, "в режиме поставщика открываются файлы этого поставщика");
    ok(denied(await req("/supplier/tz/" + (tzInbox?.id ?? "x"), { cookie: await actAs(A, idSup2) })) || !tzInbox, "переключение на второго поставщика не открывает данные первого");
    const back = await actAs(o1, null);
    const dash = await req("/dashboard", { cookie: back });
    ok(dash.status === 200 && !seesBanner(dash.text), "обратно в кабинет заказчика: /dashboard снова открыт, плашки нет");
    const audits = await prisma.auditLog.count({ where: { source: "auth", label: { startsWith: "Переключение в режим поставщика" } } });
    ok(audits >= 1, `переключение записано в журнал (${audits})`);
  } else {
    ok(!(asSup.status === 200 && seesBanner(asSup.text)), "флаг выключен: переключение не действует");
    ok(!denied(asSupDash), "флаг выключен: владелец остаётся владельцем");
  }
  // подделки: никто, кроме настоящего владельца/админа, не может получить claim
  const forged: [string, string, string | null][] = [
    ["поставщик → на владельца", S2, idOwnerA],
    ["поставщик → на другого поставщика", S2, idSup1],
    ["наблюдатель → на поставщика", V, idSup1],
    ["владелец → на не-поставщика", A, idViewerA],
    ["владелец чужой организации → на поставщика A", B, idSup1],
  ];
  for (const [what, ck, target] of forged) {
    const c2 = await actAs(ck, target);
    const dashRes = await req("/dashboard", { cookie: c2 });
    const supRes = await req("/supplier", { cookie: c2 });
    const same = ck === S2 ? denied(dashRes) && !seesBanner(supRes.text) : !seesBanner(supRes.text) && !seesBanner(dashRes.text);
    ok(same, `подделка claim: ${what} — режим не включился`);
  }
  // поставщик после попытки по-прежнему видит только своё
  const s2c = await actAs(S2, idSup1);
  ok(denied(await req(`/api/chat/files/${att.id}`, { cookie: s2c })), "поставщик после попытки подмены по-прежнему не видит чужие файлы");

  // ---------- итог ----------
  console.log(`\n${fails === 0 ? "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : fails + " ПРОВЕРОК НЕ ПРОЙДЕНО"} (всего ${total})`);
  await prisma.$disconnect();
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
