import { PrismaClient } from "@prisma/client";
(async () => {
  const prisma = new PrismaClient();
  console.log(await prisma.budgetScenario.updateMany({ where: { updatedBy: "правило длин 22.10" }, data: { updatedBy: null } }));
  await prisma.$disconnect();
})();
