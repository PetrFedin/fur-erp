/**
 * Сверка оплат ПОСТАВЩИКУ (ООО «Веллмех») с актом сверки взаиморасчётов (договор купли-продажи №2502 от 26.02.2025,
 * период до 30.06.2026; Drive «мех» → «доп материал» → «акт сверки» → «баланс всех оплат мех.xlsx», 08.10.2026).
 *
 * Правило владельца: платёж подтверждается платёжкой / балансом (актом сверки) / п/п с датой и суммой. Вносится ТОЛЬКО то,
 * что акт показывает однозначно (сумма совпала до копейки, строка единственная): confirmed, confirmedAt/By, п/п и дата.
 * НЕ делает: не создаёт новых платежей, не трогает закупки, DriveDocument и PurchaseDocument, схему.
 * Платежи, которых в приложении нет (70941, 88105, 46963, 48642 …), и расхождения — в docs-inventory/reconciliation-acts-2026-10-08.md.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-reconciliation-acts.ts            # пробный прогон (ничего не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-reconciliation-acts.ts --apply    # применить (до этого scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-reconciliation-acts.ts --rollback # откат по журналу
 *
 * Идемпотентно: метка [акт-сверки 2026-10-08] в Payment.notes. Журнал: docs-inventory/corrections-journal-reconciliation-acts.json
 * (массив {time, entity, id, field, before, after, source}); откат возвращает «было», только если поле с тех пор не менялось.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const INV = join(resolve(__dirname, ".."), "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-reconciliation-acts.json");
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const TAG = "[акт-сверки 2026-10-08]";
const ACT = "акт сверки ООО «Меркури Мода» – ООО «Веллмех» по договору №2502 от 26.02.2025 за период до 30.06.2026 (Drive: мех / доп материал / акт сверки / баланс всех оплат мех.xlsx)";
const iso = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ru = (ymd: string) => ymd.split("-").reverse().join(".");
const fmt = (n: number | string) => Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Строка акта сверки: п/п, дата и сумма по акту; parts — как эта сумма лежит в приложении (одна или несколько строк Payment). */
type Spec = { num: string; date: string; total: string; purpose: string; parts: { amount: string; dbDate?: string }[] };
const SPECS: Spec[] = [
  { num: "440", date: "2025-02-28", total: "34825000.00", purpose: "аванс 35% за шкурки соболя по спецификации №1", parts: [{ amount: "34825000.00" }] },
  { num: "33979", date: "2025-03-14", total: "24556500.00", purpose: "аванс за шкурки норки по спецификации №2", parts: [{ amount: "24556500.00" }] },
  { num: "33980", date: "2025-03-14", total: "79898902.00", purpose: "промежуточный платёж за шкурки соболя по спецификации №1", parts: [{ amount: "79898902.00" }] },
  { num: "36343", date: "2025-03-26", total: "11950000.00", purpose: "аванс 2 за шкурки норки по спецификации №2", parts: [{ amount: "11950000.00" }] },
  { num: "45675", date: "2025-05-16", total: "10924000.00", purpose: "промежуточный платёж за шкурки норки по спецификации №2", parts: [{ amount: "10924000.00" }] },
  { num: "45637", date: "2025-05-16", total: "11146950.00", purpose: "окончательный платёж по спецификации №1", parts: [{ amount: "3935761.96" }, { amount: "7211188.04" }] },
  { num: "48466", date: "2025-05-30", total: "1632000.00", purpose: "дозакупка коричневой норки, аванс по счёту от 10.03.2025", parts: [{ amount: "1632000.00" }] },
  { num: "49288", date: "2025-06-04", total: "1718400.00", purpose: "шкура норки белой выделанной", parts: [{ amount: "1718400.00" }] },
  { num: "51723", date: "2025-06-19", total: "1210000.00", purpose: "аванс за шкурки каракуля по спецификации №5", parts: [{ amount: "1210000.00" }] },
  { num: "53423", date: "2025-06-27", total: "30666300.00", purpose: "аванс за шкурки соболя по спецификации №4 от 26.05.2025", parts: [{ amount: "30666300.00" }] },
  { num: "54214", date: "2025-07-03", total: "1455842.00", purpose: "вспомогательные материалы по спецификации №7, подкладка", parts: [{ amount: "1455842.00" }] },
  { num: "54215", date: "2025-07-03", total: "1537404.00", purpose: "доп закупка норки коричневой и сероголубой - аванс - спецификация №7 (так в акте; счёт Веллмех №95 и УПД №122 — спецификация №6)", parts: [{ amount: "1537404.00" }] },
  { num: "56327", date: "2025-07-15", total: "2000000.00", purpose: "шкура норки белой отбеленной", parts: [{ amount: "2000000.00", dbDate: "2025-06-27" }] },
  { num: "60611", date: "2025-08-04", total: "1695778.00", purpose: "финальный платёж за шкурки норки", parts: [{ amount: "1695778.00" }] },
  { num: "64015", date: "2025-08-22", total: "195404.00", purpose: "финальный платёж за шкурки норки коричневой по спецификации №3", parts: [{ amount: "195404.00" }] },
  { num: "64014", date: "2025-08-22", total: "1061306.00", purpose: "финальный платёж за шкурки каракуля по спецификации №5", parts: [{ amount: "1061306.00" }] },
  { num: "64499", date: "2025-08-26", total: "123836.00", purpose: "финальный платёж за шкурки норки по спецификации №6", parts: [{ amount: "123836.00" }] },
  { num: "36054", date: "2026-03-30", total: "24200000.00", purpose: "аванс за шкурки норки по спецификации №9 от 25.03.2026", parts: [{ amount: "24200000.00" }] },
  { num: "38692", date: "2026-04-13", total: "22891800.00", purpose: "аванс за шкурки норки по спецификации №9 от 25.03.2026", parts: [{ amount: "22891800.00", dbDate: "2026-04-14" }] },
  { num: "40593", date: "2026-04-22", total: "27912500.00", purpose: "аванс за шкурки соболя по спецификации №10 от 13.04.2026", parts: [{ amount: "6304375.00" }, { amount: "21608125.00" }] },
  { num: "43831", date: "2026-05-12", total: "60271506.34", purpose: "аванс 2 за шкурки соболя по спецификации №10", parts: [{ amount: "60271506.34" }] },
  { num: "46540", date: "2026-05-28", total: "19628147.54", purpose: "аванс 3 за шкурки соболя по спецификации №10", parts: [{ amount: "19628147.54", dbDate: "2026-07-09" }] },
  { num: "46538", date: "2026-05-28", total: "30660000.00", purpose: "аванс 1 за шкурки рысевидной кошки по спецификации №12 от 22.05.2026", parts: [{ amount: "30660000.00" }] },
  { num: "46539", date: "2026-05-28", total: "761250.00", purpose: "аванс за шкурки норки по спецификации №11", parts: [{ amount: "761250.00" }] },
  { num: "47668", date: "2026-06-04", total: "2466573.00", purpose: "аванс 2 за шкурки норки по спецификации №11", parts: [{ amount: "2466573.00" }] },
];

type Entry = { time: string; entity: "Payment"; id: string; field: string; before: unknown; after: unknown; source: string };
const readJournal = (): Entry[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : []);
const sameVal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function rollback() {
  const j = readJournal();
  if (!j.length) return console.log("Журнала нет или он пуст");
  let back = 0, skipped = 0;
  for (const e of [...j].reverse()) {
    const cur = (await prisma.payment.findUnique({ where: { id: e.id } })) as Record<string, unknown> | null;
    if (!cur) { skipped++; continue; }
    const curVal = cur[e.field] instanceof Date ? (cur[e.field] as Date).toISOString() : cur[e.field];
    if (!sameVal(curVal, e.after)) { console.log(`пропуск ${e.id}.${e.field}: с тех пор изменено`); skipped++; continue; }
    const val = e.field === "paidAt" || e.field === "confirmedAt" ? (e.before ? new Date(e.before as string) : null) : e.before;
    await prisma.payment.update({ where: { id: e.id }, data: { [e.field]: val } as never });
    back++;
  }
  console.log(`Откат: ${back}, пропущено: ${skipped}`);
  writeFileSync(JOURNAL.replace(".json", ".rolledback.json"), JSON.stringify(j, null, 1));
  writeFileSync(JOURNAL, "[]\n");
}

async function main() {
  if (ROLLBACK) return rollback();
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==");
  const pays = await prisma.payment.findMany({ include: { purchase: { select: { number: true } } }, orderBy: { paidAt: "asc" } });
  const used = new Set<string>();
  const plan: { id: string; label: string; set: Record<string, unknown>; before: Record<string, unknown>; verb: string }[] = [];
  const problems: string[] = [];
  let newlyConfirmed = 0, newlyConfirmedSum = 0, waitingToVerified = 0, waitingToVerifiedSum = 0, tagOnly = 0, tagOnlySum = 0, dateFix = 0, numFix = 0;

  for (const s of SPECS) {
    const sumParts = s.parts.reduce((a, p) => a + Math.round(Number(p.amount) * 100), 0);
    if (sumParts !== Math.round(Number(s.total) * 100)) { problems.push(`${s.num}: части ${sumParts / 100} ≠ акт ${s.total}`); continue; }
    for (const part of s.parts) {
      const cands = pays.filter((p) => !used.has(p.id) && Number(p.amount).toFixed(2) === part.amount &&
        [s.date, part.dbDate ?? s.date].includes(p.paidAt.toISOString().slice(0, 10)));
      if (cands.length !== 1) { problems.push(`${s.num} ${part.amount}: найдено ${cands.length} строк в приложении — пропуск`); continue; }
      const p = cands[0]; used.add(p.id);
      const where = p.auctionSession ? p.auctionSession.split("\n")[0] : p.purchase?.number ?? "аванс без привязки";
      if ((p.notes ?? "").includes(TAG)) { console.log(`уже сверено: ${s.num} ${part.amount}`); continue; }

      const set: Record<string, unknown> = {};
      const was: string[] = [];
      const curDate = p.paidAt.toISOString().slice(0, 10);
      if (curDate !== s.date) { set.paidAt = iso(s.date); was.push(`дата ${ru(curDate)}`); dateFix++; }
      // п/п и дата в docRef: «п/п №NUM от DD.MM.YYYY; счёт Веллмех …»
      const head = `п/п №${s.num} от ${ru(s.date)}`;
      const inv = (p.docRef ?? "").match(/счёт Веллмех[^;]*/)?.[0];
      if (!(p.docRef ?? "").startsWith(head)) {
        set.docRef = inv ? `${head}; ${inv}` : head;
        const oldNum = (p.docRef ?? "").match(/п\/п\s*№\s*(\d+)/)?.[1];
        if (oldNum && oldNum !== s.num) { was.push(`п/п №${oldNum}`); numFix++; }
        else if (!oldNum) was.push("п/п не назван");
      }
      let verb = "сверено (подтверждение уже было)";
      if (!p.confirmed) { set.confirmed = true; verb = "НЕ подтверждена → подтверждена"; newlyConfirmed++; newlyConfirmedSum += Number(p.amount); }
      if (!p.confirmedAt) {
        set.confirmedAt = new Date(); set.confirmedBy = `акт сверки Меркури Мода–Веллмех (дог. №2502) на 30.06.2026: п/п №${s.num} от ${ru(s.date)}, ${fmt(s.total)} ₽`;
        if (p.confirmed) { verb = "ждала подтверждения → подтверждена"; waitingToVerified++; waitingToVerifiedSum += Number(p.amount); }
      }
      if (verb.startsWith("сверено")) { tagOnly++; tagOnlySum += Number(p.amount); }
      const splitNote = s.parts.length > 1 ? ` (в акте одной строкой ${fmt(s.total)} ₽; в приложении разнесена на ${s.parts.length} строки по аукционам, сумма сходится до копейки)` : "";
      const conflict = s.num === "33979" || s.num === "33980" ? " Внимание: в УПД №103 п.(8) этот платёж назван №33980, в УПД №78 п.(5) — №33979; по акту сверки (бухгалтерия Меркури Мода) №33979 = 24 556 500, №33980 = 79 898 902 — принято по акту." : "";
      set.notes = `${p.notes ?? ""}${p.notes ? "\n" : ""}${TAG} Сверено с актом: ${ACT}: оплата №${s.num} от ${ru(s.date)}, ${fmt(s.total)} ₽ — «${s.purpose}»${splitNote}.${was.length ? ` Было в приложении: ${was.join("; ")}.` : ""}${conflict}`;
      plan.push({ id: p.id, label: `${s.num} ${ru(s.date)} ${fmt(part.amount)} [${where}]`, set, verb, before: Object.fromEntries(Object.keys(set).map((k) => [k, (p as never as Record<string, unknown>)[k]])) });
    }
  }
  for (const x of plan) console.log(`${x.verb.padEnd(40)} ${x.label}${x.set.paidAt ? "  ДАТА→" + ru((x.set.paidAt as Date).toISOString().slice(0, 10)) : ""}${x.set.docRef ? "  п/п: " + x.set.docRef : ""}`);
  const notInAct = pays.filter((p) => !used.has(p.id) && !(p.notes ?? "").includes(TAG));
  console.log(`\nПлатежей в приложении: ${pays.length}; сверено с актом: ${used.size}; НЕ в акте (остаются как были): ${notInAct.map((p) => `${fmt(p.amount.toString())} от ${p.paidAt.toISOString().slice(0, 10)}`).join("; ") || "нет"}`);
  console.log(`К записи: ${plan.length} строк. Было «НЕ подтверждена» → подтверждена: ${newlyConfirmed} шт / ${fmt(newlyConfirmedSum)} ₽; ждала подтверждения → подтверждена: ${waitingToVerified} шт / ${fmt(waitingToVerifiedSum)} ₽; уже подтверждена, добавлена сверка: ${tagOnly} шт / ${fmt(tagOnlySum)} ₽; исправлено дат: ${dateFix}; исправлено номеров п/п: ${numFix}`);
  if (problems.length) console.log("ПРОБЛЕМЫ:\n  " + problems.join("\n  "));
  if (!APPLY) return;
  if (problems.length) throw new Error("есть проблемы сопоставления — apply остановлен");

  const ids = plan.map((x) => x.id);
  const before = await prisma.payment.aggregate({ where: { id: { in: ids } }, _sum: { amount: true }, _count: true });
  const journal = readJournal();
  await prisma.$transaction(async (tx) => {
    for (const x of plan) {
      await tx.payment.update({ where: { id: x.id }, data: x.set as never });
      for (const [k, v] of Object.entries(x.set)) {
        journal.push({ time: new Date().toISOString(), entity: "Payment", id: x.id, field: k, before: x.before[k] instanceof Date ? (x.before[k] as Date).toISOString() : x.before[k] ?? null, after: v instanceof Date ? v.toISOString() : v, source: `${ACT}; ${x.label}` });
      }
    }
    const a = await tx.payment.aggregate({ where: { id: { in: ids } }, _sum: { amount: true }, _count: true });
    if (a._count !== before._count || a._sum.amount?.toString() !== before._sum.amount?.toString()) throw new Error("число или сумма платежей изменились — откат");
  });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1) + "\n");
  console.log(`Применено строк: ${plan.length}; журнал: ${JOURNAL}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
