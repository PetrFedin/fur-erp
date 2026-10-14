/**
 * Отгрузка «Отгрузка октябрь 2026 · 1»: этап «Поставщик записался в Коптево на приёмку 15.10» — сторона Веллмех (решение владельца 14.10.2026).
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал); --rollback --apply.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/set-shipment-event-side-2026-10-14.ts [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-shipment-side-wellmekh-2026-10-14.json");

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:set-shipment-event-side");
  const ev = await prisma.shipmentEvent.findFirst({
    where: { title: { startsWith: "Поставщик записался в Коптево" }, shipment: { name: { startsWith: "Отгрузка октябрь 2026" } } },
    select: { id: true, title: true, side: true },
  });
  if (!ev) throw new Error("этап не найден");
  if (ROLLBACK) {
    const j = JSON.parse(existsSync(JOURNAL) ? readFileSync(JOURNAL, "utf8") : "null") as { id: string; before: string | null } | null;
    if (!j) throw new Error("журнала нет");
    if (APPLY) await prisma.shipmentEvent.update({ where: { id: j.id }, data: { side: j.before } });
    console.log(APPLY ? "откат выполнен" : "пробный прогон отката: вернётся " + j.before);
    return;
  }
  console.log(`«${ev.title}»: сторона ${ev.side ?? "—"} → WELLMEKH (Веллмех)`);
  if (!APPLY || ev.side === "WELLMEKH") { console.log(APPLY ? "уже так" : "пробный прогон: ничего не записано (добавьте --apply)"); return; }
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  await prisma.shipmentEvent.update({ where: { id: ev.id }, data: { side: "WELLMEKH" } });
  writeFileSync(JOURNAL, JSON.stringify({ id: ev.id, before: ev.side }, null, 1));
  console.log("записано; журнал:", JOURNAL);
}
main().then(() => process.exit(0));
