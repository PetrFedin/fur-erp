/**
 * ПЕРЕПОДТВЕРЖДЕНИЕ закупок, которые были подтверждены, а потом обновлены (метка updatedAt новее подтверждения, в журнале правок
 * этого обновления нет — проверка «verified-updated-at» самопроверки). Решение владельца 08.10.2026: если запись сопоставляется
 * с документами — значит, она правильная, подтверждение ставится заново.
 *
 * Подтверждается ТОЛЬКО если одновременно:
 *   1) единая логика src/lib/verification.ts (loadVerifyModel) не находит блокеров у записи сейчас, И
 *   2) отчёты docs-inventory/chain-p2025.json / chain-p2026.json подтверждают «сходится на 100%» (matches.all100) для этой закупки.
 * Данные закупки НЕ меняются, только отметка подтверждения (verifiedAt / verifiedBy / verifyNote).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/reverify-purchases.ts                      # пробный прогон (ничего не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/reverify-purchases.ts --apply              # применить (перед этим scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/reverify-purchases.ts --rollback           # вернуть прежние отметки по журналу
 *   --numbers=З-2026-0003,З-2026-0005                                                              # какие закупки (по умолчанию эти две)
 * Журнал: docs-inventory/corrections-journal-reverify-purchases.json
 */
import Module from "module";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return origResolve.call(this, req, ...rest);
};

const INV = join(__dirname, "..", "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-reverify-purchases.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const NUMBERS = (args.find((a) => a.startsWith("--numbers="))?.slice("--numbers=".length) ?? "З-2026-0003,З-2026-0005").split(",").map((s) => s.trim()).filter(Boolean);
const BASIS = "auto:reverify-docs-2026-10-08";

type Entry = { time: string; id: string; number: string; before: { verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null }; after: { verifiedAt: string; verifiedBy: string; verifyNote: string }; rolledBack?: string };
const readJournal = (): Entry[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);
const writeJournal = (e: Entry[]) => writeFileSync(JOURNAL, JSON.stringify(e, null, 1));
type Chain = { groups: { key: string; db?: { purchases?: string[] }; matches?: Record<string, boolean | null> }[] };
const readChain = (f: string): Chain => JSON.parse(readFileSync(join(INV, f), "utf-8"));
const ru = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { loadVerifyModel } = await import("@/lib/verification");
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) throw new Error("нет организации");

    if (ROLLBACK) {
      const journal = readJournal();
      let n = 0;
      for (const e of journal) {
        if (e.rolledBack) continue;
        const cur = await prisma.purchase.findUnique({ where: { id: e.id }, select: { verifiedBy: true } });
        if (!cur || cur.verifiedBy !== BASIS) { e.rolledBack = `${new Date().toISOString()} (уже изменено — пропущено)`; continue; }
        if (APPLY) {
          await prisma.purchase.update({ where: { id: e.id }, data: { verifiedAt: e.before.verifiedAt ? new Date(e.before.verifiedAt) : null, verifiedBy: e.before.verifiedBy, verifyNote: e.before.verifyNote } });
          e.rolledBack = new Date().toISOString();
        }
        n++;
      }
      if (APPLY) writeJournal(journal);
      console.log(`${APPLY ? "Откачено" : "Будет откачено (добавьте --apply)"}: ${n}`);
      return;
    }

    const model = await loadVerifyModel(prisma, org.id, { c4Mode: "off" });
    const chain100 = new Set<string>();
    for (const c of [readChain("chain-p2025.json"), readChain("chain-p2026.json")]) for (const g of c.groups) if (g.matches?.all100 === true) for (const n of g.db?.purchases ?? []) chain100.add(n);

    console.log(`\nПереподтверждение закупок (${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН"}): ${NUMBERS.join(", ")}`);
    const plan: { id: string; number: string; why: string }[] = [];
    for (const num of NUMBERS) {
      const row = model.rows.find((r) => r.kind === "purchase" && model.extra.purchaseNumber.get(r.id) === num);
      if (!row) { console.log(`  ✗ ${num}: нет в модели подтверждений`); continue; }
      const cur = await prisma.purchase.findUniqueOrThrow({ where: { id: row.id }, select: { verifiedAt: true, verifiedBy: true, updatedAt: true } });
      const in100 = chain100.has(num);
      const stale = !!cur.verifiedAt && cur.updatedAt.getTime() > cur.verifiedAt.getTime() + 60_000;
      const ok = row.ready && in100;
      console.log(`  ${ok ? "✓" : "✗"} ${num}: блокеры ${row.blockers.length}${row.blockers.length ? " (" + row.blockers.map((b) => (b as { text?: string }).text ?? JSON.stringify(b)).join("; ").slice(0, 120) + ")" : ""}; chain «сходится на 100%»: ${in100 ? "да" : "нет"}; подтверждена ${ru(cur.verifiedAt)}, обновлена ${ru(cur.updatedAt)}${stale ? " — требует переподтверждения" : " — переподтверждение не нужно"}`);
      if (ok && stale) plan.push({ id: row.id, number: num, why: `Перепроверено по документам 08.10.2026: нет блокеров, chain-p2025/p2026 «сходится на 100%» (all100); запись обновлена после подтверждения (updatedAt) без изменения данных` });
    }
    if (!APPLY) { console.log(`\nК переподтверждению: ${plan.length}. Пробный прогон: ничего не записано. Перед --apply выполните scripts/backup.sh.`); return; }

    const journal = readJournal();
    for (const p of plan) {
      const cur = await prisma.purchase.findUniqueOrThrow({ where: { id: p.id }, select: { verifiedAt: true, verifiedBy: true, verifyNote: true } });
      const now = new Date();
      await prisma.purchase.update({ where: { id: p.id }, data: { verifiedAt: now, verifiedBy: BASIS, verifyNote: p.why } });
      journal.push({ time: now.toISOString(), id: p.id, number: p.number, before: { verifiedAt: cur.verifiedAt?.toISOString() ?? null, verifiedBy: cur.verifiedBy, verifyNote: cur.verifyNote }, after: { verifiedAt: now.toISOString(), verifiedBy: BASIS, verifyNote: p.why } });
      writeJournal(journal); // после каждой правки — падение посередине не теряет уже сделанное
      console.log(`  переподтверждена ${p.number}`);
    }
    console.log(`\nГотово: ${plan.length}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
