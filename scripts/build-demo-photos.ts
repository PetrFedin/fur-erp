/**
 * Фото артикулов для ДЕМО-стенда: компактный пакет файлов + идемпотентный SQL-патч (без перезагрузки демо-базы).
 * Живая БД и uploads/ только ЧИТАЮТСЯ. Пишет deploy/demo/article-photos.tgz и deploy/demo/article-photos-patch.sql.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/build-demo-photos.ts [--per-variant 8] [--max-side 1000] [--quality 75]
 *
 * Правила: до 8 фото на цвет-вариант (по порядку в записи), длинная сторона <= 1000 px, jpg q75 (при 1100/q78 пакет получался 26 МБ), миниатюры <= 320 px.
 * Пути и id артикулов те же, что в живой системе (демо-дамп собран из неё: id организации и ProductModel.id совпадают).
 * Патч: SystemState article-photos:<id> и article-shop-links:<id> (ON CONFLICT DO UPDATE) + PLU в ProductModel.attributes
 * (заменяются только свойства «PLU…», остальные не трогаются). Если артикула или организации нет в базе — строка пропускается.
 * demo-start.mjs применяет патч и распаковывает пакет при каждом старте.
 */
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";

const arg = (n: string, d: number) => { const i = process.argv.indexOf("--" + n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PER_VARIANT = arg("per-variant", 8), MAX_SIDE = arg("max-side", 1000), QUALITY = arg("quality", 75), THUMB = 320;
const ROOT = join(__dirname, "..");
const SRC = process.env.UPLOAD_DIR ? process.env.UPLOAD_DIR : join(ROOT, "uploads");
const OUT_DIR = join(ROOT, "deploy", "demo");
const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";

type Photo = { id: string; file: string; thumb: string; w: number; h: number; variant: string; color?: string; itemId?: string };

async function main() {
  const prisma = new PrismaClient();
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const states = await prisma.systemState.findMany({ where: { organizationId: org.id, OR: [{ key: { startsWith: "article-photos:" } }, { key: { startsWith: "article-shop-links:" } }] }, select: { key: true, value: true } });
  const models = await prisma.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, attributes: true } });
  await prisma.$disconnect();

  const tmp = mkdtempSync(join(tmpdir(), "demo-photos-"));
  const pack = join(tmp, "article-photos");
  const photoRows: { modelId: string; photos: Photo[] }[] = [];
  let files = 0;
  for (const s of states.filter((x) => x.key.startsWith("article-photos:"))) {
    const modelId = s.key.slice("article-photos:".length);
    const all = ((s.value as { photos?: Photo[] })?.photos ?? []).filter((p) => p && p.id && p.file && p.thumb);
    const perGroup = new Map<string, number>();
    const kept: Photo[] = [];
    for (const p of all) {
      const g = p.itemId || p.variant || p.color || "";
      if ((perGroup.get(g) ?? 0) >= PER_VARIANT) continue;
      const abs = join(SRC, p.file);
      if (!existsSync(abs)) continue;
      const dst = join(tmp, p.file), dstT = join(tmp, p.thumb);
      mkdirSync(dirname(dst), { recursive: true });
      const img = sharp(abs).rotate();
      const info = await img.clone().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: QUALITY, mozjpeg: true }).toFile(dst);
      await img.clone().resize({ width: THUMB, height: THUMB, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toFile(dstT);
      perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
      kept.push({ ...p, w: info.width, h: info.height });
      files += 2;
    }
    if (kept.length) photoRows.push({ modelId, photos: kept });
  }
  const withPhotos = new Set(photoRows.map((r) => r.modelId));
  const linkRows = states.filter((x) => x.key.startsWith("article-shop-links:")).map((x) => ({ modelId: x.key.slice("article-shop-links:".length), value: x.value })).filter((r) => withPhotos.has(r.modelId));
  const pluRows = models.map((m) => ({ modelId: m.id, plu: (Array.isArray(m.attributes) ? (m.attributes as { name: string; value: string }[]) : []).filter((a) => a && /^PLU(\s|$)/i.test(String(a.name))) })).filter((r) => r.plu.length);

  // ----- SQL -----
  const upsert = (prefix: string, modelId: string, value: unknown) =>
    `insert into "SystemState" ("id","organizationId","key","value","createdAt","updatedAt")\n` +
    `select 'demo-' || md5(o.id || ${q(prefix + modelId)}), o.id, ${q(prefix + modelId)}, ${q(JSON.stringify(value))}::jsonb, now(), now()\n` +
    `from "Organization" o join "ProductModel" m on m."organizationId" = o.id and m.id = ${q(modelId)} where o.id = ${q(org.id)}\n` +
    `on conflict ("organizationId","key") do update set "value" = excluded."value", "updatedAt" = now();`;
  const sql: string[] = [
    "-- Фото артикулов, ссылки «Товар в магазине» и PLU для демо-стенда. Идемпотентно; сформировано scripts/build-demo-photos.ts. Не править руками.",
    "begin;",
    ...photoRows.map((r) => upsert("article-photos:", r.modelId, { photos: r.photos })),
    ...linkRows.map((r) => upsert("article-shop-links:", r.modelId, r.value)),
    // PLU: убираем прежние свойства «PLU…» и добавляем из выгрузки; остальные свойства остаются как были
    ...pluRows.map((r) =>
      `update "ProductModel" set "attributes" = (\n` +
      `  select coalesce(jsonb_agg(e), '[]'::jsonb) from (\n` +
      `    select e from jsonb_array_elements(case when jsonb_typeof("attributes") = 'array' then "attributes" else '[]'::jsonb end) e where e->>'name' !~* '^PLU( |$)'\n` +
      `    union all select e from jsonb_array_elements(${q(JSON.stringify(r.plu))}::jsonb) e) t\n` +
      `) where "organizationId" = ${q(org.id)} and id = ${q(r.modelId)};`),
    "commit;",
    "",
  ];
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "article-photos-patch.sql"), sql.join("\n"));

  // ----- пакет -----
  const tgz = join(OUT_DIR, "article-photos.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", tmp, "article-photos"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  rmSync(tmp, { recursive: true, force: true });
  const mb = (statSync(tgz).size / 1048576).toFixed(1);
  console.log(`Пакет: ${tgz} — ${mb} МБ; артикулов с фото ${photoRows.length}, файлов ${files} (фото ${files / 2}), ссылок магазина (артикулов) ${linkRows.length}, артикулов с PLU ${pluRows.length}`);
  if (Number(mb) > 25) { console.error("ПАКЕТ БОЛЬШЕ 25 МБ: уменьшите --per-variant или --quality"); process.exitCode = 1; }
  void readFileSync;
}
main().catch((e) => { console.error(e); process.exit(1); });
