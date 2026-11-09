/**
 * Кладёт готовые Excel «Отчёт: продажи» и «Отчёт: поставки» в базу (SystemState `report-xlsx:sales` / `report-xlsx:supply`), чтобы кнопка «Excel» в окнах отчётов каталога отдавала их.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/publish-report-xlsx.ts <продажи.xlsx> <поставки.xlsx>
 * Прежнее значение ключа — в журнал docs-inventory/corrections-journal-report-xlsx.json (откат: удалить ключи или вернуть значение из журнала).
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

(async () => {
  const [sales, supply] = [process.argv[2], process.argv[3]];
  if (!sales || !supply) throw new Error("usage: <продажи.xlsx> <поставки.xlsx>");
  const { createAuditedClient } = await import("../src/lib/prisma");
  const db = createAuditedClient("script:publish-report-xlsx");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const journal: Record<string, unknown> = {};
  for (const [tab, file] of [["sales", sales], ["supply", supply]] as const) {
    const key = `report-xlsx:${tab}`;
    const before = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: org, key } }, select: { value: true } });
    journal[key] = before ? { hadBefore: true, name: (before.value as { name?: string }).name, at: (before.value as { at?: string }).at } : { hadBefore: false };
    const value = { name: basename(file), at: new Date().toISOString(), base64: readFileSync(file).toString("base64") };
    await db.systemState.upsert({ where: { organizationId_key: { organizationId: org, key } }, create: { organizationId: org, key, value }, update: { value } });
    console.log(`${key}: ${basename(file)}, ${Math.round(readFileSync(file).length / 1024)} КБ`);
  }
  const jp = join(__dirname, "..", "docs-inventory", "corrections-journal-report-xlsx.json");
  const prev = existsSync(jp) ? JSON.parse(readFileSync(jp, "utf8")) : [];
  writeFileSync(jp, JSON.stringify([...prev, { at: new Date().toISOString(), journal }], null, 1));
  process.exit(0);
})();
