/**
 * Цвета фото артикулов — решение владельца 16.10.2026: у каждого фото и каждой ссылки магазина должен быть цвет и код страницы.
 *
 * Как определяется цвет. Страница магазина = один товар = один цвет: на всех 108 загруженных страницах в данных товара ровно один цвет
 * (products[] содержит только сам товар), а images[] — фото именно этого цвета. Поэтому фото чужих цветов внутри варианта не встречаются
 * (отбрасывать и перераскладывать нечего), а фото к варианту относятся по строке файла, по которой найдена ссылка. Скрипт НЕ скачивает фото
 * заново: он проставляет в уже внесённых записях `color` (цвет страницы, запасное название) и `itemId` (страница-источник), чтобы окно «Фото»
 * показывало цвет, PLU и кнопку «Товар в магазине» для текущего фото. Фото к страницам привязываются по порядку внесения и количеству фото
 * страницы (кэш docs-inventory/article-photos-cache) с проверкой варианта; не сошлось — артикул остаётся без привязки (группа «Цвет не определён»).
 *
 *   $TSX scripts/sync-article-photo-colors-2026-10-16.ts                  # пробный прогон: таблица, БД не меняется
 *   $TSX scripts/sync-article-photo-colors-2026-10-16.ts --apply [--live] # записать (на боевую — bash scripts/backup.sh)
 *   $TSX scripts/sync-article-photo-colors-2026-10-16.ts --rollback --apply [--live]
 * Идемпотентно: у записей, где color/itemId уже стоят, ничего не меняется. Журнал отката: docs-inventory/article-photo-colors-journal-2026-10-16.json
 * Исходные данные цветов: docs-inventory/article-photos-colors-cache/<код страницы>.json (получены вежливо, 1 стр./с, как фото).
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const ROOT = join(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL = join(INV, "article-photo-colors-journal-2026-10-16.json");
type J = { script: string; status: "applied" | "rolled-back"; at: string; states: { key: string; before: unknown }[] };
const slugOf = (url: string) => /\/product\/([^/?#]+)/.exec(url)?.[1] ?? "";

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { PHOTOS_KEY, LINKS_KEY, readPhotos, readLinks } = await import("../src/lib/article-photos");
  const { groupPhotosByColor, variantColorName } = await import("../src/lib/article-photo-color");
  const prisma = createAuditedClient("script:article-photo-colors");
  const url = process.env.DATABASE_URL ?? "";
  const isLive = /\/fur_erp(\?|$)/.test(url);
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  console.log(`База: ${/\/([^/?]+)(\?|$)/.exec(url)?.[1]}${isLive ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "цвета"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Это боевая база: нужен флаг --live. Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы перед записью: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); };

  if (ROLLBACK) {
    const j: J | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    console.log(`Откат: записей ${j.states.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      if (isLive) backup();
      for (const s of j.states) await prisma.systemState.update({ where: { organizationId_key: { organizationId: org.id, key: s.key } }, data: { value: s.before as object } });
      writeFileSync(JOURNAL, JSON.stringify({ ...j, status: "rolled-back", at: new Date().toISOString() }, null, 1));
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const refs = await prisma.colorRef.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, aliases: true, note: true } });
  const models = new Map((await prisma.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  const photoRows = await prisma.systemState.findMany({ where: { organizationId: org.id, key: { startsWith: PHOTOS_KEY } }, select: { key: true, value: true } });
  const siteColor = (slug: string): string | null => { const f = join(INV, "article-photos-colors-cache", slug + ".json"); return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")).color?.title ?? null) : null; };
  const pageImages = (slug: string): number | null => { const f = join(INV, "article-photos-cache", slug, "page.json"); return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")).images?.length ?? null) : null; };

  console.log("\n## Цвета по артикулам\n| артикул | вариант | цвет у нас | цвет на сайте | фото в варианте | фото других цветов | не определено |\n|---|---|---|---|---|---|---|");
  const writes: { key: string; before: unknown; after: unknown }[] = [];
  const problems: string[] = [];
  for (const row of photoRows) {
    const mid = row.key.slice(PHOTOS_KEY.length);
    const photos = readPhotos(row.value);
    const linkRow = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: LINKS_KEY + mid } }, select: { value: true } });
    const links = readLinks(linkRow?.value);
    // привязка фото к страницам: по порядку и количеству фото страницы
    const photoLink: (typeof links[number] | null)[] = [];
    let pos = 0, okMap = true;
    for (const l of links) {
      const n = pageImages(slugOf(l.url));
      if (n === null) { okMap = false; break; }
      for (let k = 0; k < n; k++) { if (photos[pos + k] && photos[pos + k].variant !== l.variant) okMap = false; photoLink.push(photos[pos + k] ? l : null); }
      pos += n;
    }
    if (pos !== photos.length) okMap = false;
    const newPhotos = photos.map((p, i) => {
      const l = okMap ? photoLink[i] : null;
      if (!l) return p;
      return { ...p, color: p.color ?? siteColor(slugOf(l.url)) ?? undefined, itemId: p.itemId ?? l.itemId.toUpperCase() };
    }).map((p) => JSON.parse(JSON.stringify(p)));
    const newLinks = links.map((l) => ({ ...l, ...(siteColor(slugOf(l.url)) ? { color: l.color ?? siteColor(slugOf(l.url))! } : {}) }));
    if (!okMap) problems.push(`${models.get(mid)}: фото не привязаны к страницам (порядок/число фото не сошлись) — группа «Цвет не определён» по странице, вариант сохраняется`);
    const groups = groupPhotosByColor(newPhotos as typeof photos, refs);
    for (const g of groups) {
      const sc = [...new Set(g.photos.map((p) => p.color).filter(Boolean))].join(" / ") || "—";
      console.log(`| ${models.get(mid)} | ${g.key || "—"} | ${g.label}${g.key && variantColorName(g.key, refs) ? "" : " (по сайту)"} | ${sc} | ${g.photos.length} | 0 | ${g.undetermined ? g.photos.length : 0} |`);
    }
    if (JSON.stringify(photos) !== JSON.stringify(newPhotos)) writes.push({ key: row.key, before: row.value, after: { ...(row.value as object), photos: newPhotos } });
    if (linkRow && JSON.stringify(links) !== JSON.stringify(newLinks)) writes.push({ key: LINKS_KEY + mid, before: linkRow.value, after: { ...(linkRow.value as object), links: newLinks } });
  }
  console.log(`\nЗаписей к обновлению: ${writes.length} (повторный прогон даст 0)`);
  if (problems.length) { console.log("\n## Замечания"); problems.forEach((s) => console.log("  - " + s)); }
  const prev: J | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась."); await prisma.$disconnect(); return; }
  if (prev?.status === "applied") { console.log("Журнал уже содержит применённое — сначала --rollback --apply."); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (!writes.length) { console.log("Нечего менять."); await prisma.$disconnect(); return; }
  if (isLive) backup();
  writeFileSync(JOURNAL, JSON.stringify({ script: "sync-article-photo-colors-2026-10-16.ts", status: "applied", at: new Date().toISOString(), states: writes.map((w) => ({ key: w.key, before: w.before })) } satisfies J, null, 1));
  await prisma.$transaction(async (tx) => { for (const w of writes) await tx.systemState.update({ where: { organizationId_key: { organizationId: org.id, key: w.key } }, data: { value: w.after as object } }); });
  console.log(`Обновлено записей: ${writes.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
