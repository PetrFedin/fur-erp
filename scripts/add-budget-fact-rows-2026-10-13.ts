/**
 * Бюджет FW27 (DRAFT): строки, которых не хватает для факта по ТЗ (бюджет по ним 0 шт.), чтобы факт попадал в свою строку «мех · категория»
 * и не оставался «за бортом»: Каракульча → «Юбка меховая» (5 изд.), Норка+Соболь → «Манжеты, муфты, варежки» (8 изд.), мех «Бобр» → «Шапка меховая» (10 изд.).
 * Пробный прогон по умолчанию; --apply (backup.sh + запись + журнал); --rollback.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/add-budget-fact-rows-2026-10-13.ts [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-budget-fact-rows-2026-10-13.json");
type N = { id: string; kind: string; parentId: string | null; name: string; [k: string]: unknown };
const blank = (id: string, kind: string, parentId: string | null, name: string, statFur: string, statCat: string): N => ({
  id, kind, parentId, name, modelId: null, pcs: 0, locked: false, hides: 0, hidePrice: 0, meters: 0, meterPrice: 0, work: 0,
  statFur, statCat, base: null, sample: 0, src: "none", upFur: null, upLining: null, upWork: null,
});

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:add-budget-fact-rows");
  const row = await prisma.budgetScenario.findFirst({ where: { name: "FW27", season: "FW27" } });
  if (!row) throw new Error("версия FW27 не найдена");
  const before = row.lines as unknown as N[];
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string; before: N[] };
    if (j.id !== row.id) throw new Error("журнал относится к другой версии");
    await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: j.before as object[] } });
    console.log("откат выполнен");
    return;
  }
  const has = (parent: string | null, name: string) => before.some((n) => n.parentId === parent && n.name === name);
  const add: N[] = [];
  if (!has("f-каракульча", "Юбка меховая")) add.push(blank("c-юбка-кар", "cat", "f-каракульча", "Юбка меховая", "Свакара", "Юбка"));
  if (!has("f-норкасоболь", "Манжеты, муфты, варежки")) add.push(blank("c-варежки-нс", "cat", "f-норкасоболь", "Манжеты, муфты, варежки", "Норка + Соболь", "Варежки"));
  if (!before.some((n) => n.kind === "fur" && n.name === "Бобр")) {
    add.push(blank("f-бобр", "fur", null, "Бобр", "", ""));
    add.push(blank("c-шапка-бобр", "cat", "f-бобр", "Шапка меховая", "Бобр", "Головной убор"));
  }
  console.log(add.length ? `добавится строк: ${add.length}: ${add.map((n) => n.name).join("; ")}` : "всё уже есть");
  if (!APPLY || !add.length) { console.log(APPLY ? "" : "пробный прогон: ничего не записано (добавьте --apply)"); return; }
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const after = [...before, ...add];
  await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: after as object[] } });
  writeFileSync(JOURNAL, JSON.stringify({ id: row.id, before, added: add.map((n) => n.id) }, null, 1));
  console.log("записано; журнал:", JOURNAL);
}
main().then(() => process.exit(0));
