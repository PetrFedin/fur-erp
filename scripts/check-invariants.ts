/**
 * Самопроверка данных (только чтение): прогоняет все инварианты src/lib/integrity и печатает результат.
 * Код выхода 1, если есть НЕизвестные расхождения (известные — с причиной — не считаются).
 *   node --env-file=.env node_modules/.bin/tsx scripts/check-invariants.ts [--json] [--all]
 *   --json  — вывести отчёт JSON;  --all — показать и известные расхождения.
 */
import Module from "module";
import { join } from "path";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return origResolve.call(this, req, ...rest);
};

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { runIntegrityChecks } = await import("../src/lib/integrity/run");
  const db = new PrismaClient();
  try {
    const orgs = await db.organization.findMany({ select: { id: true, name: true } });
    let bad = 0;
    for (const org of orgs) {
      const r = await runIntegrityChecks(db, org.id, { force: true });
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(r, null, 2));
      } else {
        console.log(`\n=== ${org.name} — ${r.checkedAt} (${r.ms} мс) ===`);
        for (const c of r.results) {
          const mark = c.status === "ok" ? "OK   " : c.status === "known" ? "ИЗВЕСТ" : c.severity === "error" ? "ОШИБКА" : c.severity === "warn" ? "ВНИМ. " : "ИНФО ";
          console.log(`${mark} ${c.id.padEnd(22)} ${c.title}  [проверено ${c.checked}; расхождений ${c.violations.length}, известных ${c.known.length}]${c.error ? "  ОШИБКА ПРОВЕРКИ: " + c.error : ""}`);
          for (const v of c.violations.slice(0, 8)) console.log(`        - ${v.message}${v.delta != null ? `  (Δ ${v.delta} ${v.unit})` : ""}  -> ${v.href}`);
          if (c.violations.length > 8) console.log(`        … ещё ${c.violations.length - 8}`);
          if (process.argv.includes("--all")) for (const v of c.known) console.log(`        ~ известно: ${v.message}\n          причина: ${v.reason}`);
        }
        console.log(`\nИтого: расхождений ${r.failing} (ошибок ${r.failingErrors}, предупреждений ${r.failingWarns}), известных ${r.knownCount}; проверок с расхождениями ${r.checksFailed} из ${r.checksTotal}.`);
      }
      if (!r.ok) bad += 1;
    }
    process.exitCode = bad ? 1 : 0;
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
