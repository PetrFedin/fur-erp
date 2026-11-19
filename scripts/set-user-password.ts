/**
 * Задать пароль существующему пользователю (для локальной разработки и проверки: например, после загрузки обезличенной
 * демо-базы deploy/demo/demo.sql.gz, у пользователей которой пароли неизвестны).
 *   node --env-file=.env node_modules/.bin/tsx scripts/set-user-password.ts <email> <новый пароль, не короче 8 знаков>
 * Работает с базой из DATABASE_URL; на боевую базу не направлять.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error("usage: set-user-password.ts <email> <пароль>");
  if (password.length < 8) throw new Error("пароль короче 8 знаков");
  const user = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, role: true } });
  if (!user) throw new Error(`пользователь ${email} не найден`);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12) } });
  console.log(`Пароль задан: ${user.email} (${user.role})`);
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
