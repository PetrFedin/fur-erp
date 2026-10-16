/**
 * Фото артикулов, ссылки «Товар в магазине» и PLU (HE…) из выгрузки «подтянуть ссылки с сайта.xlsx» — решение владельца 16.10.2026.
 * Миграции не требуется: фото — файлы в UPLOAD_DIR/article-photos + SystemState (src/lib/article-photos.ts), PLU — «Свои параметры артикула».
 * По умолчанию — пробный прогон (БД и файлы не меняются).
 *
 *   TSX="node --conditions=react-server --env-file=.env node_modules/.bin/tsx"
 *   $TSX scripts/import-article-photos-2026-10-16.ts                      # сопоставление + отчёт (БД не меняется)
 *   $TSX scripts/import-article-photos-2026-10-16.ts --fetch              # скачать страницы и фото в docs-inventory/article-photos-cache (БД не трогает, 1 стр./с, 2 фото/с)
 *   $TSX scripts/import-article-photos-2026-10-16.ts --apply [--live]     # внести (на боевой — сам делает bash scripts/backup.sh)
 *   $TSX scripts/import-article-photos-2026-10-16.ts --rollback --apply [--live]
 *
 * Правила: сопоставление только при 100% совпадении кода артикула (src/lib/article-photo-match.ts); страница магазина обязана
 * подтвердить артикул (JSON-LD mpn = Article из файла), иначе пара в список «не внесено». PLU — только коды HE… (кириллица НЕ → HE).
 * Существующие значения не перезаписываются. Журнал отката: docs-inventory/article-photos-journal-2026-10-16.json.
 * robots.txt магазина разрешает /product/ для всех агентов; запросы вежливые, сертификаты проверяются как обычно.
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const FETCH = process.argv.includes("--fetch");
const ACTOR = "script:article-photos";
const ROOT = join(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const SRC_JSON = join(INV, "article-photo-links.json");
const CACHE = join(INV, "article-photos-cache");
const JOURNAL = join(INV, "article-photos-journal-2026-10-16.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = { row: number; article: string; itemId: string; conf: number | null; deliv: number | null; url: string | null };
type PageCache = { url: string; mpn: string; sku: string; images: { src: string; n: number }[]; fetchedAt: string };
type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  models: { modelId: string; name: string; keys: string[]; files: string[]; attrsBefore: unknown; attrsAfter: unknown }[];
};

const slugOf = (url: string) => /\/product\/([^/?#]+)/.exec(url)?.[1] ?? "";
const cacheDir = (url: string) => join(CACHE, slugOf(url));

function allowedByRobots(url: string): boolean {
  const u = new URL(url);
  return u.hostname === "www.tsum.ru" && u.pathname.startsWith("/product/") && !/vetements-|agent-provocateur/.test(u.pathname) && !u.search;
}

async function fetchOne(url: string, prepared: { mpn: string }[]) {
  const { normArticle } = await import("../src/lib/article-photo-match");
  void normArticle; void prepared;
  const dir = cacheDir(url);
  const pageFile = join(dir, "page.json");
  if (existsSync(pageFile)) return "в кэше";
  if (!allowedByRobots(url)) return "robots.txt не разрешает";
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" }, redirect: "follow" });
  if (!res.ok) return `страница: HTTP ${res.status}`;
  const html = await res.text();
  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).find((j) => j && j["@type"] === "Product");
  const st = /<script id="__INITIAL_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!ld || !st) return "страница без данных товара";
  const state = JSON.parse(st[1]);
  const slug = slugOf(url);
  const prodMap = state?.product?.product ?? {};
  const prod = prodMap[slug]?.product ?? Object.values<{ product?: unknown }>(prodMap)[0]?.product;
  const imgs: Record<string, string>[] = (prod as { images?: Record<string, string>[] } | undefined)?.images ?? [];
  const chosen = imgs.map((im) => im.w2000 || im.w1320 || im.large).filter(Boolean);
  if (!chosen.length) return "фото в странице не найдены";
  mkdirSync(dir, { recursive: true });
  const sharp = (await import("sharp")).default;
  const saved: { src: string; n: number }[] = [];
  let n = 0;
  for (const raw of chosen) {
    await sleep(500);
    const u = raw.startsWith("//") ? "https:" + raw : raw.startsWith("http") ? raw : "https://st-cdn.tsum.com" + raw;
    const r = await fetch(u, { headers: { "User-Agent": UA, Referer: "https://www.tsum.ru/" } });
    if (!r.ok) { console.log(`  фото HTTP ${r.status}: ${u.slice(-60)}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    n += 1;
    const nn = String(n).padStart(2, "0");
    await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, `${nn}.jpg`));
    await sharp(buf).rotate().resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 76 }).toFile(join(dir, `${nn}-t.jpg`));
    saved.push({ src: u.replace(/\/sig\/[0-9a-f]+\//, "/").slice(-80), n });
  }
  const page: PageCache = { url, mpn: String(ld.mpn ?? ""), sku: String(ld.sku ?? ""), images: saved, fetchedAt: new Date().toISOString() };
  writeFileSync(pageFile, JSON.stringify(page, null, 1));
  return `фото ${saved.length}`;
}

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { matchArticle, normArticle, normalizePlu, pluParamName } = await import("../src/lib/article-photo-match");
  const { readParams, validateParam, writeArticleParams } = await import("../src/lib/article-params");
  const { PHOTOS_KEY, LINKS_KEY } = await import("../src/lib/article-photos");
  const { UPLOAD_ROOT } = await import("../src/lib/fitting-files");
  const prisma = createAuditedClient(ACTOR);
  const url = process.env.DATABASE_URL ?? "";
  const isLive = /\/fur_erp(\?|$)/.test(url);
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const orgId = org.id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; файлы: ${UPLOAD_ROOT}; режим: ${ROLLBACK ? "откат" : FETCH ? "загрузка в кэш" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Это боевая база: нужен флаг --live (сам сделает бэкап). Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы перед записью: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); };

  // ----- Откат -----
  if (ROLLBACK) {
    const j: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    console.log(`Откат: артикулов ${j.models.length}, файлов ${j.models.reduce((a, m) => a + m.files.length, 0)}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      if (isLive) backup();
      for (const m of j.models) {
        await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: { in: m.keys } } });
        const cur = await prisma.productModel.findUnique({ where: { id: m.modelId }, select: { attributes: true } });
        if (cur && JSON.stringify(cur.attributes) === JSON.stringify(m.attrsAfter)) await writeArticleParams(prisma, orgId, m.modelId, readParams(m.attrsBefore), false);
        else if (cur) console.log(`  ${m.name}: свойства менялись после скрипта — PLU не откатываю, проверьте вручную`);
        for (const f of m.files) rmSync(join(UPLOAD_ROOT, f), { force: true });
        if (m.files.length) { try { rmSync(dirname(join(UPLOAD_ROOT, m.files[0])), { recursive: false }); } catch { /* каталог не пуст или уже нет */ } }
      }
      writeFileSync(JOURNAL, JSON.stringify({ ...j, status: "rolled-back", at: new Date().toISOString() }, null, 1));
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  // ----- Сопоставление -----
  const rows: Row[] = JSON.parse(readFileSync(SRC_JSON, "utf8"));
  const models = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, salesCode: true, aliases: true, attributes: true } });
  const orders = await prisma.productionOrder.groupBy({ by: ["productModelId"], where: { organizationId: orgId, status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { plannedQuantity: true, producedQuantity: true } });
  const prod = new Map(orders.map((o) => [o.productModelId, { tz: o._count._all, planned: Number(o._sum.plannedQuantity ?? 0), produced: Number(o._sum.producedQuantity ?? 0) }]));
  const byId = new Map(models.map((m) => [m.id, m]));
  type M = { row: Row; modelId?: string; variant: string; by?: string; plu: string | null; why?: string };
  const matched: M[] = rows.map((r) => {
    const m = matchArticle(r.article, models);
    return m.ok ? { row: r, modelId: m.modelId, variant: m.variant, by: m.by, plu: normalizePlu(r.itemId) } : { row: r, variant: "", plu: normalizePlu(r.itemId), why: m.reason };
  });
  const ok = matched.filter((x) => x.modelId);
  const bad = matched.filter((x) => !x.modelId);

  console.log("\n## Сопоставление строк файла (после шапки): строк " + rows.length + ", сопоставлено " + ok.length + ", нет в базе/неоднозначно " + bad.length);
  console.log("| стр. | артикул (файл) | артикул в базе | вариант | ItemID | PLU | ссылка | ТЗ | произведено, шт. |\n|---|---|---|---|---|---|---|---|---|");
  for (const x of matched) {
    const p = x.modelId ? prod.get(x.modelId) : undefined;
    console.log(`| ${x.row.row} | ${x.row.article} | ${x.modelId ? byId.get(x.modelId)!.name : "НЕТ: " + x.why} | ${x.variant || "—"} | ${x.row.itemId} | ${x.plu ?? "—"} | ${x.row.url ?? "—"} | ${p?.tz ?? 0} | ${p ? p.produced : 0} |`);
  }

  // PLU по артикулам и вариантам
  const pluBy = new Map<string, Map<string, Set<string>>>(); // modelId -> variant -> PLU
  const pluOwner = new Map<string, string>(); // PLU -> modelId|variant
  const problems: string[] = [];
  for (const x of ok) if (x.plu) {
    const owner = `${x.modelId}|${x.variant}`;
    const prev = pluOwner.get(x.plu);
    if (prev && prev !== owner) { problems.push(`PLU ${x.plu} относится к разным артикулам/вариантам: ${prev} и ${owner} — не вношу`); continue; }
    pluOwner.set(x.plu, owner);
    const v = pluBy.get(x.modelId!) ?? new Map<string, Set<string>>();
    (v.get(x.variant) ?? v.set(x.variant, new Set()).get(x.variant)!).add(x.plu);
    pluBy.set(x.modelId!, v);
  }
  const forbidden = new Set(problems.map((p) => /PLU (HE\d+)/.exec(p)?.[1]).filter(Boolean) as string[]);
  const attrsPlan = new Map<string, { before: unknown; after: { name: string; value: string }[] }>();
  for (const [mid, variants] of pluBy) {
    const multi = variants.size > 1;
    const cur = readParams(byId.get(mid)!.attributes);
    const next = [...cur];
    for (const [variant, set] of variants) {
      const list = [...set].filter((p) => !forbidden.has(p));
      if (!list.length) continue;
      const name = pluParamName(variant, multi);
      const r = validateParam(name, list.join(", "));
      if ("error" in r) { problems.push(`${byId.get(mid)!.name}: ${r.error} (${name})`); continue; }
      const i = next.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) { if (next[i].value !== r.param.value) problems.push(`${byId.get(mid)!.name}: свойство «${name}» уже есть со значением «${next[i].value}» — не перезаписываю (было бы «${r.param.value}»)`); continue; }
      next.push(r.param);
    }
    if (next.length > cur.length) attrsPlan.set(mid, { before: byId.get(mid)!.attributes, after: next });
  }
  console.log(`\n## PLU: артикулов ${attrsPlan.size}, свойств добавится ${[...attrsPlan.values()].reduce((a, v) => a + v.after.length - readParams(v.before).length, 0)}`);
  for (const [mid, v] of attrsPlan) console.log(`  ${byId.get(mid)!.name}: ${v.after.filter((p) => /^PLU/.test(p.name)).map((p) => `${p.name}=${p.value}`).join("; ")}`);

  // ссылки и фото
  const withUrl = ok.filter((x) => x.row.url);
  const urls = [...new Set(withUrl.map((x) => x.row.url!))];
  console.log(`\n## Ссылок на товары у сопоставленных строк: ${withUrl.length} (уникальных ${urls.length}), артикулов ${new Set(withUrl.map((x) => x.modelId)).size}`);

  if (FETCH) {
    mkdirSync(CACHE, { recursive: true });
    let i = 0;
    for (const u of urls) {
      i += 1;
      let st = "";
      try { st = await fetchOne(u, []); } catch (e) { st = "ошибка: " + (e as Error).message; }
      console.log(`[${i}/${urls.length}] ${slugOf(u)}: ${st}`);
      if (st !== "в кэше") await sleep(1000);
    }
    await prisma.$disconnect();
    return;
  }

  const photoPlan = new Map<string, { links: { variant: string; itemId: string; url: string }[]; files: { cache: string; variant: string }[] }>();
  const notDone: string[] = bad.map((x) => `стр. ${x.row.row} «${x.row.article}»: ${x.why}`);
  for (const x of withUrl) {
    const page: PageCache | null = existsSync(join(cacheDir(x.row.url!), "page.json")) ? JSON.parse(readFileSync(join(cacheDir(x.row.url!), "page.json"), "utf8")) : null;
    if (!page) { notDone.push(`стр. ${x.row.row} ${x.row.url}: страница не загружена (--fetch)`); continue; }
    const sameArt = (a: string, b: string) => normArticle(a).replace(/\s*\/\s*/g, "/") === normArticle(b).replace(/\s*\/\s*/g, "/"); // пробелы вокруг «/» не считаются отличием
    if (!sameArt(page.mpn, x.row.article)) { notDone.push(`стр. ${x.row.row} ${x.row.url}: артикул на странице «${page.mpn}» ≠ «${x.row.article}» — не вношу`); continue; }
    const slugSku = slugOf(x.row.url!).split("-")[0].toUpperCase();
    if (page.sku.toUpperCase() !== slugSku) { notDone.push(`стр. ${x.row.row} ${x.row.url}: код на странице ${page.sku} ≠ ссылке ${slugSku} — не вношу`); continue; }
    const plan = photoPlan.get(x.modelId!) ?? { links: [], files: [] };
    plan.links.push({ variant: x.variant, itemId: page.sku.toUpperCase(), url: x.row.url!.replace(/\/?$/, "/") });
    for (const im of page.images) plan.files.push({ cache: join(cacheDir(x.row.url!), String(im.n).padStart(2, "0")), variant: x.variant });
    photoPlan.set(x.modelId!, plan);
  }
  console.log(`\n## Фото к внесению: артикулов ${photoPlan.size}, ссылок ${[...photoPlan.values()].reduce((a, p) => a + p.links.length, 0)}, фото ${[...photoPlan.values()].reduce((a, p) => a + p.files.length, 0)}`);
  for (const [mid, p] of photoPlan) console.log(`  ${byId.get(mid)!.name}: ссылок ${p.links.length}, фото ${p.files.length}`);
  if (notDone.length) { console.log("\n## Не внесено / не сопоставлено"); notDone.forEach((s) => console.log("  - " + s)); }

  // Проверки перед записью
  const prev: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
  if (prev && prev.status === "applied") problems.push("журнал уже содержит применённое внесение — сначала --rollback --apply");
  for (const mid of photoPlan.keys()) {
    const exists = await prisma.systemState.findFirst({ where: { organizationId: orgId, key: { in: [PHOTOS_KEY + mid, LINKS_KEY + mid] } }, select: { key: true } });
    if (exists) problems.push(`${byId.get(mid)!.name}: фото/ссылки уже есть (${exists.key}) — скрипт не дублирует`);
  }
  if (problems.length) { console.log("\n## ПРОБЛЕМЫ"); problems.forEach((s) => console.log("  - " + s)); }
  if (!APPLY) { console.log("\nПробный прогон: БД и файлы не менялись. Для записи — --apply (на боевой ещё --live)."); await prisma.$disconnect(); return; }
  if (problems.some((p) => /журнал уже|фото\/ссылки уже/.test(p))) { console.log("Запись невозможна."); process.exitCode = 1; await prisma.$disconnect(); return; }

  // ----- Применение -----
  if (isLive) backup();
  const sharp = (await import("sharp")).default;
  const journal: Journal = { script: "import-article-photos-2026-10-16.ts", status: "applied", at: new Date().toISOString(), models: [] };
  const touched = new Set([...photoPlan.keys(), ...attrsPlan.keys()]);
  for (const mid of touched) {
    const entry = { modelId: mid, name: byId.get(mid)!.name, keys: [] as string[], files: [] as string[], attrsBefore: byId.get(mid)!.attributes ?? null, attrsAfter: byId.get(mid)!.attributes ?? null as unknown };
    const plan = photoPlan.get(mid);
    if (plan) {
      const dirRel = join("article-photos", orgId, mid);
      mkdirSync(join(UPLOAD_ROOT, dirRel), { recursive: true });
      const photos: { id: string; file: string; thumb: string; w: number; h: number; variant: string }[] = [];
      for (const f of plan.files) {
        const id = randomUUID();
        const file = join(dirRel, `${id}.jpg`), thumb = join(dirRel, `${id}-t.jpg`);
        copyFileSync(`${f.cache}.jpg`, join(UPLOAD_ROOT, file));
        copyFileSync(`${f.cache}-t.jpg`, join(UPLOAD_ROOT, thumb));
        entry.files.push(file, thumb);
        const meta = await sharp(join(UPLOAD_ROOT, file)).metadata();
        photos.push({ id, file, thumb, w: meta.width ?? 0, h: meta.height ?? 0, variant: f.variant });
      }
      await prisma.systemState.create({ data: { organizationId: orgId, key: PHOTOS_KEY + mid, value: { photos } } });
      await prisma.systemState.create({ data: { organizationId: orgId, key: LINKS_KEY + mid, value: { links: plan.links } } });
      entry.keys.push(PHOTOS_KEY + mid, LINKS_KEY + mid);
    }
    const a = attrsPlan.get(mid);
    if (a) { await writeArticleParams(prisma, orgId, mid, a.after, false); entry.attrsAfter = (await prisma.productModel.findUniqueOrThrow({ where: { id: mid }, select: { attributes: true } })).attributes; }
    journal.models.push(entry);
    mkdirSync(INV, { recursive: true });
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // журнал после каждого артикула: сбой посередине не теряет уже сделанное
  }
  console.log(`Внесено: артикулов ${journal.models.length}. Журнал: ${JOURNAL}`);
  void readdirSync;
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
