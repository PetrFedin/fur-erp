/**
 * АВТОПОДТВЕРЖДЕНИЕ строк по документам: ставит «подтверждено» (verifiedBy = "auto:docs-chain-2026-10-04") ТОЛЬКО там, где
 *   1) единая логика src/lib/verification.ts (computeReadiness) не находит блокеров, И
 *   2) отчёты docs-inventory/chain-*.json подтверждают «сходится на 100%»:
 *      • закупка — группа chain-p2025/p2026 с matches.all100 = true (УПД = база ±1 ₽, счета = УПД, оплата = документы, лоты);
 *      • платёж поставщику — оплата с п/п, «факт» с суммой и датой в реестре сверки и в chain-p2025/p2026 (п/п и дата совпали);
 *      • ТЗ и партия — группа партии в chain-production с all100 (или all100_docs: по документам остаток 0) и все прочие условия;
 *      • оплата производства — п/п в основании + «факт» в документах (в основании только «Счёт №…» — НЕ подтверждается).
 *   Всё «приблизительно / гипотеза / согласовано без факта / дата по письму / подкладка» остаётся «ждёт ручной проверки».
 *
 * Запуск (по умолчанию DRY-RUN — ничего не пишет, печатает план):
 *   node --env-file=.env node_modules/.bin/tsx scripts/auto-verify-by-documents.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/auto-verify-by-documents.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/auto-verify-by-documents.ts --rollback
 * ПЕРЕД --apply: scripts/backup.sh. Идемпотентно (уже подтверждённые строки не трогаются).
 * Журнал: docs-inventory/corrections-journal-auto-verify.json; --rollback снимает ТОЛЬКО авто-отметки, которые не менялись людьми.
 */
import Module from "module";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// «server-only» в Next — служебный пакет; в обычном Node его нет, подставляем пустышку.
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return origResolve.call(this, req, ...rest);
};

const INV = join(__dirname, "..", "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-auto-verify.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");

type Entry = { time: string; entity: string; id: string; label: string; before: Record<string, unknown>; after: Record<string, unknown>; source: string; rolledBack?: string };
const readJournal = (): Entry[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);
const writeJournal = (e: Entry[]) => writeFileSync(JOURNAL, JSON.stringify(e, null, 1));

type Chain = { groups: { key: string; kind?: string; batchNumber?: number | null; db?: { purchases?: string[] }; matches?: Record<string, boolean | null>; paymentsByDocs?: { date: string; ppNo: string | null; amountRub: number }[] }[] };
const readChain = (f: string): Chain => JSON.parse(readFileSync(join(INV, f), "utf-8"));

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { loadVerifyModel, AUTO_BASIS } = await import("@/lib/verification");
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) throw new Error("нет организации");
    const orgId = org.id;

    if (ROLLBACK) {
      const journal = readJournal();
      let n = 0;
      let skipped = 0;
      for (const e of journal) {
        if (e.rolledBack) continue;
        const by = e.after.verifiedBy ?? e.after.confirmedBy;
        let cur: Record<string, unknown> | null = null;
        if (e.entity === "purchase") cur = await prisma.purchase.findUnique({ where: { id: e.id }, select: { verifiedBy: true } });
        else if (e.entity === "order") cur = await prisma.productionOrder.findUnique({ where: { id: e.id }, select: { verifiedBy: true } });
        else if (e.entity === "batch") cur = await prisma.productionBatch.findUnique({ where: { id: e.id }, select: { verifiedBy: true } });
        else if (e.entity === "payment") cur = await prisma.payment.findUnique({ where: { id: e.id }, select: { confirmedBy: true } });
        else if (e.entity === "prodPayment") cur = await prisma.productionPayment.findUnique({ where: { id: e.id }, select: { confirmedBy: true } });
        const now = cur ? (cur.verifiedBy ?? cur.confirmedBy) : undefined;
        if (!cur || now !== by) {
          skipped++; // строку уже сбросили или переподтвердили — не трогаем
          e.rolledBack = `${new Date().toISOString()} (уже изменено — пропущено)`;
          continue;
        }
        if (APPLY || args.includes("--yes")) {
          if (e.entity === "purchase") await prisma.purchase.update({ where: { id: e.id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } });
          else if (e.entity === "order") await prisma.productionOrder.update({ where: { id: e.id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } });
          else if (e.entity === "batch") await prisma.productionBatch.update({ where: { id: e.id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } });
          else if (e.entity === "payment") await prisma.payment.update({ where: { id: e.id }, data: { confirmedAt: null, confirmedBy: null } });
          else await prisma.productionPayment.update({ where: { id: e.id }, data: { confirmedAt: null, confirmedBy: null } });
          e.rolledBack = new Date().toISOString();
        }
        n++;
      }
      if (APPLY || args.includes("--yes")) writeJournal(journal);
      console.log(`${APPLY || args.includes("--yes") ? "Откачено" : "Будет откачено (добавьте --apply)"}: ${n}; пропущено (изменены людьми): ${skipped}`);
      return;
    }

    const model = await loadVerifyModel(prisma, orgId, { c4Mode: "off" });
    const chains = [readChain("chain-p2025.json"), readChain("chain-p2026.json")];
    const prodChain = readChain("chain-production.json");

    // --- свидетельства из chain-*.json
    const chainPurchase100 = new Set<string>();
    for (const c of chains) for (const g of c.groups) if (g.matches?.all100 === true) for (const n of g.db?.purchases ?? []) chainPurchase100.add(n);
    const chainBatch100 = new Map<number, "all100" | "docs">();
    for (const g of prodChain.groups) {
      if (g.batchNumber == null) continue;
      if (g.matches?.all100 === true) chainBatch100.set(g.batchNumber, "all100");
      else if (g.matches?.all100_docs === true) chainBatch100.set(g.batchNumber, "docs");
    }
    const chainPays = chains.flatMap((c) => c.groups.flatMap((g) => g.paymentsByDocs ?? []));

    type Plan = { kind: "payment" | "prodPayment" | "purchase" | "order" | "batch"; id: string; label: string; why: string };
    const plan: Plan[] = [];
    const skip: Record<string, { already: number; blocked: number; noEvidence: number }> = {};
    const bump = (k: string, f: "already" | "blocked" | "noEvidence") => ((skip[k] ??= { already: 0, blocked: 0, noEvidence: 0 })[f]++);

    for (const r of model.rows) {
      if (r.verified) { bump(r.kind, "already"); continue; }
      if (!r.ready) { bump(r.kind, "blocked"); continue; }
      let why: string | null = null;
      if (r.kind === "payment") {
        const pp = model.extra.paymentPp.get(r.key);
        const inChain = !!pp?.ppNo && chainPays.some((x) => x.ppNo === pp.ppNo && x.date === pp.paidIso);
        if (pp?.ppNo && r.registryFact && inChain) why = `${r.registryFact}; chain-p2025/p2026: п/п №${pp.ppNo}`;
      } else if (r.kind === "prodPayment") {
        const pp = model.extra.paymentPp.get(r.key);
        if (pp?.ppNo && r.registryFact) why = r.registryFact;
      } else if (r.kind === "purchase") {
        const no = model.extra.purchaseNumber.get(r.id);
        if (no && chainPurchase100.has(no)) why = `chain: группа «сходится на 100%» (all100), закупка ${no}`;
      } else if (r.kind === "order") {
        const bn = model.extra.orderBatchNumber.get(r.id);
        const ev = bn != null ? chainBatch100.get(bn) : undefined;
        if (ev) why = `chain-production: партия ${bn} — ${ev === "all100" ? "all100" : "all100_docs (по документам остаток 0)"}`;
      } else if (r.kind === "batch") {
        const bn = model.extra.batchNumber.get(r.id);
        const ev = bn != null ? chainBatch100.get(bn) : undefined;
        if (ev) why = `chain-production: партия ${bn} — ${ev === "all100" ? "all100" : "all100_docs (по документам остаток 0)"}`;
      }
      if (why) plan.push({ kind: r.kind, id: r.id, label: `${r.title} ${r.sub ?? ""}`.trim(), why });
      else bump(r.kind, "noEvidence");
    }

    console.log(`\nАвтоподтверждение по документам (${APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN"}), основание ${AUTO_BASIS}`);
    for (const k of ["payment", "prodPayment", "purchase", "order", "batch"] as const) {
      const rows = model.rows.filter((x) => x.kind === k);
      const s = skip[k] ?? { already: 0, blocked: 0, noEvidence: 0 };
      const p = plan.filter((x) => x.kind === k);
      console.log(`  ${k.padEnd(12)} всего ${String(rows.length).padStart(3)} | к подтверждению ${String(p.length).padStart(3)} | уже подтверждено ${s.already} | есть блокеры ${s.blocked} | готовы, но нет 100% в chain ${s.noEvidence}`);
      for (const x of p) console.log(`      + ${x.label.slice(0, 90)}  <- ${x.why}`);
    }
    const readyNoEvidence = model.rows.filter((r) => !r.verified && r.ready && !plan.some((p) => p.kind === r.kind && p.id === r.id));
    if (readyNoEvidence.length) console.log(`\nГотовы без блокеров, но chain 100% не подтверждает (ждут вашего нажатия): ${readyNoEvidence.length}`);

    if (!APPLY) {
      console.log("\nDRY-RUN: ничего не записано. Перед --apply выполните scripts/backup.sh.");
      return;
    }

    // --- применение: оплаты → закупки → ТЗ → (пересчёт) партии
    const journal = readJournal();
    const now = new Date();
    const doOne = async (p: Plan) => {
      let before: Record<string, unknown> = {};
      let after: Record<string, unknown> = {};
      if (p.kind === "purchase") {
        const cur = await prisma.purchase.findUniqueOrThrow({ where: { id: p.id }, select: { verifiedAt: true, verifiedBy: true, verifyNote: true } });
        if (cur.verifiedAt) return;
        before = cur; after = { verifiedAt: now.toISOString(), verifiedBy: AUTO_BASIS, verifyNote: p.why };
        await prisma.purchase.update({ where: { id: p.id }, data: { verifiedAt: now, verifiedBy: AUTO_BASIS, verifyNote: p.why } });
      } else if (p.kind === "order") {
        const cur = await prisma.productionOrder.findUniqueOrThrow({ where: { id: p.id }, select: { verifiedAt: true, verifiedBy: true, verifyNote: true } });
        if (cur.verifiedAt) return;
        before = cur; after = { verifiedAt: now.toISOString(), verifiedBy: AUTO_BASIS, verifyNote: p.why };
        await prisma.productionOrder.update({ where: { id: p.id }, data: { verifiedAt: now, verifiedBy: AUTO_BASIS, verifyNote: p.why } });
      } else if (p.kind === "batch") {
        const cur = await prisma.productionBatch.findUniqueOrThrow({ where: { id: p.id }, select: { verifiedAt: true, verifiedBy: true, verifyNote: true } });
        if (cur.verifiedAt) return;
        before = cur; after = { verifiedAt: now.toISOString(), verifiedBy: AUTO_BASIS, verifyNote: p.why };
        await prisma.productionBatch.update({ where: { id: p.id }, data: { verifiedAt: now, verifiedBy: AUTO_BASIS, verifyNote: p.why } });
      } else if (p.kind === "payment") {
        const cur = await prisma.payment.findUniqueOrThrow({ where: { id: p.id }, select: { confirmed: true, confirmedAt: true, confirmedBy: true } });
        if (cur.confirmedAt) return;
        before = cur; after = { confirmed: true, confirmedAt: now.toISOString(), confirmedBy: AUTO_BASIS };
        await prisma.payment.update({ where: { id: p.id }, data: { confirmedAt: now, confirmedBy: AUTO_BASIS } });
      } else {
        const cur = await prisma.productionPayment.findUniqueOrThrow({ where: { id: p.id }, select: { confirmed: true, confirmedAt: true, confirmedBy: true } });
        if (cur.confirmedAt) return;
        before = cur; after = { confirmed: true, confirmedAt: now.toISOString(), confirmedBy: AUTO_BASIS };
        await prisma.productionPayment.update({ where: { id: p.id }, data: { confirmedAt: now, confirmedBy: AUTO_BASIS } });
      }
      journal.push({ time: new Date().toISOString(), entity: p.kind, id: p.id, label: p.label, before, after, source: p.why });
      writeJournal(journal); // после каждой правки — падение посередине не теряет уже сделанное
    };
    for (const p of plan.filter((x) => x.kind === "payment" || x.kind === "prodPayment" || x.kind === "purchase" || x.kind === "order")) await doOne(p);

    // партии зависят от подтверждённых ТЗ — пересчёт после них
    const model2 = await loadVerifyModel(prisma, orgId, { c4Mode: "off", kinds: ["batch"] });
    for (const r of model2.rows) {
      if (r.verified || !r.ready) continue;
      const bn = model2.extra.batchNumber.get(r.id);
      const ev = bn != null ? chainBatch100.get(bn) : undefined;
      if (ev) await doOne({ kind: "batch", id: r.id, label: `${r.title}`, why: `chain-production: партия ${bn} — ${ev}` });
    }
    const done = readJournal().filter((e) => !e.rolledBack && e.after.verifiedBy === AUTO_BASIS || e.after.confirmedBy === AUTO_BASIS);
    const byKind: Record<string, number> = {};
    for (const e of done) byKind[e.entity] = (byKind[e.entity] ?? 0) + 1;
    console.log("\nГотово. Подтверждено автоматически (по журналу):", byKind);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
