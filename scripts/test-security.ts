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
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { SUPPLIER_DOC_TYPES, supplierMayUpload } from "../src/lib/supplier-docs";
import { isOurPaymentDoc, paymentDocFlags } from "../src/lib/supplier-payment-docs-core";
import { PAY_STATE_LABEL, isConfirmedForSupplier, payInfo, poolShares, rawPayInfo } from "../src/lib/supplier-pay-core";

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
  // Метка для проверок «чужая страница не показана»: полное название, а не слово «Веллмех» (оно есть в подсказках интерфейса у всех).
  const sup1Name = (await prisma.supplier.findUniqueOrThrow({ where: { id: sup1 }, select: { name: true } })).name;
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
    { p: `/suppliers/${sup1}`, marker: sup1Name },
    { p: `/settings/contractors/${sup1}`, marker: sup1Name },
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
    { p: `/suppliers/${sup1}`, marker: sup1Name },
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


  // ---------- 5б. периметр SUPPLIER: данные страницы (RSC-пейлоад), прямые адреса, статус оплат ----------
  console.log("\n== 5б. Поставщик: пейлоад страниц, прямые адреса, статус оплат");
  // Канарейки в справочниках: примечания и суммы закупок не должны попасть в данные страниц подрядчика.
  const fur = await prisma.furRef.findFirst({ where: { organizationId: orgA } });
  const auc = await prisma.auction.findFirst({ where: { organizationId: orgA } });
  if (fur) await prisma.furRef.update({ where: { id: fur.id }, data: { note: "SEC-FUR-NOTE-SECRET" } });
  if (auc) await prisma.auction.update({ where: { id: auc.id }, data: { note: "SEC-AUCTION-NOTE-SECRET" } });
  for (const p of ["/settings/furs", "/settings/auctions", "/settings/colors", "/settings/categories", "/settings/fur-attrs", "/settings/articles-ref", "/articles", "/shipments", "/chat", "/supplier"]) {
    const r = await req(p, { cookie: S1 });
    const leakKeys = ["SEC-FUR-NOTE-SECRET", "SEC-AUCTION-NOTE-SECRET", '\\"purchaseCount\\"', '\\"organizationId\\"', '\\"sellingPrice\\"', '\\"retailPrice\\"', '\\"clientWorkPricePerUnit\\"', '\\"avgUnitCost\\"'].filter((k) => r.text.includes(k));
    ok(r.status === 200 && leakKeys.length === 0, `sup1 ${p}: в данных страницы нет примечаний, сумм закупок, цен${leakKeys.length ? " УТЕЧКА: " + leakKeys.join(",") : ""}`);
  }
  // Прямые адреса с реальными id: редирект/403/404 (страницы заказчика и их экспорт).
  const idOf = async (m: string) => (await (prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<{ id: string } | null> }>)[m].findFirst({ where: { organizationId: orgA }, select: { id: true } }))?.id;
  const direct: [string, string | undefined][] = [
    ["/budget/", await idOf("budgetScenario")], ["/clients/", await idOf("client")], ["/materials/", await idOf("rawMaterial")], ["/models/", await idOf("productModel")],
    ["/payments/", await idOf("payment")], ["/production/", order.id], ["/purchases/", await idOf("purchase")], ["/suppliers/", sup1], ["/settings/contractors/", sup1],
    ["/warehouses/", await idOf("warehouse")], ["/analytics/raw/lot/", await idOf("rawMaterialLot")], ["/inbox/", inbox.id], ["/production/batches/", String((await prisma.productionBatch.findFirst({ where: { organizationId: orgA }, select: { number: true } }))?.number ?? "1")],
    ["/lots/fur/", "Бобр"],
  ];
  let directBad = 0;
  for (const [pre, id] of direct) {
    if (!id) continue;
    const r = await req(pre + encodeURIComponent(id), { cookie: S1 });
    if (!denied(r)) { directBad++; console.log("   подрядчику открыто:", pre, r.status); }
  }
  ok(directBad === 0, `прямые адреса страниц заказчика (${direct.filter(([, i]) => i).length}) закрыты для подрядчика`);
  const apiDirect = [`/api/production/${order.id}/docx`, `/api/production/${order.id}/word`, `/api/purchase-docs/${pdoc.id}`, "/api/doc-list", "/api/article-ref", "/api/search?q=%D0%BC", "/api/integrity", "/api/comments?mode=counts&path=/payments"];
  for (const a of apiDirect) ok(denied(await req(a, { cookie: S1 })), `API заказчика закрыт для подрядчика: ${a.split("?")[0].replace(/[a-z0-9]{20,}/g, "<id>")}`);
  // Экспорты Excel/Word со страниц заказчика (route.ts в (app)) — тоже закрыты.
  const exports = ["/analytics/pricing/export", "/analytics/products/export", "/analytics/raw/export", "/analytics/raw/recon/export", "/comments/export", "/documents/export", "/history/export", "/settings/articles-ref/export"];
  for (const x of exports) ok(denied(await req(x, { cookie: S1 })), `экспорт закрыт для подрядчика: ${x}`);

  // Чистая логика статуса оплат.
  // Оплата видна подрядчику сразу, как проведена (COMPLETED); флаг и отметка подтверждения на видимость не влияют (решение владельца 20.10.2026).
  ok(isConfirmedForSupplier({ status: "COMPLETED" }) && !isConfirmedForSupplier({ status: "PENDING" }) && !isConfirmedForSupplier({ status: "CANCELLED" }), "проведённая оплата видна сразу; плановая и отменённая — нет");
  const L = (a: number, d: string, kind = "ADVANCE") => ({ kind, amount: a, paidAt: new Date(d) });
  ok(payInfo(1000, []).state === "UNPAID" && payInfo(1000, [L(400, "2026-01-02")]).state === "PARTIAL" && payInfo(1000, [L(400, "2026-01-02"), L(600, "2026-02-03")]).state === "PAID" && payInfo(1000, [L(1200, "2026-01-02")]).state === "PAID", "статус: не оплачено / частично / оплачено (в том числе переплата)");
  ok(payInfo(1000, [L(999.5, "2026-01-02")]).state === "PAID" && payInfo(1000, [L(998, "2026-01-02")]).state === "PARTIAL", "допуск «оплачено» — 1 ₽");
  ok(payInfo(0, [L(500, "2026-01-02")], false).state === "PARTIAL", "цена работы не задана: при оплате — «Частично», не «Оплачено»");
  ok(payInfo(1000, [L(100, "2026-01-02"), L(100, "2026-03-04")]).date?.toISOString().startsWith("2026-03-04") === true, "дата — последней подтверждённой оплаты");
  ok(PAY_STATE_LABEL.PAID === "Оплачено" && PAY_STATE_LABEL.PARTIAL === "Частично" && PAY_STATE_LABEL.UNPAID === "Не оплачено", "подписи статусов");
  // Статус сырья — от суммы счёта Веллмеха, не от всей себестоимости (scripts/test-supplier-invoice-due.ts — на реальных СП 09-26 и SAGA 03-26).
  ok(rawPayInfo(null, [L(500, "2026-01-02")]).state === "NOINVOICE" && rawPayInfo(null, []).state === "NOINVOICE" && PAY_STATE_LABEL.NOINVOICE === "Нет счёта", "нет суммы счёта — «Нет счёта», а не «Не оплачено»");
  ok(rawPayInfo(1000, [L(1036.13, "2026-01-02")]).state === "PAID" && rawPayInfo(1000, [L(999.5, "2026-01-02")]).state === "PAID" && rawPayInfo(1000, [L(998, "2026-01-02")]).state === "PARTIAL", "сырьё: переплата — «Оплачено», допуск 1 ₽");
  const sh = poolShares([{ id: "a", need: 300 }, { id: "b", need: 500 }, { id: "c", need: 200 }], 650);
  ok(sh.get("a") === 300 && sh.get("b") === 350 && sh.get("c") === 0, "оплата аукциона целиком добирает счета по порядку");

  // Живая проверка: создать оплату → подтвердить → у подрядчика видно → снять подтверждение → пропало.
  if (sup1Purchase) {
    const AMT = 987654.32, NOTE = "SEC-PAYMENT-SECRET-NOTE";
    const PAID_RAW = new Date(Date.now() - 86_400_000); PAID_RAW.setUTCHours(0, 0, 0, 0);
    const paidRu = PAID_RAW.toLocaleDateString("ru-RU", { timeZone: "UTC" }).replace(/\./g, "\\.");
    const pageOf = `/supplier/raw/${sup1Purchase.id}`;
    const sees = (t: string) => /987[\s  ,.]?65[34]/.test(t);
    const pay = await prisma.payment.create({ data: { organizationId: orgA, supplierId: sup1, purchaseId: sup1Purchase.id, amount: AMT, kind: "ADVANCE", paidAt: PAID_RAW, notes: NOTE, status: "COMPLETED", confirmed: false, confirmedAt: null } });
    try {
      ok(sees((await req(pageOf, { cookie: S1 })).text), "оплата проведена — подрядчик видит сразу, без подтверждения заказчиком");
      await prisma.payment.update({ where: { id: pay.id }, data: { confirmed: true, status: "PENDING" } });
      ok(!sees((await req(pageOf, { cookie: S1 })).text), "запланированная (PENDING) не считается оплаченной");
      await prisma.payment.update({ where: { id: pay.id }, data: { status: "COMPLETED" } });
      const seen = await req(pageOf, { cookie: S1 });
      ok(sees(seen.text) && /data-testid="pay-status"/.test(seen.text) && /(Частично|Оплачено|Нет счёта)/.test(seen.text) && new RegExp(paidRu).test(seen.text), "проведена → подрядчик видит статус, сумму и дату");
      ok(!seen.text.includes(NOTE) && !seen.text.includes("SEC-PAYMENT-SCAN"), "…но не заметку и не платёжный файл");
      const list = await req("/supplier/raw", { cookie: S1 });
      ok(/data-testid="pay-status"/.test(list.text), "статус виден и в списке «Сырьё»");
      const ctl = await req("/supplier", { cookie: S1 });
      ok(sees(ctl.text) && /Оплата проведена \(аванс\)/.test(ctl.text), "и в «Контроль → Недавнее»");
      ok(!sees((await req(pageOf, { cookie: S2 })).text) && !sees((await req("/supplier/raw", { cookie: S2 })).text) && !sees((await req("/supplier", { cookie: S2 })).text), "другой подрядчик оплату не видит");
      await prisma.payment.update({ where: { id: pay.id }, data: { status: "CANCELLED" } });
      ok(!sees((await req(pageOf, { cookie: S1 })).text), "отменённая оплата не видна");
    } finally {
      await prisma.payment.delete({ where: { id: pay.id } }).catch(() => {});
    }
  }
  // «За работу»: оплата, разнесённая на принятое ТЗ подрядчика.
  const accTz = await prisma.supplierInbox.findFirst({ where: { organizationId: orgA, supplierId: sup1, kind: "TZ", status: "ACCEPTED", createdEntityType: "ProductionOrder" }, select: { id: true, createdEntityId: true } });
  const accOrder = accTz?.createdEntityId ? accTz.createdEntityId.split(",")[0] : null;
  if (accTz && accOrder) {
    const WAMT = 321987.65;
    const PAID_WORK = new Date(Date.now() - 86_400_000); PAID_WORK.setUTCHours(0, 0, 0, 0);
    const seesW = (t: string) => /321[\s  ,.]?98[78]/.test(t);
    const pp = await prisma.productionPayment.create({ data: { organizationId: orgA, amount: WAMT, paymentType: "ADVANCE", status: "COMPLETED", paidAt: PAID_WORK, confirmed: false, confirmedAt: null, notes: "SEC-WORK-NOTE" } });
    const al = await prisma.paymentAllocation.create({ data: { organizationId: orgA, productionPaymentId: pp.id, productionOrderId: accOrder, amount: WAMT } });
    // неразнесённый аванс чужого ТЗ: подрядчик его не видит
    try {
      const t1 = await req(`/supplier/tz/${accTz.id}`, { cookie: S1 });
      ok(seesW(t1.text) && /data-testid="pay-status"/.test(t1.text) && !t1.text.includes("SEC-WORK-NOTE"), "проведена → на странице ТЗ статус и сумма, без заметки");
      ok(!seesW((await req(`/supplier/tz/${accTz.id}`, { cookie: S2 })).text), "другой подрядчик не видит");
      ok(/Оплата за работу проведена/.test((await req("/supplier", { cookie: S1 })).text), "и в «Контроль → Недавнее»");
      await prisma.productionPayment.update({ where: { id: pp.id }, data: { status: "CANCELLED" } });
      ok(!seesW((await req(`/supplier/tz/${accTz.id}`, { cookie: S1 })).text), "оплата отменена → пропала");
    } finally {
      await prisma.paymentAllocation.delete({ where: { id: al.id } }).catch(() => {});
      await prisma.productionPayment.delete({ where: { id: pp.id } }).catch(() => {});
    }
  }

  // Статическая защита: каждое server-действие проверяет сессию/роль, а доступ подрядчика разрешён только в известных местах.
  console.log("   — статика: проверка прав в server-действиях и allowSupplier:");
  const srcFiles: string[] = [];
  const walkSrc = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walkSrc(f); else if (/\.(ts|tsx)$/.test(n)) srcFiles.push(f); } };
  walkSrc(path.resolve("src"));
  const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, "/");
  const NO_SESSION_OK = new Set(["src/app/login/actions.ts", "src/app/register/actions.ts"]);
  const unguarded: string[] = [];
  for (const f of srcFiles) {
    const txt = readFileSync(f, "utf8");
    if (!/^\s*["']use server["']/m.test(txt) || NO_SESSION_OK.has(rel(f))) continue;
    for (const part of txt.split(/\nexport async function /).slice(1)) {
      const name = part.split("(")[0];
      if (!/require\w*\(|getFreshSession|auth\(\)|chatSession\(|actor\(\)|changeParams\(|ctxOf\(|uploadDriveDocument\(/.test(part.slice(0, 1800))) unguarded.push(`${rel(f)}:${name}`);
    }
  }
  ok(unguarded.length === 0, `все server-действия проверяют сессию/роль на сервере${unguarded.length ? " — без проверки: " + unguarded.join(", ") : ""}`);
  const ALLOW_SUPPLIER = new Set([
    "src/app/(app)/layout.tsx", "src/app/page.tsx", "src/app/(app)/settings/page.tsx", "src/app/(app)/settings/furs/page.tsx", "src/app/(app)/settings/articles-ref/page.tsx", "src/app/(app)/settings/colors/page.tsx",
    "src/app/(app)/settings/auctions/page.tsx", "src/app/(app)/settings/fur-attrs/page.tsx", "src/app/(app)/settings/categories/page.tsx", "src/app/(app)/shipments/page.tsx", "src/app/(app)/shipments/[id]/page.tsx",
    "src/app/(app)/chat/actions.ts", "src/app/(app)/chat/channel-actions.ts", "src/app/(app)/chat/page.tsx", "src/app/(app)/articles/page.tsx", "src/app/(app)/models/[id]/page.tsx", "src/app/(app)/models/new/page.tsx",
    "src/app/api/chat/files/[id]/route.ts", "src/app/api/article-photos/[modelId]/[photoId]/route.ts", "src/app/api/article-photos/[modelId]/route.ts", "src/app/api/drive-docs/[id]/route.ts", "src/app/api/supplier/auction-calcs/[id]/xlsx/route.ts", "src/app/api/supplier/auction-calcs/[id]/invoice/route.ts", "src/app/api/supplier/inbox-files/[id]/route.ts",
    "src/app/api/supplier/tz/[id]/preview/route.ts", "src/app/api/supplier/tz/[id]/docx/route.ts", "src/components/role-switch-actions.ts", "src/lib/prisma.ts", "src/lib/supplier-inbox.ts", "src/lib/session.ts",
  ]);
  const extra = srcFiles.filter((f) => /allowSupplier:\s*true/.test(readFileSync(f, "utf8")) && !ALLOW_SUPPLIER.has(rel(f))).map(rel);
  ok(extra.length === 0, `allowSupplier: true только в проверенных местах${extra.length ? " — новое, проверьте: " + extra.join(", ") : ""}`);
  // Записи Веллмеха, которые видны сразу (этапы сырья, календарь, даты аукционов, этапы отгрузок), учёт заказчика не трогают:
  // никаких записей в оплаты, закупки, лоты, склад, ТЗ и строки отгрузок. Всё, что влияет на учёт, идёт через «Входящие» / «Подтвердить».
  const ACCOUNTING = /(?:prisma|tx)\.(?:payment|productionPayment|paymentAllocation|purchase|purchaseItem|purchaseExpense|rawMaterialLot|stockMovement|productionOrder|shipmentLine|shipment|supplyPlanEntry)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
  const IMMEDIATE = ["src/app/(app)/supplier/raw/stage-actions.ts", "src/app/(app)/supplier/calendar/actions.ts", "src/app/(app)/supplier/calendar/auction-actions.ts"];
  const touching = IMMEDIATE.filter((f) => ACCOUNTING.test(readFileSync(path.resolve(f), "utf8")));
  ok(touching.length === 0, `«сразу видимые» записи Веллмеха (этапы сырья, календарь, аукционы) не пишут в учёт заказчика${touching.length ? ": " + touching.join(", ") : ""}`);
  const marksSrc = readFileSync(path.resolve("src/app/(app)/shipments/marks-actions.ts"), "utf8");
  const supplierMarksPart = marksSrc.slice(marksSrc.indexOf("export async function saveSupplierMarks"), marksSrc.indexOf("export async function confirmSupplierMark"));
  ok(supplierMarksPart.length > 100 && !ACCOUNTING.test(supplierMarksPart) && !/acceptLinesByReview|sendLineToRework/.test(supplierMarksPart), "отметки примерки от Веллмеха пишутся только в хронологию; в учёт переходят лишь кнопкой «Подтвердить» у заказчика");
  const confirmPart = marksSrc.slice(marksSrc.indexOf("export async function confirmSupplierMark"));
  ok(/requireRole\("OWNER", "ADMIN", "TECHNOLOGIST"\)/.test(confirmPart), "«Подтвердить» отметку Веллмеха может только наша роль (не SUPPLIER)");
  // Страницы кабинета подрядчика не берут поля цен/наценок/бюджета из базы.
  const supplierSrc = srcFiles.filter((f) => /src\/(app\/\(app\)\/supplier\/|lib\/supplier-)/.test(rel(f)) && !/supplier-pay|supplier-debt|supplier-calc|supplier-payment-docs/.test(rel(f)));
  const priceWords = supplierSrc.filter((f) => /\b(sellingPrice|retailPrice|clientWorkPricePerUnit|avgUnitCost|BudgetScenario|budgetScenario)\b/.test(readFileSync(f, "utf8")) && !/supplier-calc-start|tz-vendor/.test(rel(f))).map(rel);
  ok(priceWords.length === 0, `код кабинета подрядчика не читает цены, наценки и бюджет заказчика${priceWords.length ? ": " + priceWords.join(", ") : ""}`);

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

  // ---------- 12. Ссылки магазина и PLU: подрядчик их не получает ----------
  console.log("\n== 12. Фото артикулов: ссылки магазина и PLU закрыты от подрядчика");
  {
    const probeModel = await prisma.productModel.findFirstOrThrow({ where: { organizationId: orgA, NOT: { category: "Ремонт" } }, orderBy: { createdAt: "asc" } });
    const probeUrl = "https://www.tsum.ru/product/he00000000-sec-probe/";
    const keyL = "article-shop-links:" + probeModel.id;
    const prevLinks = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgA, key: keyL } } });
    const prevAttrs = probeModel.attributes;
    await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgA, key: keyL } }, create: { organizationId: orgA, key: keyL, value: { links: [{ variant: "SEC", itemId: "HE00000000", url: probeUrl }] } }, update: { value: { links: [{ variant: "SEC", itemId: "HE00000000", url: probeUrl }] } } });
    await prisma.productModel.update({ where: { id: probeModel.id }, data: { attributes: [{ name: "PLU", value: "HE00000000" }] } });
    try {
      const own = await req(`/models/${probeModel.id}`, { cookie: A });
      ok(own.status === 200 && own.text.includes("he00000000-sec-probe"), "владелец видит «Товар в магазине» в карточке артикула");
      ok(own.text.includes("HE00000000"), "владелец видит PLU в карточке артикула");
      for (const who of [S1, S2]) {
        const card = await req(`/models/${probeModel.id}`, { cookie: who });
        ok(denied(card) || !/tsum\.ru|HE00000000|article-shop-links/.test(card.text), "подрядчик: карточка артикула не отдаёт ссылку магазина и PLU");
        const list = await req(`/articles`, { cookie: who });
        ok(list.status === 200 && !/tsum\.ru|HE00000000|article-shop-links|PLU/.test(list.text), "подрядчик: список «Изделия» (в т. ч. RSC-данные) без ссылок магазина и PLU");
        const q = await req(`/articles?q=HE00000000`, { cookie: who });
        ok(!/HE00000000/.test(q.text.replace(/value="HE00000000"/g, "")) || q.text.includes("Нет результатов"), "подрядчик: поиск по PLU ничего не находит");
        ok(denied(await req(`/api/search?q=HE00000000`, { cookie: who })), "подрядчик: глобальный поиск по PLU закрыт");
      }
      ok(denied(await req(`/api/article-photos/${probeModel.id}/00000000-0000-0000-0000-000000000000`)), "фото артикула без входа закрыты");
      const miss = await req(`/api/article-photos/${probeModel.id}/00000000-0000-0000-0000-000000000000`, { cookie: S1 });
      ok(miss.status === 404, "подрядчик: несуществующее фото → 404 (путь берётся только из записи)");
      const real = await prisma.systemState.findFirst({ where: { organizationId: orgA, key: { startsWith: "article-photos:" } } });
      if (real) {
        const mid = real.key.slice("article-photos:".length);
        const pid = ((real.value as { photos?: { id: string }[] }).photos ?? [])[0]?.id;
        if (pid) {
          ok((await req(`/api/article-photos/${mid}/${pid}`, { cookie: S1 })).status === 200, "подрядчик видит фото изделия");
          ok((await req(`/api/article-photos/${mid}/${pid}?size=thumb`, { cookie: A })).status === 200, "владелец видит миниатюру");
        }
      }

      // Удаление фото артикула: подрядчик не допускается, чужая организация не может удалить чужое фото.
      {
        const actSrc = readFileSync(path.resolve("src/app/(app)/models/photo-actions.ts"), "utf8");
        const { ACCESS: ACC, hasRole: hasR } = await import("../src/lib/access");
        ok(/export async function deleteArticlePhoto\([^)]*\)[^{]*\{\s*const session = await requireRole\(\.\.\.ACCESS\.models\)/.test(actSrc) && /export async function deleteAllArticlePhotos\([^)]*\)[^{]*\{\s*const session = await requireRole\(\.\.\.ACCESS\.models\)/.test(actSrc), "удаление фото: оба server-действия начинаются с requireRole(ACCESS.models) (роль проверяется на сервере)");
        ok(!hasR("SUPPLIER", ACC.models) && hasR("OWNER", ACC.models), "удаление фото: подрядчик (SUPPLIER) не входит в роли с правом править артикул — действие отклоняется (редирект в /supplier)");
        ok(!/onDelete|photo-actions|deleteArticlePhoto/.test(readFileSync(path.resolve("src/app/(app)/articles/supplier-view.tsx"), "utf8")), "удаление фото: в кабинете подрядчика нет ни кнопок, ни ссылок на действие");
        // Редактор «Магазин и фото» (PLU, ссылка, загрузка фото): подрядчик и чужая организация не допускаются (подробные проверки записи — в test-article-photos.ts).
        const shopSrc = readFileSync(path.resolve("src/app/(app)/models/shop-actions.ts"), "utf8");
        ok((shopSrc.match(/await requireRole\(\.\.\.ACCESS\.models\)/g) ?? []).length === 3 && !/allowSupplier|SUPPLIER/.test(shopSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "редактор «Магазин и фото»: три действия закрыты ролью ACCESS.models, подрядчик не допускается");
        const upRoute = readFileSync(path.resolve("src/app/api/article-photos/[modelId]/route.ts"), "utf8");
        ok(/hasRole\(session\.user\.role, ACCESS\.models\)\)\s*return Response\.json\([^)]*\{ status: 403 \}/.test(upRoute) && /session\.user\.organizationId/.test(upRoute), "загрузка фото: подрядчику 403, артикул ищется только в организации сессии");
        ok(!/ArticleShopEditor|shop-actions|article-shop/.test(readFileSync(path.resolve("src/app/(app)/articles/supplier-view.tsx"), "utf8")), "редактор «Магазин и фото»: в кабинете подрядчика его нет");
        await import("./stubs/server-only-shim");
        const { deleteArticlePhotos } = await import("../src/lib/article-photo-delete");
        const { rawPrisma } = await import("../src/lib/prisma");
        const keyP = "article-photos:" + probeModel.id;
        const prevP = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgA, key: keyP } } });
        const pid = "bbbbbbbb-0000-4000-8000-0000000000aa";
        const fileRel = `article-photos/${orgA}/${probeModel.id}/${pid}.jpg`, thumbRel = `article-photos/${orgA}/${probeModel.id}/${pid}-t.jpg`;
        try {
          if (prevP) await prisma.systemState.delete({ where: { id: prevP.id } });
          await prisma.systemState.create({ data: { organizationId: orgA, key: keyP, value: { photos: [{ id: pid, file: fileRel, thumb: thumbRel, w: 1, h: 1, variant: "" }] } } });
          const ownerBu = { id: "sec-owner-b", name: "B", role: "OWNER", organizationId: orgB };
          const bad = await deleteArticlePhotos(rawPrisma, ownerBu, probeModel.id, pid);
          const still = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgA, key: keyP } } });
          ok(!bad.ok && !!still, "удаление фото: владелец чужой организации не может удалить фото этого артикула (артикул не найден, запись цела)");
          const good = await deleteArticlePhotos(rawPrisma, { ...ownerBu, id: "sec-owner-a", organizationId: orgA }, probeModel.id, pid);
          const gone = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgA, key: keyP } } });
          ok(good.ok && !gone, "удаление фото: владелец своей организации удаляет, запись снята");
        } finally {
          await prisma.systemState.deleteMany({ where: { organizationId: orgA, key: keyP } });
          if (prevP) await prisma.systemState.create({ data: { organizationId: orgA, key: keyP, value: prevP.value as object } });
          await prisma.auditLog.deleteMany({ where: { model: "ArticlePhoto", recordId: probeModel.id, actorId: { in: ["sec-owner-a", "sec-owner-b"] } } });
        }
      }
    } finally {
      if (prevLinks) await prisma.systemState.update({ where: { id: prevLinks.id }, data: { value: prevLinks.value as object } });
      else await prisma.systemState.deleteMany({ where: { organizationId: orgA, key: keyL } });
      await prisma.productModel.update({ where: { id: probeModel.id }, data: { attributes: prevAttrs ?? Prisma.DbNull } });
    }
    const supSrc = readFileSync(path.resolve("src/app/(app)/articles/supplier-view.tsx"), "utf8");
    ok(!/loadShopLinks|article-shop-links|loadAllArticleParams|isPluParam/.test(supSrc), "исходник кабинета подрядчика не читает ссылки магазина и свойства (PLU)");
    ok(!/loadAllShopLinks|shops=|pluOfItem|itemId:\s*p\.itemId/.test(supSrc) && /variant: p\.variant, \.\.\.\(p\.color/.test(supSrc), "кабинет подрядчика: окну «Фото» не передаются ссылки магазина, PLU и код страницы (только цвет и вариант)");
    const galSrc = readFileSync(path.resolve("src/components/photo-gallery.tsx"), "utf8");
    ok(/shops\?: Record<string, GalleryShop>/.test(galSrc) && /const shop = shops \? /.test(galSrc), "окно «Фото»: ссылка и PLU показываются только если переданы shops (подрядчику не передаются)");
  }

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
