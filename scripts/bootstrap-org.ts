/**
 * Recreates the organisation, owner and default reference data exactly like
 * src/app/register/actions.ts does, for a freshly migrated empty database.
 * Run: node --env-file=.env node_modules/.bin/tsx scripts/bootstrap-org.ts <passwordHash>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const hash = process.argv[2];
  if (!hash) throw new Error("usage: bootstrap-org.ts <bcrypt hash>");
  if (await prisma.organization.count()) throw new Error("database is not empty");
  const org = await prisma.organization.create({ data: { name: "ООО Смоук-тест", slug: "ooo-smouk-test" } });
  await prisma.user.create({
    data: { organizationId: org.id, email: "anna@qa-test.ru", name: "Анна", passwordHash: hash, role: "OWNER" },
  });
  await prisma.warehouse.create({ data: { organizationId: org.id, name: "Основной склад", isDefault: true } });
  const purchase = ["Доставка", "Растаможка", "Страхование", "Комиссия посредника", "Входной контроль / брак", "Аукционный сбор", "Выделка", "Покраска / тонировка", "Упаковка"];
  const production = ["Оплата труда", "Фурнитура и материалы", "Аренда цеха", "Амортизация оборудования", "Прочие расходы"];
  await prisma.expenseCategory.createMany({
    data: [
      ...purchase.map((name) => ({ organizationId: org.id, name, kind: "PURCHASE" as const })),
      ...production.map((name) => ({ organizationId: org.id, name, kind: "PRODUCTION" as const })),
    ],
  });
  console.log("org", org.id);
}
main().finally(() => prisma.$disconnect());
