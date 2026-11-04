/**
 * Excel «FW 26/27: заказано, пришло, приход по месяцам, план на ноябрь и декабрь» (тот же файл, что даёт кнопка «Скачать Excel» в «Приход по месяцам»).
 * Запуск: NODE_PATH=<папка с пустым server-only> node --env-file=.env node_modules/.bin/tsx scripts/gen-fw26-plan-xlsx.ts [папка]
 */
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { buildFw26PlanFile } from "@/lib/fw26-plan-xlsx";

async function main() {
  const dir = process.argv[2] ?? "docs-inventory/reports";
  const org = await prisma.organization.findFirstOrThrow();
  const { name, buffer, summary } = await buildFw26PlanFile(org.id, "on");
  const path = `${dir}/${name}`;
  writeFileSync(path, buffer);
  console.log(path, JSON.stringify(summary));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
