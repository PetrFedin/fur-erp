/**
 * ПОДТВЕРЖДЕНИЕ ОПЛАТ ПО АКТАМ СВЕРКИ (ММ–Веллмех на 30.06.2026, письмо №114 архива backup.pst).
 * Решение владельца 08.10.2026: если платёж сопоставлен с документом один к одному — подтвердить.
 *
 * Подтверждается оплата (поставщику или производства) ТОЛЬКО если одновременно:
 *   1) в акте есть платёж с таким п/п, датой и суммой; в приложении этой дате и сумме соответствует ровно одна запись либо
 *      несколько записей-частей одного п/п, сумма которых равна сумме по акту (п/п 60610 разнесён на 8 частей);
 *   2) единая логика src/lib/verification.ts (loadVerifyModel) не находит у записи блокеров (документы, привязки есть).
 * Номер п/п из акта дописывается в основание (docRef), если его там нет. Суммы, даты, привязки не меняются.
 * НЕ подтверждается: п/п 22618 (в акте и в приложении суммы расходятся на 6 265), всё, чего нет в акте (после 30.06.2026).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-payments-by-acts.ts            # пробный прогон (ничего не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-payments-by-acts.ts --apply    # применить (перед этим scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-payments-by-acts.ts --rollback --apply
 * Нужен файл docs-inventory/act-payments-2026-06-30.json (платежи актов). Журнал: docs-inventory/corrections-journal-confirm-by-acts.json
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
const JOURNAL = join(INV, "corrections-journal-confirm-by-acts.json");
const ACTS = join(INV, "act-payments-2026-06-30.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const BASIS = "auto:act-sverki-2026-06-30";

type Kind = "payment" | "prodPayment";
type Snap = { docRef: string | null; confirmedAt: string | null; confirmedBy: string | null };
type Entry = { time: string; entity: Kind; id: string; label: string; before: Snap; after: Snap; rolledBack?: string };
type ActPay = { contract: "2502" | "1605"; num: string; date: string; amount: number };

const readJournal = (): Entry[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);
const writeJournal = (e: Entry[]) => writeFileSync(JOURNAL, JSON.stringify(e, null, 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ru = (isoDate: string) => isoDate.split("-").reverse().join(".");
const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

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
        const cur = e.entity === "payment"
          ? await prisma.payment.findUnique({ where: { id: e.id }, select: { confirmedBy: true } })
          : await prisma.productionPayment.findUnique({ where: { id: e.id }, select: { confirmedBy: true } });
        if (!cur || cur.confirmedBy !== BASIS) { e.rolledBack = `${new Date().toISOString()} (уже изменено — пропущено)`; continue; }
        if (APPLY) {
          const data = { docRef: e.before.docRef, confirmedAt: e.before.confirmedAt ? new Date(e.before.confirmedAt) : null, confirmedBy: e.before.confirmedBy };
          if (e.entity === "payment") await prisma.payment.update({ where: { id: e.id }, data });
          else await prisma.productionPayment.update({ where: { id: e.id }, data });
          e.rolledBack = new Date().toISOString();
        }
        n++;
      }
      if (APPLY) writeJournal(journal);
      console.log(`${APPLY ? "Откачено" : "Будет откачено (добавьте --apply)"}: ${n}`);
      return;
    }

    if (!existsSync(ACTS)) throw new Error(`нет файла ${ACTS}`);
    const acts: ActPay[] = JSON.parse(readFileSync(ACTS, "utf-8")).payments;
    const model = await loadVerifyModel(prisma, org.id, { c4Mode: "off" });
    const readiness = new Map<string, { ready: boolean; blockers: string }>();
    for (const r of model.rows) if (r.kind === "payment" || r.kind === "prodPayment") readiness.set(`${r.kind}:${r.id}`, { ready: r.ready, blockers: r.blockers.map((b) => (b as { text?: string; message?: string }).text ?? (b as { message?: string }).message ?? JSON.stringify(b)).join("; ") });

    const [pay, prod] = await Promise.all([
      prisma.payment.findMany({ where: { organizationId: org.id }, select: { id: true, amount: true, paidAt: true, docRef: true, confirmedAt: true, confirmedBy: true } }),
      prisma.productionPayment.findMany({ where: { organizationId: org.id }, select: { id: true, amount: true, paidAt: true, docRef: true, confirmedAt: true, confirmedBy: true } }),
    ]);
    type Row = { kind: Kind; id: string; amount: number; date: string; docRef: string | null; confirmedAt: Date | null; confirmedBy: string | null };
    const rows: Row[] = [
      ...pay.map((x) => ({ kind: "payment" as Kind, id: x.id, amount: Number(x.amount), date: iso(x.paidAt), docRef: x.docRef, confirmedAt: x.confirmedAt, confirmedBy: x.confirmedBy })),
      ...prod.map((x) => ({ kind: "prodPayment" as Kind, id: x.id, amount: Number(x.amount), date: iso(x.paidAt), docRef: x.docRef, confirmedAt: x.confirmedAt, confirmedBy: x.confirmedBy })),
    ];

    console.log(`\nПодтверждение оплат по актам сверки на 30.06.2026 (${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН"}), основание ${BASIS}`);
    const plan: { row: Row; act: ActPay }[] = [];
    const skipped: string[] = [];
    const claimed = new Set<string>();
    for (const a of acts) {
      // 1) запись одного вида с точной датой и суммой; 2) части одного п/п: все записи одного вида на дату, сумма которых = сумме акта
      let hit: Row[] = [];
      const sum = (xs: Row[]) => xs.reduce((s, r) => s + r.amount, 0);
      const numRx = new RegExp(`п/п\\s*№?\\s*0*${a.num}\\b`);
      const byNum = rows.filter((r) => r.date === a.date && numRx.test(r.docRef ?? ""));
      if (byNum.length > 0 && near(sum(byNum), a.amount)) hit = byNum;
      for (const kind of ["payment", "prodPayment"] as Kind[]) {
        if (hit.length) break;
        const cand = rows.filter((r) => r.kind === kind && r.date === a.date);
        const exact = cand.filter((r) => near(r.amount, a.amount));
        if (exact.length === 1) { hit = exact; break; }
        if (cand.length > 1 && near(sum(cand), a.amount)) { hit = cand; break; }
      }
      if (!hit.length) {
        const both = rows.filter((r) => r.date === a.date);
        if (both.length > 1 && near(sum(both), a.amount)) hit = both; // п/п разнесён между оплатами поставщику и производства
      }
      if (hit.length === 0) { skipped.push(`п/п ${a.num} ${ru(a.date)} ${rub(a.amount)}: в приложении нет однозначного соответствия — не подтверждается`); continue; }
      for (const r of hit) {
        if (claimed.has(`${r.kind}:${r.id}`)) continue;
        claimed.add(`${r.kind}:${r.id}`);
        plan.push({ row: r, act: a });
      }
    }

    const todo: { row: Row; act: ActPay; docRef: string }[] = [];
    for (const { row, act } of plan) {
      const rd = readiness.get(`${row.kind}:${row.id}`);
      const label = `${row.kind === "payment" ? "оплата поставщику" : "оплата производства"} п/п ${act.num} ${ru(act.date)} ${rub(row.amount)}`;
      if (row.confirmedAt) { continue; }
      const onlyRefBlocker = !!rd && !rd.ready && rd.blockers.split("; ").every((b) => b.startsWith("в основании только"));
      if (!rd || (!rd.ready && !onlyRefBlocker)) { skipped.push(`${label}: есть блокеры (${rd?.blockers || "нет в модели"}) — не подтверждается`); continue; }
      const has = new RegExp(`п/п\\s*№?\\s*0*${act.num}\\b`).test(row.docRef ?? "");
      const docRef = has ? (row.docRef ?? "") : `п/п №${act.num} от ${ru(act.date)} (акт сверки на 30.06.2026)${row.docRef ? "; " + row.docRef : ""}`;
      console.log(`  ✓ ${label}${has ? "" : " (+ п/п в основание)"}`);
      todo.push({ row, act, docRef });
    }
    for (const s of skipped) console.log(`  ✗ ${s}`);
    const already = plan.filter((p) => p.row.confirmedAt).length;
    console.log(`\nК подтверждению: ${todo.length}; уже подтверждено: ${already}; не подтверждается: ${skipped.length}`);
    if (!APPLY) { console.log("Пробный прогон: ничего не записано. Перед --apply выполните scripts/backup.sh."); return; }

    const journal = readJournal();
    for (const t of todo) {
      const now = new Date();
      const before: Snap = { docRef: t.row.docRef, confirmedAt: null, confirmedBy: t.row.confirmedBy };
      const data = { docRef: t.docRef, confirmedAt: now, confirmedBy: BASIS };
      if (t.row.kind === "payment") await prisma.payment.update({ where: { id: t.row.id }, data });
      else await prisma.productionPayment.update({ where: { id: t.row.id }, data });
      journal.push({ time: now.toISOString(), entity: t.row.kind, id: t.row.id, label: `п/п ${t.act.num} ${ru(t.act.date)} ${rub(t.row.amount)}`, before, after: { docRef: t.docRef, confirmedAt: now.toISOString(), confirmedBy: BASIS } });
      writeJournal(journal); // после каждой правки — падение посередине не теряет уже сделанное
    }
    console.log(`\nГотово: подтверждено ${todo.length}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
