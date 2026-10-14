/** Убирает «час не указан» из описаний этапов отгрузки (владелец, 14.10.2026). Пробный прогон по умолчанию; --apply (backup.sh + журнал). */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
const APPLY = process.argv.includes("--apply");
const clean = (s: string) => s.replace(/\s*;?\s*час не указан\.?/gi, "").replace(/^[\s;,]+|[\s;,]+$/g, "").trim();
async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:clean-event-details");
  const evs = await prisma.shipmentEvent.findMany({ where: { details: { contains: "час не указан", mode: "insensitive" } }, select: { id: true, title: true, details: true } });
  const plan = evs.map((e) => ({ ...e, after: clean(e.details ?? "") || null }));
  for (const p of plan) console.log(p.title, JSON.stringify(p.details), "→", JSON.stringify(p.after));
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  writeFileSync(join(__dirname, "..", "docs-inventory", "corrections-journal-event-details-2026-10-14.json"), JSON.stringify(evs, null, 1));
  for (const p of plan) await prisma.shipmentEvent.update({ where: { id: p.id }, data: { details: p.after } });
  console.log("готово");
}
main().then(() => process.exit(0));
