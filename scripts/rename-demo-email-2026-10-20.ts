/**
 * Переименование логина кабинета Веллмеха: wellmekh@demo.mvst -> wellmekh@demo.local (решение владельца 20.10.2026: «MVST» в интерфейсе недопустим).
 * Меняется ТОЛЬКО User.email: пароль (passwordHash), роль, поставщик, id, активность не трогаются. Вход после переименования — по новому адресу тем же паролем.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/rename-demo-email-2026-10-20.ts                        # пробный прогон (БД не меняется)
 *   DATABASE_URL=<копия> node --env-file=.env node_modules/.bin/tsx scripts/rename-demo-email-2026-10-20.ts --apply      # репетиция на копии
 *   node --env-file=.env node_modules/.bin/tsx scripts/rename-demo-email-2026-10-20.ts --apply --live         # боевая fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/rename-demo-email-2026-10-20.ts --rollback [--apply [--live]]
 *
 * Проверки: старый адрес есть ровно у одного пользователя с ролью SUPPLIER; новый адрес свободен (email уникален без учёта регистра); повторный запуск ничего не делает.
 * После применения вручную: поменять DEMO_SUPPLIER_EMAIL в .env (локальный файл, в git не лежит) и пересобрать демо (scripts/rebuild-demo.sh).
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  if (req === "next/cache") return join(__dirname, "stubs", "next-cache.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const LIVE = process.argv.includes("--live");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const OLD = "wellmekh@demo.mvst";
const NEW = "wellmekh@demo.local";

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; userId: string; oldEmail: string; newEmail: string };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const dbName = (process.env.DATABASE_URL ?? "").split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient("script:rename-demo-email-2026-10-20");
  const JOURNAL = join(INV, `corrections-journal-rename-demo-email-2026-10-20${isLive ? "" : `-${dbName}`}.json`);
  const prev = readJson<Journal | null>(JOURNAL, null);

  if (ROLLBACK) {
    if (!prev || prev.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    const u = await prisma.user.findUnique({ where: { id: prev.userId }, select: { email: true } });
    console.log(`Откат (${dbName}): пользователь ${prev.userId}: ${u?.email ?? "(нет)"} -> ${prev.oldEmail}${APPLY ? "" : " (пробный — БД не меняется)"}`);
    if (APPLY) {
      if (u?.email !== prev.newEmail) throw new Error(`У пользователя уже другой адрес (${u?.email}); откат не выполняю.`);
      const busy = await prisma.user.findFirst({ where: { email: { equals: prev.oldEmail, mode: "insensitive" } }, select: { id: true } });
      if (busy) throw new Error(`Адрес ${prev.oldEmail} уже занят (${busy.id}).`);
      await prisma.user.update({ where: { id: prev.userId }, data: { email: prev.oldEmail } });
      writeJson(JOURNAL, { ...prev, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const users = await prisma.user.findMany({ where: { email: { equals: OLD, mode: "insensitive" } }, select: { id: true, email: true, role: true, supplierId: true, isActive: true } });
  const taken = await prisma.user.findFirst({ where: { email: { equals: NEW, mode: "insensitive" } }, select: { id: true, email: true } });
  console.log(`База «${dbName}». Пользователей с ${OLD}: ${users.length}; ${NEW} ${taken ? `УЖЕ ЗАНЯТ (${taken.id})` : "свободен"}.`);
  if (users.length === 0) { console.log(taken ? "Уже переименовано — делать нечего." : "Пользователь не найден."); await prisma.$disconnect(); return; }
  if (users.length > 1) throw new Error("Больше одного пользователя со старым адресом — остановка.");
  const u = users[0];
  if (u.role !== "SUPPLIER") throw new Error(`Роль ${u.role}, ожидалась SUPPLIER — остановка.`);
  if (taken) throw new Error(`Адрес ${NEW} уже занят пользователем ${taken.id} — остановка.`);
  console.log(`  ${u.id}: ${u.email} -> ${NEW} (роль SUPPLIER, поставщик ${u.supplierId}, ${u.isActive ? "активен" : "отключён"}); пароль и роль не меняются.`);
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (копия) или --apply --live (боевая)."); await prisma.$disconnect(); return; }
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое переименование — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  await prisma.user.update({ where: { id: u.id }, data: { email: NEW } });
  writeJson(JOURNAL, { script: "rename-demo-email-2026-10-20.ts", status: "applied", at: new Date().toISOString(), db: dbName, userId: u.id, oldEmail: u.email, newEmail: NEW } satisfies Journal);
  console.log(`Применено на «${dbName}». Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
