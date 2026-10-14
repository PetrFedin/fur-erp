/**
 * Пользователь кабинета Веллмеха (роль SUPPLIER) — 14.10.2026. Нужна применённая миграция 20261017090000_supplier_role.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/create-wellmekh-user-2026-10-14.ts            # пробный прогон (БД не меняется)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/create-wellmekh-user-2026-10-14.ts --apply    # создать (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/create-wellmekh-user-2026-10-14.ts --rollback --apply   # удалить созданного пользователя по журналу
 *
 * Пароль генерируется случайным и записывается открытым текстом ТОЛЬКО в docs-inventory/wellmekh-login.txt (папка вне git).
 * В консоль и в журнал отката пароль не попадает. Журнал: docs-inventory/corrections-journal-wellmekh-user-2026-10-14.json.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
import { existsSync, unlinkSync, writeFileSync } from "fs";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  if (req === "next/cache") return join(__dirname, "stubs", "next-cache.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const ACTOR = "script:create-wellmekh-user";
const EMAIL = "wellmekh@demo.mvst";
const NAME = "Веллмех (кабинет)";
const SUPPLIER_ID = "cmupc49fy003jls83tdqxr606";
const ORG_ID = "cmuo7vwvk0000lsu5pghd5jka";

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; userId: string; email: string };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const bcrypt = (await import("bcryptjs")).default;
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, "corrections-journal-wellmekh-user-2026-10-14.json");
  const LOGIN = join(INV, "wellmekh-login.txt");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`  удалить пользователя ${j.email} (${j.userId})`);
    if (APPLY) {
      await prisma.user.deleteMany({ where: { id: j.userId, email: j.email, role: "SUPPLIER" } });
      if (existsSync(LOGIN)) unlinkSync(LOGIN);
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен (файл с паролем удалён).");
    } else console.log("Пробный прогон отката: БД не менялась. Для отката — --rollback --apply.");
    await prisma.$disconnect();
    return;
  }

  const sup = await prisma.supplier.findFirst({ where: { id: SUPPLIER_ID, organizationId: ORG_ID }, select: { id: true, name: true } });
  if (!sup) throw new Error("Поставщик Веллмех не найден");
  const exists = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  console.log(`Поставщик: ${sup.name}. Пользователь ${EMAIL}: ${exists ? "УЖЕ ЕСТЬ" : "будет создан"} (роль SUPPLIER, имя «${NAME}»).`);
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }
  if (exists) { console.log("Пользователь уже существует — ничего не делаю."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const password = randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);
  const u = await prisma.user.create({ data: { organizationId: ORG_ID, email: EMAIL, name: NAME, role: "SUPPLIER", supplierId: SUPPLIER_ID, passwordHash } });
  writeFileSync(LOGIN, `Кабинет Веллмеха (локально)\nАдрес: http://localhost:3200/login\nEmail: ${EMAIL}\nПароль: ${password}\n`, { mode: 0o600 });
  writeJson(JOURNAL, { script: "create-wellmekh-user-2026-10-14", status: "applied", at: new Date().toISOString(), userId: u.id, email: EMAIL } satisfies Journal);
  console.log(`Готово. Логин и пароль: ${LOGIN}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
