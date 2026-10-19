/**
 * Фото артикулов из листа «фото» файла «отчет по товарам фото и цены 2.xlsx» (114 строк: артикул+ткань → картинка, 99 файлов в xl/media).
 * Картинки и привязка «строка → файл» вынуты из xlsx (drawing1.xml) в docs-inventory/cashflow-sales-2026-10-19/photos + photo-anchors.json (в git не попадают).
 * Механика та же, что у фото артикулов: файлы в UPLOAD_DIR/article-photos/<организация>/<артикул>/ + SystemState «article-photos:<id>».
 *
 *   TSX="node --conditions=react-server --env-file=.env node_modules/.bin/tsx"
 *   $TSX scripts/apply-photos-2026-10-19.ts                    # пробный прогон: сопоставление и отчёт (БД и файлы не меняются)
 *   $TSX scripts/apply-photos-2026-10-19.ts --apply            # внести в НЕ боевую базу (репетиция: UPLOAD_DIR=<scratch>)
 *   $TSX scripts/apply-photos-2026-10-19.ts --apply --live     # внести в боевую (сам делает bash scripts/backup.sh)
 *   $TSX scripts/apply-photos-2026-10-19.ts --rollback --apply [--live]
 *
 * Правила: одна картинка на нескольких строках — неоднозначно (не вносится); артикул файла = код модели + название ткани (вариант). Сопоставление только при точном совпадении кода модели (латиница/кириллица, дефис и пробел не важны)
 * с ОДНОЙ моделью; неоднозначное и не найденное — в список, не вносится. Существующие фото не перезаписываются и не удаляются: фото добавляется,
 * только если у модели нет фото с таким же вариантом и нет безымянного фото (оно покрывает все варианты). Идемпотентно (журнал; повторный --apply ничего не добавляет).
 * Журнал отката: docs-inventory/cashflow-sales-2026-10-19/photos-journal<-база>.json (хранит прежнее значение article-photos:<id>).
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const ROOT = join(__dirname, "..");
const DIR = join(ROOT, "docs-inventory", "cashflow-sales-2026-10-19");

type Anchor = { row: number; img: string; a: string; b: string };
type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; models: { modelId: string; name: string; key: string; before: unknown | null; files: string[] }[] };
const normVariant = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { PHOTOS_KEY, readPhotos } = await import("../src/lib/article-photos");
  const { UPLOAD_ROOT } = await import("../src/lib/fitting-files");
  const { modelCodeOfArticle, normCode } = await import("../src/lib/sales-receipts-core");
  const prisma = createAuditedClient("script:apply-photos-2026-10-19");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const isLive = dbName === "fur_erp";
  const JOURNAL = join(DIR, `photos-journal${isLive ? "" : "-" + dbName}.json`);
  const orgId = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; файлы: ${UPLOAD_ROOT}; ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Боевая база: нужен --live (сам сделает бэкап). Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (APPLY && !isLive && LIVE) { console.log("--live указан, но база не fur_erp."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); };

  if (ROLLBACK) {
    const j: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    console.log(`Откат: артикулов ${j.models.length}, файлов ${j.models.reduce((a, m) => a + m.files.length, 0)}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      if (isLive) backup();
      for (const m of j.models) {
        if (m.before === null) await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: m.key } });
        else await prisma.systemState.update({ where: { organizationId_key: { organizationId: orgId, key: m.key } }, data: { value: m.before as object } });
        for (const f of m.files) rmSync(join(UPLOAD_ROOT, f), { force: true });
        if (m.files.length) { try { rmSync(dirname(join(UPLOAD_ROOT, m.files[0])), { recursive: false }); } catch { /* не пуст */ } }
      }
      writeFileSync(JOURNAL, JSON.stringify({ ...j, status: "rolled-back", at: new Date().toISOString() }, null, 1));
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const anchors: Anchor[] = JSON.parse(readFileSync(join(DIR, "photo-anchors.json"), "utf8"));
  const models = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, salesCode: true, aliases: true } });
  const byCode = new Map<string, typeof models>();
  for (const m of models) for (const k of new Set([normCode(m.name), ...(m.salesCode ? [normCode(m.salesCode)] : [])])) byCode.set(k, [...(byCode.get(k) ?? []), m]);
  const states = await prisma.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: PHOTOS_KEY } }, select: { key: true, value: true } });
  const have = new Map(states.map((s) => [s.key.slice(PHOTOS_KEY.length), { raw: s.value, photos: readPhotos(s.value) }]));

  type Plan = { modelId: string; name: string; additions: { variant: string; img: string; row: number }[] };
  const plan = new Map<string, Plan>();
  const skipped: string[] = [], ambiguous: string[] = [], unmatched: string[] = [], dup: string[] = [];
  const imgUse = new Map<string, number>();
  for (const a of anchors) imgUse.set(a.img, (imgUse.get(a.img) ?? 0) + 1);
  for (const a of anchors) {
    if ((imgUse.get(a.img) ?? 0) > 1) { ambiguous.push(`стр. ${a.row} «${a.a}»: одна и та же картинка (${a.img}) стоит у ${imgUse.get(a.img)} строк — какой вариант на ней, неясно, не вношу`); continue; }
    const code = modelCodeOfArticle(a.a);
    if (!code) { unmatched.push(`стр. ${a.row} «${a.a}»: код модели не распознан`); continue; }
    const c = byCode.get(code) ?? [];
    if (c.length === 0) { unmatched.push(`стр. ${a.row} «${a.a}»: модели ${code} нет в системе`); continue; }
    if (c.length > 1) { ambiguous.push(`стр. ${a.row} «${a.a}»: код ${code} у нескольких моделей: ${c.map((m) => m.name).join(", ")}`); continue; }
    const m = c[0];
    const variant = a.a.replace(/^\s*[A-Za-zА-Яа-я]{1,4}[\s-]?\d{1,3}[A-Za-zА-Яа-я]?(?=$|[\s/])/, "").replace(/^[\s/]+/, "").trim() || a.b;
    const cur = have.get(m.id)?.photos ?? [];
    if (cur.some((p) => p.variant.trim() === "")) { skipped.push(`стр. ${a.row} «${a.a}» → ${m.name}: у артикула уже есть фото без варианта (покрывает все) — пропуск`); continue; }
    if (cur.some((p) => normVariant(p.variant) === normVariant(variant))) { skipped.push(`стр. ${a.row} «${a.a}» → ${m.name}: фото варианта «${variant}» уже есть — пропуск`); continue; }
    const p = plan.get(m.id) ?? { modelId: m.id, name: m.name, additions: [] };
    if (p.additions.some((x) => normVariant(x.variant) === normVariant(variant))) { dup.push(`стр. ${a.row} «${a.a}» → ${m.name}: вариант «${variant}» уже взят из строки ${p.additions.find((x) => normVariant(x.variant) === normVariant(variant))!.row}`); continue; }
    p.additions.push({ variant, img: a.img, row: a.row });
    plan.set(m.id, p);
  }
  const withoutBefore = models.filter((m) => !(have.get(m.id)?.photos.length));
  const nowWith = withoutBefore.filter((m) => plan.has(m.id));
  console.log(`\n## Итог сопоставления: строк ${anchors.length}; к внесению ${[...plan.values()].reduce((s, p) => s + p.additions.length, 0)} фото у ${plan.size} артикулов`);
  console.log(`   из них артикулов, у которых фото не было совсем: ${nowWith.length} (из ${withoutBefore.length} без фото)`);
  console.log(`   пропущено (фото уже есть) ${skipped.length}; повтор варианта ${dup.length}; не найдено в системе ${unmatched.length}; неоднозначно ${ambiguous.length}`);
  console.log("\n| артикул | вариант | строка | файл |\n|---|---|---|---|");
  for (const p of plan.values()) for (const x of p.additions) console.log(`| ${p.name} | ${x.variant} | ${x.row} | ${x.img} |`);
  for (const [t, l] of [["Пропущено", skipped], ["Повтор варианта", dup], ["Не найдено в системе", unmatched], ["Неоднозначно (не вносится)", ambiguous]] as const) if (l.length) { console.log(`\n## ${t}`); l.forEach((s) => console.log("  - " + s)); }
  const stillNo = withoutBefore.filter((m) => !plan.has(m.id));
  console.log(`\n## Останутся без фото: ${stillNo.length}${stillNo.length ? " — " + stillNo.map((m) => m.name).sort().join(", ") : ""}`);
  console.log("\nПримечание: картинки в файле маленькие (около 106×163 px); подходят как временные, при загрузке настоящих фото в «Изделиях» их можно удалить кнопкой «Удалить фото».");

  if (!APPLY) { console.log("\nПробный прогон: БД и файлы не менялись. Для записи — --apply (боевая: --apply --live)."); await prisma.$disconnect(); return; }
  const prev: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое внесение — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (!plan.size) { console.log("Нечего вносить."); await prisma.$disconnect(); return; }
  if (isLive) backup();
  const sharp = (await import("sharp")).default;
  const journal: Journal = { script: "apply-photos-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, models: [] };
  for (const p of plan.values()) {
    const key = PHOTOS_KEY + p.modelId;
    const cur = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key } }, select: { value: true } });
    const entry = { modelId: p.modelId, name: p.name, key, before: (cur?.value as unknown) ?? null, files: [] as string[] };
    const dirRel = join("article-photos", orgId, p.modelId);
    mkdirSync(join(UPLOAD_ROOT, dirRel), { recursive: true });
    const photos = [...readPhotos(cur?.value)] as { id: string; file: string; thumb: string; w: number; h: number; variant: string }[];
    for (const x of p.additions) {
      const id = randomUUID();
      const file = join(dirRel, `${id}.jpg`), thumb = join(dirRel, `${id}-t.jpg`);
      copyFileSync(join(DIR, "photos", x.img), join(UPLOAD_ROOT, file));
      copyFileSync(join(DIR, "photos", x.img), join(UPLOAD_ROOT, thumb));
      entry.files.push(file, thumb);
      const meta = await sharp(join(UPLOAD_ROOT, file)).metadata();
      photos.push({ id, file, thumb, w: meta.width ?? 0, h: meta.height ?? 0, variant: x.variant });
    }
    await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key } }, create: { organizationId: orgId, key, value: { photos } }, update: { value: { photos } } });
    journal.models.push(entry);
    mkdirSync(DIR, { recursive: true });
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // журнал после каждого артикула
  }
  console.log(`\nВнесено: артикулов ${journal.models.length}, фото ${journal.models.reduce((s, m) => s + m.files.length / 2, 0)}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
