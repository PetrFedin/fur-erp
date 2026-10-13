/**
 * Бэкфилл Payment/ProductionPayment.invoiceNo и .ppNo из строки основания docRef — 14.10.2026, НЕ ПРИМЕНЁН.
 * Нужна применённая миграция 20261014120000_payment_invoice_pp_invoice_table и `prisma generate`.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/backfill-payment-invoice-pp-2026-10-14.ts            # пробный прогон (БД не меняется)
 *   node --env-file=.env node_modules/.bin/tsx scripts/backfill-payment-invoice-pp-2026-10-14.ts --apply    # записать (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/backfill-payment-invoice-pp-2026-10-14.ts --rollback  # откат по журналу (пробный); с --apply — выполнить
 *
 * Разбор — теми же регулярками, что карточка оплаты (src/lib/payment-refs.ts: PP_RX «п/п № N», INV_RX «счёт № N»).
 * Берётся только однозначное: в docRef ровно один номер п/п и/или ровно один номер счёта (несколько разных — строка пропускается).
 * Поле, которое уже заполнено, не трогается. docRef не меняется. Журнал: docs-inventory/corrections-journal-payment-invoice-pp-2026-10-14.json
 * (id, прежние значения полей — всегда пустые) — откат возвращает именно их.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");

type Model = "payment" | "productionPayment";
type Plan = { model: Model; id: string; docRef: string; invoiceNo: string | null; ppNo: string | null };
type Journal = { script: string; status: "applied" | "rolled-back"; at: string; updated: { model: Model; id: string; setInvoiceNo: boolean; setPpNo: boolean }[] };

function uniq(re: RegExp, text: string): string | null | "ambiguous" {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const found = new Set<string>();
  for (const m of text.matchAll(g)) found.add(m[1]);
  if (found.size === 0) return null;
  return found.size === 1 ? [...found][0] : "ambiguous";
}

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { PP_RX, INV_RX } = await import("../src/lib/payment-refs");
  const prisma = createAuditedClient("script:backfill-payment-invoice-pp-2026-10-14");
  const JOURNAL = join(INV, "corrections-journal-payment-invoice-pp-2026-10-14.json");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат: вернуть пустые invoiceNo/ppNo у ${j.updated.length} оплат.`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        for (const u of j.updated) {
          const data = { ...(u.setInvoiceNo ? { invoiceNo: null } : {}), ...(u.setPpNo ? { ppNo: null } : {}) };
          await (tx[u.model] as unknown as { update: (a: unknown) => Promise<unknown> }).update({ where: { id: u.id }, data });
        }
      });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    } else console.log("Пробный прогон отката: БД не менялась. Для отката — --rollback --apply.");
    await prisma.$disconnect();
    return;
  }

  const plans: Plan[] = [];
  const skipped: { model: Model; id: string; docRef: string; why: string }[] = [];
  let untouched = 0;
  for (const model of ["payment", "productionPayment"] as Model[]) {
    const rows: { id: string; docRef: string | null; invoiceNo: string | null; ppNo: string | null }[] = await (prisma[model] as unknown as { findMany: (a: unknown) => Promise<never> }).findMany({
      where: { docRef: { not: null }, OR: [{ invoiceNo: null }, { ppNo: null }] },
      select: { id: true, docRef: true, invoiceNo: true, ppNo: true },
    });
    for (const r of rows) {
      const text = r.docRef ?? "";
      const pp = r.ppNo ? null : uniq(PP_RX, text);
      const inv = r.invoiceNo ? null : uniq(INV_RX, text);
      if (pp === "ambiguous" || inv === "ambiguous") { skipped.push({ model, id: r.id, docRef: text, why: "в основании несколько разных номеров" }); continue; }
      if (!pp && !inv) { untouched++; continue; }
      plans.push({ model, id: r.id, docRef: text, invoiceNo: inv, ppNo: pp });
    }
  }
  console.log(`К записи: ${plans.length} оплат (п/п: ${plans.filter((p) => p.ppNo).length}, счёт: ${plans.filter((p) => p.invoiceNo).length}). Пропущено неоднозначных: ${skipped.length}. Без номеров в основании: ${untouched}.`);
  for (const p of plans.slice(0, 15)) console.log(`  ${p.model} …${p.id.slice(-6)}: «${p.docRef.slice(0, 70)}» → п/п ${p.ppNo ?? "—"}, счёт ${p.invoiceNo ?? "—"}`);
  if (plans.length > 15) console.log(`  … и ещё ${plans.length - 15}`);
  for (const s of skipped.slice(0, 10)) console.log(`  ПРОПУСК ${s.model} …${s.id.slice(-6)}: «${s.docRef.slice(0, 70)}» — ${s.why}`);
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённый бэкфилл — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  await prisma.$transaction(async (tx) => {
    for (const p of plans) {
      const data = { ...(p.invoiceNo ? { invoiceNo: p.invoiceNo } : {}), ...(p.ppNo ? { ppNo: p.ppNo } : {}) };
      await (tx[p.model] as unknown as { update: (a: unknown) => Promise<unknown> }).update({ where: { id: p.id }, data });
    }
  });
  const journal: Journal = {
    script: "backfill-payment-invoice-pp-2026-10-14", status: "applied", at: new Date().toISOString(),
    updated: plans.map((p) => ({ model: p.model, id: p.id, setInvoiceNo: !!p.invoiceNo, setPpNo: !!p.ppNo })),
  };
  writeJson(JOURNAL, journal);
  console.log(`Записано: ${plans.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
