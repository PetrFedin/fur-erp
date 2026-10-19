/**
 * Выгрузка всего, что ждёт ответа в «Контроле» (только чтение): задачи, подтверждения, пробелы документов, сверка.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/control-dump-2026-10-19.ts [out.json]
 */
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { loadControlCounts } from "../src/lib/control-counts";
import { buildAttentionBlocks, computeAttention } from "../src/lib/attention";
import { loadVerifyModel } from "../src/lib/verification";
import { loadTaskBlocks, stripCoveredPayments } from "../src/lib/task-docs";
import { computeDocCoverage } from "../src/lib/doc-coverage";

const prisma = new PrismaClient();
(async () => {
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const counts = await loadControlCounts(org, "all", { fresh: true });
  const tb = await loadTaskBlocks(prisma as never, org);
  const att = stripCoveredPayments(await computeAttention(prisma as never, org, "all"), tb.coveredPaymentIds);
  const blocks = buildAttentionBlocks(att);
  const model = await loadVerifyModel(prisma as never, org, { userId: "dump", c4Mode: "off", canUpload: false, canMark: false });
  const cov = await computeDocCoverage(prisma as never, org);
  const out = {
    counts: { ...counts, blocks: undefined },
    attentionBlocks: blocks.map((b) => ({ id: b.id, title: b.meta.title, kind: b.meta.kind, priority: b.priority, count: b.count, rows: (b as unknown as { entities?: unknown[] }).entities ?? (b as unknown as { rows?: unknown[] }).rows })),
    docTasks: tb.docTasks.filter((d) => d.open).map((d) => ({ ...d.task, open: d.open, counts: d.counts, amount: d.amount, overdueDays: d.overdueDays, have: d.have, need: d.need, missing: d.missing, record: d.recordHref })),
    decisions: tb.decisions.filter((d) => d.open),
    verifyWaiting: model.rows.filter((r) => !r.verified && !r.zero).map((r) => ({ kind: r.kind, id: r.id, title: r.title, sub: r.sub, year: r.year, amount: r.amountText, ready: r.ready, blockers: r.blockers.map((x) => x.text), edit: r.edit, letter: r.letter, registryFact: r.registryFact, group: r.group, note: r.note })),
    verifyCounts: model.rows.reduce((a: Record<string, { all: number; waiting: number }>, r) => { (a[r.kind] ??= { all: 0, waiting: 0 }).all++; if (!r.verified && !r.zero) a[r.kind].waiting++; return a; }, {}),
    docGaps: cov.rows.filter((r) => r.gaps.length || r.extras.some((e) => !e.ok)).map((r) => ({ section: r.section, number: r.number, title: r.title, sub: r.sub, year: r.year, href: r.href, gaps: r.gaps.map((g) => g.label), extras: r.extras.filter((e) => !e.ok).map((e) => e.text) })),
    docSections: cov.sections, docTotal: cov.total,
  };
  writeFileSync(process.argv[2] ?? "docs-inventory/control-review-2026-10-19/dump.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ counts: out.counts, blocks: out.attentionBlocks.map((b) => [b.id, b.count]), docTasks: out.docTasks.length, decisions: out.decisions.length, verify: out.verifyCounts, gaps: out.docGaps.length, total: out.docTotal }));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
