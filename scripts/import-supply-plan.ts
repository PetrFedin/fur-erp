/**
 * Populates /supply-plan from the user's own production-tracking sheet
 * ("Копия производство на 22092026.xlsx", sheet "производство 150926"):
 * each row is one unit of a model/size with a chain of stage dates and a
 * free-text status note. Aggregated (by a Python script, not checked in)
 * into per (article, month, status) cells in scripts/supply_plan_import.json.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/import-supply-plan.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type PlanCell = {
  modelId: string;
  model: string;
  month: string;
  status: "PLANNED" | "LAUNCHED" | "WITH_FURRIER" | "WITH_TAILOR" | "PRODUCED" | "CANCELLED";
  quantity: number;
  eventDate: string | null;
  notes: string | null;
};

async function main() {
  const plan: PlanCell[] = JSON.parse(readFileSync(join(__dirname, "supply_plan_import.json"), "utf-8"));
  const org = await prisma.organization.findFirstOrThrow();

  const existing = await prisma.supplyPlanEntry.count({ where: { organizationId: org.id } });
  if (existing > 0) {
    console.log(`supply_plan already has ${existing} entries — skipping (delete them first to re-import).`);
    return;
  }

  // modelId в JSON — id из исходной базы и в пересобранной не существует:
  // ищем модель по названию (с учётом кириллицы/латиницы), при отсутствии создаём.
  const LOOK: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X" };
  const norm = (n: string) => n.toUpperCase().replace(/[А-ЯЁ]/g, (c) => LOOK[c] ?? c).replace(/\s+/g, "");
  const models = await prisma.productModel.findMany({ where: { organizationId: org.id } });
  const byNorm = new Map(models.map((m) => [norm(m.name), m.id]));
  const idFor = async (name: string) => {
    const hit = byNorm.get(norm(name));
    if (hit) return hit;
    const m = await prisma.productModel.create({ data: { organizationId: org.id, name } });
    byNorm.set(norm(name), m.id);
    console.log(`Создана модель ${name}`);
    return m.id;
  };

  let created = 0;
  for (const p of plan) {
    await prisma.supplyPlanEntry.create({
      data: {
        organizationId: org.id,
        productModelId: await idFor(p.model),
        month: new Date(`${p.month}-01`),
        status: p.status,
        quantity: p.quantity,
        eventDate: p.eventDate ? new Date(p.eventDate) : null,
        notes: p.notes,
      },
    });
    created++;
  }
  console.log(`Created ${created} supply plan entries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
