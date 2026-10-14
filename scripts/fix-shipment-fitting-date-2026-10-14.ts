/** Примерка отгрузки была 06.10, а не 05.10 (владелец, 14.10.2026). Пробный прогон по умолчанию; --apply (backup.sh + журнал). */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
const APPLY = process.argv.includes("--apply");
async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:fix-fitting-date");
  const ids = ["cmv7zgeew002als61jxp71ule", "cmv80sopw001blsil7rjgifeu"];
  const evs = await prisma.shipmentEvent.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, occurredAt: true } });
  for (const e of evs) console.log(e.id, e.title, e.occurredAt.toISOString());
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  writeFileSync(join(__dirname, "..", "docs-inventory", "corrections-journal-fitting-date-2026-10-14.json"), JSON.stringify(evs, null, 1));
  for (const e of evs) {
    const d = new Date(e.occurredAt); d.setUTCDate(6);
    await prisma.shipmentEvent.update({ where: { id: e.id }, data: { occurredAt: d, title: e.title.replace("примерки 05.10", "примерки 06.10") } });
  }
  console.log("готово");
}
main().then(() => process.exit(0));
