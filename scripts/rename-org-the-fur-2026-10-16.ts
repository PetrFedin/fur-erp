/**
 * Организация «MVST» → «THE FUR» (решение владельца 16.10.2026: нигде в интерфейсе не должно быть MVST).
 * Меняется только Organization.name; slug, id, e-mail пользователей, названия документов/файлов не трогаем.
 * Пробный прогон по умолчанию; на боевой базе запись — только --apply --live (сам делает bash scripts/backup.sh).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/rename-org-the-fur-2026-10-16.ts [--apply [--live]]
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/rename-org-the-fur-2026-10-16.ts --rollback [--apply [--live]]
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const NEW_NAME = "THE FUR";
const OLD_RE = /mvst/i;
const INV = join(__dirname, "..", "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-rename-org-the-fur-2026-10-16.json");

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:rename-org-the-fur");
  const url = process.env.DATABASE_URL ?? "";
  const isLive = /\/fur_erp(\?|$)/.test(url);
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "переименование"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Это боевая база: для записи нужен флаг --live (он сам сделает бэкап). Ничего не изменено."); process.exitCode = 1; return; }
  const backup = () => { console.log("Копия базы перед записью: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") }); };

  if (ROLLBACK) {
    if (!existsSync(JOURNAL)) throw new Error("журнала отката нет: " + JOURNAL);
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { orgId: string; before: string; after: string };
    const cur = await prisma.organization.findUniqueOrThrow({ where: { id: j.orgId }, select: { name: true } });
    console.log(`Откат: «${cur.name}» → «${j.before}» (организация ${j.orgId})`);
    if (cur.name !== j.after) { console.log(`Текущее имя «${cur.name}» не равно записанному после переименования «${j.after}» — откат не нужен/небезопасен.`); return; }
    if (!APPLY) { console.log("Пробный прогон: БД не менялась."); return; }
    if (isLive) backup();
    await prisma.organization.update({ where: { id: j.orgId }, data: { name: j.before } });
    console.log("Откат выполнен.");
    return;
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, slug: true } });
  const hit = orgs.filter((o) => OLD_RE.test(o.name));
  console.log(`Организаций всего: ${orgs.length}; с «MVST» в названии: ${hit.length}`);
  for (const o of hit) console.log(`  ${o.id} slug=${o.slug}: «${o.name}» → «${NEW_NAME}»`);
  if (hit.length !== 1) { console.log("Ожидалась ровно одна организация — ничего не меняю."); return; }
  if (!APPLY) { console.log("Пробный прогон: БД не менялась. Для записи — --apply (на боевой ещё --live)."); return; }
  const o = hit[0];
  if (isLive) backup();
  mkdirSync(INV, { recursive: true });
  writeFileSync(JOURNAL, JSON.stringify({ orgId: o.id, slug: o.slug, before: o.name, after: NEW_NAME, at: new Date().toISOString() }, null, 1));
  await prisma.organization.update({ where: { id: o.id }, data: { name: NEW_NAME } });
  console.log("Записано. Журнал отката:", JOURNAL);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
