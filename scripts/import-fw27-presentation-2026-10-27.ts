/**
 * Презентация FW27/28 → система: фото (uploads/fw27/NN-k.jpg) и описание слайдов (SystemState «fw27-presentation»).
 *   python scripts/extract-fw27-presentation.py "<файл.pdf>" <папка>      # сначала вырезаем фото и слайды
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-fw27-presentation-2026-10-27.ts --dir=<папка>            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-fw27-presentation-2026-10-27.ts --dir=<папка> --apply --live
 *   ... --rollback --apply --live    # вернуть прежнее значение ключа (фото в uploads/fw27 остаются, на них никто не ссылается)
 * Журнал: docs-inventory/fw27-presentation-journal.json (прежнее значение ключа).
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply"), LIVE = process.argv.includes("--live"), ROLLBACK = process.argv.includes("--rollback");
const DIR = process.argv.find((a) => a.startsWith("--dir="))?.slice(6) ?? "";
const ROOT = join(__dirname, "..");
const JOURNAL = join(ROOT, "docs-inventory", "fw27-presentation-journal.json");

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { FW27_STATE } = await import("../src/lib/fw27-presentation");
  const prisma = createAuditedClient("script:import-fw27-presentation");
  const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
  const isLive = dbName === "fur_erp";
  const orgId = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Боевая база: нужен --live."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT });
  const key = { organizationId_key: { organizationId: orgId, key: FW27_STATE } };
  if (ROLLBACK) {
    const j = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    if (APPLY) {
      if (isLive) backup();
      if (j.before === null) await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: FW27_STATE } });
      else await prisma.systemState.update({ where: key, data: { value: j.before } });
      writeFileSync(JOURNAL, JSON.stringify({ ...j, status: "rolled-back", at: new Date().toISOString() }, null, 1));
      console.log("Откат выполнен.");
    } else console.log("Откат (пробный — добавьте --apply).");
    await prisma.$disconnect();
    return;
  }
  if (!DIR || !existsSync(join(DIR, "slides.json"))) throw new Error("Укажите --dir=<папка с slides.json и img/>");
  const slides = JSON.parse(readFileSync(join(DIR, "slides.json"), "utf8")) as { items: { file: string; pcs: number | null }[] }[];
  const files = slides.flatMap((s) => s.items.map((i) => i.file));
  const missing = files.filter((f) => !existsSync(join(DIR, "img", f)));
  const pcs = slides.reduce((t, s) => t + s.items.reduce((a, i) => a + (i.pcs ?? 0), 0), 0);
  console.log(`Слайдов: ${slides.length}, фото: ${files.length}, штук по подписям: ${pcs}, нет файлов: ${missing.length}`);
  if (missing.length) throw new Error("Не хватает файлов фото: " + missing.slice(0, 5).join(", "));
  if (!APPLY) { console.log("Пробный прогон: ничего не записано."); await prisma.$disconnect(); return; }
  if (isLive) backup();
  const prev = await prisma.systemState.findUnique({ where: key, select: { value: true } });
  writeFileSync(JOURNAL, JSON.stringify({ script: "import-fw27-presentation-2026-10-27.ts", status: "applied", at: new Date().toISOString(), db: dbName, before: prev?.value ?? null }, null, 1));
  const dest = join(ROOT, "uploads", "fw27"); mkdirSync(dest, { recursive: true });
  for (const f of files) copyFileSync(join(DIR, "img", f), join(dest, f));
  const value = { source: "MVST FUR RUS FW27.pdf (WMN FW27/28, Денисюк А.)", asOf: new Date().toISOString().slice(0, 10), slides };
  await prisma.systemState.upsert({ where: key, create: { organizationId: orgId, key: FW27_STATE, value }, update: { value } });
  console.log(`Записано: ${slides.length} слайдов, ${files.length} фото → uploads/fw27. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
