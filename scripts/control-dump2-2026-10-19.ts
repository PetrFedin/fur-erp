/** Выгрузка вкладок «Сверка» и «Проверка данных» (только чтение). */
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { loadLive } from "../src/app/(app)/reconciliation/live";
import { groupInvoices, totalsOf, visibleFor, SUPERSEDED, RECHECK, JSON_REGISTRY } from "../src/app/(app)/reconciliation/model";
import { getIntegrityReport } from "../src/lib/integrity";
import { prisma } from "../src/lib/prisma";

(async () => {
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const live = await loadLive(org);
  const { ids, groups } = visibleFor("all", JSON_REGISTRY);
  const out = groups.map((g) => {
    const list = groupInvoices(g, ids, JSON_REGISTRY);
    const t = totalsOf(list);
    const db = live.group.get(g.id);
    return { id: g.id, title: g.title, section: g.section, status: g.status, year: g.year, house: g.house, totals: t, db, invoices: list.map((c) => ({ no: c.inv.no, date: c.inv.date, amount: c.amount, status: c.status, paid: c.paid, pct: c.pct, confirm: c.confirm, id: c.inv.id })) };
  });
  const invDb = [...live.inv.entries()].map(([id, v]) => ({ id, paid: v.paid, pays: v.pays }));
  const rep = await getIntegrityReport(org, { force: true });
  const integ = rep ? rep.results.filter((c) => c.status !== "ok").map((c) => ({ id: c.id, title: c.title, severity: c.severity, status: c.status, violations: c.violations, known: c.known.length })) : null;
  writeFileSync("docs-inventory/control-review-2026-10-19/dump-recon.json", JSON.stringify({ groups: out, invDb, orphans: live.orphans, integrity: integ, superseded: SUPERSEDED.length, recheck: RECHECK }, null, 1));
  console.log(out.length, "groups; orphans", live.orphans.length, "integrity non-ok", integ?.length);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
