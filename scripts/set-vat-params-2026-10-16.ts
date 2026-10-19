/**
 * Принятые расчёты Веллмеха (SupplierInbox AUCTION_CALC, ACCEPTED): ставка НДС и примечания.
 *   1. В payload.params добавляется параметр «ндс_проц» («НДС, %») — его читает calcVatPct (кабинет, «Входящие», сверка, страницы закупок):
 *        SAGA 06-25 · счёт 0022-001   → 20  (основание: УПД №127 от 13.08.2025)
 *        SAGA 03-26 · счета …         → 22  (основание: УПД №229 от 04.08.2026)
 *        AME 05-26 · счёт 253         → 22  (основание: счета №167, №253, УПД №253)
 *      Формулы расчёта параметр не использует (имя «ндс_проц» в них не встречается) — итоги не меняются; скрипт это проверяет через calcAll до/после.
 *   2. Примечания: AME 05-26 — «376 куплено на аукционе, 371 по УПД №253 (5 образцов); инвойс AME №4709»;
 *      СП 09-26 — «Курс по строкам счёта 3050 = 84,4283 (ЦБ на 30.09.2026)». Текст кладётся в «Комментарий к курсу»/примечание расчёта:
 *      у СП 09-26 — payload.header.rateComment (поле «Комментарий к курсу», видно в кабинете и в Excel расчёта), у AME — вторая строка
 *      SupplierInbox.note (первая строка — служебная метка «история:…», по ней import-wellmekh-history не создаёт дубли).
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/set-vat-params-2026-10-16.ts                   # пробный прогон
 *   ... --apply            # записать (на боевой базе нужен ещё --live: скрипт сам делает bash scripts/backup.sh)
 *   ... --rollback --apply # вернуть прежние payload и note по журналу
 * Журнал: docs-inventory/corrections-journal-set-vat-2026-10-16[-<копия>].json (было: payload целиком и note). Запись — createAuditedClient("script:set-vat").
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcAll, calcVatPct, type CalcPayload } from "../src/lib/supplier-calc";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
const JOURNAL = join(__dirname, "..", "docs-inventory", `corrections-journal-set-vat-2026-10-16${dbName === "fur_erp" ? "" : `-${dbName}`}.json`);

type Rule = { prefix: string; vat: string; basis: string; note?: string; rateComment?: string };
const RULES: Rule[] = [
  { prefix: "SAGA 06-25 · счёт 0022-001", vat: "20", basis: "УПД №127 от 13.08.2025" },
  { prefix: "SAGA 03-26 · ", vat: "22", basis: "УПД №229 от 04.08.2026" },
  { prefix: "AME 05-26 · счёт 253", vat: "22", basis: "счета №167, №253, УПД №253", note: "376 куплено на аукционе, 371 по УПД №253 (5 образцов); инвойс AME №4709" },
  { prefix: "СП 09-26 · ", vat: "", basis: "", note: "Курс по строкам счёта 3050 = 84,4283 (ЦБ на 30.09.2026)", rateComment: "Курс по строкам счёта 3050 = 84,4283 (ЦБ на 30.09.2026)" },
];
type Journal = { at: string; db: string; items: { id: string; title: string; beforePayload: unknown; beforeNote: string | null }[] };
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:set-vat");
  console.log(`База: ${dbName}${dbName === "fur_erp" ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && dbName === "fur_erp" && !LIVE) { console.log("Боевая база: нужен --live. Ничего не изменено."); process.exitCode = 1; return; }
  const user = await prisma.user.findFirstOrThrow({ where: { email: "wellmekh@demo.local", role: "SUPPLIER" }, select: { organizationId: true, supplierId: true } });
  const where = { organizationId: user.organizationId, supplierId: user.supplierId!, kind: "AUCTION_CALC" as const, status: "ACCEPTED" as const };

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
    console.log(`Откат: вернуть ${j.items.length} записей`);
    if (!APPLY) return console.log("пробный откат — добавьте --apply");
    if (dbName === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
    for (const it of j.items) await prisma.supplierInbox.update({ where: { id: it.id }, data: { payload: it.beforePayload as never, note: it.beforeNote } });
    return console.log("откат выполнен");
  }

  const rows = await prisma.supplierInbox.findMany({ where, select: { id: true, title: true, payload: true, note: true } });
  const plan: { id: string; title: string; before: CalcPayload; after: CalcPayload; note: string | null; beforeNote: string | null; vat: string; basis: string }[] = [];
  for (const rule of RULES) {
    const hit = rows.filter((r) => r.title.startsWith(rule.prefix));
    if (hit.length !== 1) { console.log(`ВНИМАНИЕ: по правилу «${rule.prefix}» найдено записей: ${hit.length} — пропущено`); continue; }
    const r = hit[0];
    const before = r.payload as unknown as CalcPayload;
    const after: CalcPayload = JSON.parse(JSON.stringify(before));
    if (rule.vat) {
      const params = after.params ?? [];
      const ex = params.find((q) => /^ндс/.test(q.name.trim().toLowerCase().replace(/ё/g, "е")));
      if (ex) { if (ex.value !== rule.vat) ex.value = rule.vat; } else params.push({ name: "ндс_проц", label: "НДС, %", value: rule.vat });
      after.params = params;
    }
    if (rule.rateComment) after.header.rateComment = rule.rateComment;
    let note = r.note;
    if (rule.note) { const first = (r.note ?? "").split("\n")[0]; note = `${first}\n${rule.note}`.trim(); }
    plan.push({ id: r.id, title: r.title, before, after, note, beforeNote: r.note, vat: rule.vat, basis: rule.basis });
  }

  console.log("\nчто запишется:");
  console.log("запись | НДС до → после | основание | примечание | итого до → после | шкур | курс/НДС проверка");
  let bad = 0;
  for (const p of plan) {
    const a = calcAll(p.before), b = calcAll(p.after);
    const same = Math.abs(a.totalRub - b.totalRub) < 0.005 && a.qty === b.qty;
    if (!same) bad++;
    console.log(`${p.title.slice(0, 40)} | ${calcVatPct(p.before) ?? "—"} → ${calcVatPct(p.after) ?? "—"} | ${p.basis || "—"} | ${p.note !== p.beforeNote ? p.note!.split("\n")[1] : "—"} | ${money(a.totalRub)} → ${money(b.totalRub)} | ${a.qty} → ${b.qty}${same ? "" : " | ИТОГ ИЗМЕНИЛСЯ"}`);
    // сохраняем totals как были (итог не изменился)
  }
  if (bad) { console.log(`\nИтоги изменились у ${bad} расчётов — запись отменена.`); process.exitCode = 1; return; }
  if (!APPLY) return console.log("\nпробный прогон: БД не тронута (--apply запишет; на боевой нужен ещё --live)");
  if (dbName === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const journal: Journal = existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal) : { at: new Date().toISOString(), db: dbName, items: [] };
  for (const p of plan) {
    if (!journal.items.some((i) => i.id === p.id)) journal.items.push({ id: p.id, title: p.title, beforePayload: p.before, beforeNote: p.beforeNote });
    mkdirSync(join(__dirname, "..", "docs-inventory"), { recursive: true });
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // журнал — до записи в БД: сбой посередине не потеряет «было»
    await prisma.supplierInbox.update({ where: { id: p.id }, data: { payload: p.after as never, note: p.note } });
    console.log(`записано: ${p.title}`);
  }
  console.log(`журнал: ${JOURNAL}`);
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
