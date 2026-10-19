// Проверка входа демо-пользователей: пароль из файла логинов подходит к хэшу в базе (bcryptjs.compare — как в src/auth.ts).
//   DATABASE_URL=…/<база>  node_modules/.bin/tsx scripts/check-demo-logins.ts <файл demo-logins.txt>
// Пароли не печатаются. Код возврата 1 — если хоть один не подошёл или в базе есть чужие пользователи.
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const file = process.argv[2];
if (!file) { console.error("Укажите файл логинов"); process.exit(2); }
const text = readFileSync(file, "utf8");
const creds = [...text.matchAll(/email:\s+(\S+)\s*\n\s*пароль:\s+(\S+)/g)].map((m) => ({ email: m[1], password: m[2] }));
const prisma = new PrismaClient();
(async () => {
  const users = await prisma.user.findMany({ select: { email: true, passwordHash: true } });
  let bad = 0;
  if (creds.length !== 5 || users.length !== 5) { bad++; console.log(`FAIL в файле ${creds.length} логинов, в базе ${users.length} пользователей (ожидалось 5 и 5)`); }
  for (const c of creds) {
    const u = users.find((x) => x.email === c.email);
    const okLogin = !!u && bcrypt.compareSync(c.password, u.passwordHash);
    if (!okLogin) bad++;
    console.log(`${okLogin ? "OK  " : "FAIL"} вход ${c.email}`);
  }
  for (const u of users) if (!creds.some((c) => c.email === u.email) || !/@demo\.local$/.test(u.email)) { bad++; console.log(`FAIL лишний пользователь ${u.email}`); }
  await prisma.$disconnect();
  process.exit(bad ? 1 : 0);
})();
