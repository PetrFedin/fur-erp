/**
 * Дата торгов аукциона «СП 09.26» в справочнике: 30.09.2026 (письмо Василия «Прошла закупка на аукционе в Санкт-Петербурге»),
 * в справочнике стояло 29.09.2026. Пробный прогон по умолчанию; --apply --live пишет в боевую (сам делает scripts/backup.sh);
 * --rollback --apply возвращает прежнюю дату по журналу docs-inventory/corrections-journal-auction-date-sp0926-2026-10-15.json
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
const APPLY = process.argv.includes("--apply"), LIVE = process.argv.includes("--live"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "../docs-inventory/corrections-journal-auction-date-sp0926-2026-10-15.json");
async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:auction-date-sp0926");
  const db = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
  console.log(`База: ${db}${APPLY ? " · ЗАПИСЬ" : " · пробный прогон"}`);
  if (APPLY && db === "fur_erp" && !LIVE) throw new Error("боевая база: нужен явный --live");
  const rows = await prisma.auction.findMany({ where: { name: { in: ["СП 09.26", "СП 09-26"] } }, select: { id: true, name: true, auctionDate: true } });
  console.log(rows.map((r) => `${r.name}: ${r.auctionDate?.toISOString().slice(0, 10) ?? "—"}`).join("\n") || "аукцион не найден");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string; before: string | null }[];
    if (APPLY) for (const x of j) await prisma.auction.update({ where: { id: x.id }, data: { auctionDate: x.before ? new Date(x.before) : null } });
    return console.log(APPLY ? "откат выполнен" : "пробный откат");
  }
  const todo = rows.filter((r) => r.auctionDate?.toISOString().slice(0, 10) !== "2026-09-30");
  console.log(`→ поставить 30.09.2026: ${todo.length}`);
  if (!APPLY || !todo.length) return;
  if (LIVE) execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const prev = existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf8")) as unknown[]) : [];
  for (const r of todo) { prev.push({ id: r.id, before: r.auctionDate?.toISOString() ?? null }); await prisma.auction.update({ where: { id: r.id }, data: { auctionDate: new Date(Date.UTC(2026, 8, 30)) } }); }
  writeFileSync(JOURNAL, JSON.stringify(prev, null, 1));
  console.log("готово");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
