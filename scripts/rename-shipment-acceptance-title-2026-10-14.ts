/**
 * Этапы «Принято в Коптево» → «Приёмка в Коптево» (решение владельца 14.10.2026).
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал); --rollback --apply.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/rename-shipment-acceptance-title-2026-10-14.ts [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const OLD = "Принято в Коптево";
const NEW = "Приёмка в Коптево";
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-shipment-acceptance-title-2026-10-14.json");

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:rename-shipment-acceptance-title");
  if (ROLLBACK) {
    const j = JSON.parse(existsSync(JOURNAL) ? readFileSync(JOURNAL, "utf8") : "null") as { ids: string[] } | null;
    if (!j) throw new Error("журнала нет");
    if (APPLY) await prisma.shipmentEvent.updateMany({ where: { id: { in: j.ids }, title: NEW }, data: { title: OLD } });
    console.log(APPLY ? "откат выполнен" : `пробный прогон отката: вернётся «${OLD}» у ${j.ids.length} этапов`);
    return;
  }
  const evs = await prisma.shipmentEvent.findMany({ where: { title: OLD }, select: { id: true, shipmentId: true } });
  console.log(`«${OLD}» → «${NEW}»: этапов ${evs.length}`);
  if (!APPLY || evs.length === 0) { console.log(APPLY ? "нечего менять" : "пробный прогон: ничего не записано (добавьте --apply)"); return; }
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  await prisma.shipmentEvent.updateMany({ where: { id: { in: evs.map((e) => e.id) } }, data: { title: NEW } });
  writeFileSync(JOURNAL, JSON.stringify({ ids: evs.map((e) => e.id) }, null, 1));
  console.log("записано; журнал:", JOURNAL);
}
main().then(() => process.exit(0));
