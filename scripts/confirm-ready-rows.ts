/**
 * Массовое подтверждение строк «Подтвердить» (/verify), у которых проверка приложения (computeReadiness) не нашла замечаний.
 * По умолчанию — ПРОБНЫЙ ПРОГОН (ничего не пишет): печатает, что подтвердит и что оставит (с причиной).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/confirm-ready-rows.ts [--apply] [--include="ТЗ 117,ТЗ 104"]
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/confirm-ready-rows.ts --rollback [--apply]
 * Для пробы на копии: DATABASE_URL=…/fur_erp_scratch_pay (без --env-file) и флаг --no-backup.
 *
 * Подтверждает ТОЛЬКО безусловно готовые строки. Строки, по которым в OPEN-QUESTIONS.md остаются нерешённые вопросы владельца
 * (список HOLD ниже), пропускаются, даже если приложение замечаний не нашло; владелец может явно снять задержку флагом
 * --include="ТЗ 117" (по названию строки в /verify) — это его решение, оно попадёт в журнал.
 * verifiedBy = auto:ready-2026-10-13. Перед записью (--apply) вызывается scripts/backup.sh (дамп БД + архив загрузок).
 * Журнал: docs-inventory/corrections-journal-confirm-ready-2026-10-13.json (старые значения целиком); --rollback возвращает их,
 * только если отметка всё ещё поставлена этим скриптом.
 */
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const NO_BACKUP = args.includes("--no-backup");
const INCLUDE = new Set((args.find((a) => a.startsWith("--include="))?.slice("--include=".length) ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const BASIS = "auto:ready-2026-10-13";
const ROOT = path.join(__dirname, "..");
const JOURNAL = path.join(ROOT, "docs-inventory", "corrections-journal-confirm-ready-2026-10-13.json");

/** Названия строк /verify, по которым есть нерешённый вопрос владельца (docs/OPEN-QUESTIONS.md) — автоматически не подтверждаем. */
const HOLD: Record<string, string> = {
  "ТЗ 97": "В8/Е6: у ТЗ нет состава материалов (бобр чёрный стриженый + кашемир), вариант учёта бобра не выбран; дата 12.01.2026 — шаблонная (В14, Е19)",
  "ТЗ 104": "В8/Е6: нет состава материалов (бобр), вариант учёта бобра не выбран; дата 12.01.2026 — шаблонная (В14, Е19)",
  "ТЗ 116": "В7/Е15: заказчик, дата 07.05.2026 и оплата 218 860 (п/п 46523) подтверждены письмами, но не определены размер и цвет изделий; выпуск 0 из 7",
  "ТЗ 117": "В26/В32: множитель сырья 1,0558 документами не подтверждён, УПД МФВМ000028/29 (.xls) нечитаемы, акта сдачи нет, дата выпуска не подтверждена",
  "ТЗ 118": "В14/Е19/Г9: дата ТЗ 17.03.2026 при счёте №207 от 16.07.2026; оплат на ТЗ не заведено (работа 238 000, счёт №207 = 71 400); цвета позиций (В19)",
};

type J = { time: string; kind: string; id: string; label: string; before: Record<string, unknown>; after: Record<string, unknown>; rolledBack?: string };
const readJ = (): J[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);
const writeJ = (j: J[]) => writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
const prisma = new PrismaClient();
const log = (...a: unknown[]) => console.log(...a);
const dt = (v: unknown) => (typeof v === "string" ? new Date(v) : (v as Date | null));

async function rollback() {
  const j = readJ();
  for (const e of j.slice().reverse()) {
    if (e.rolledBack) continue;
    log(APPLY ? "откат" : "будет откачено", e.kind, e.label);
    if (!APPLY) continue;
    const b = e.before;
    if (e.kind === "payment" || e.kind === "prodPayment") {
      const data = { confirmed: b.confirmed as boolean, confirmedAt: dt(b.confirmedAt), confirmedBy: b.confirmedBy as string | null };
      if (e.kind === "payment") await prisma.payment.updateMany({ where: { id: e.id, confirmedBy: BASIS }, data });
      else await prisma.productionPayment.updateMany({ where: { id: e.id, confirmedBy: BASIS }, data });
    } else {
      const data = { verifiedAt: dt(b.verifiedAt), verifiedBy: b.verifiedBy as string | null, verifyNote: b.verifyNote as string | null };
      if (e.kind === "order") await prisma.productionOrder.updateMany({ where: { id: e.id, verifiedBy: BASIS }, data });
      else if (e.kind === "purchase") await prisma.purchase.updateMany({ where: { id: e.id, verifiedBy: BASIS }, data });
      else await prisma.productionBatch.updateMany({ where: { id: e.id, verifiedBy: BASIS }, data });
    }
    e.rolledBack = new Date().toISOString();
    writeJ(j);
  }
}

async function main() {
  if (ROLLBACK) return rollback();
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const { loadVerifyModel } = await import("../src/lib/verification");
  const m = await loadVerifyModel(prisma as never, org, { c4Mode: "off" });
  const ready = m.rows.filter((r) => !r.verified && r.ready);
  log(APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН", `| готовых к подтверждению: ${ready.length}`);
  const todo = ready.filter((r) => {
    const hold = HOLD[r.title];
    if (hold && !INCLUDE.has(r.title)) {
      log(`  ОСТАВЛЕНО (нужно решение) ${r.kind} ${r.title} | ${r.sub ?? ""} | ${r.amountText ?? ""} | ${hold}`);
      return false;
    }
    log(`  ${hold ? "ПОДТВЕРДИТЬ (решение владельца --include)" : "ПОДТВЕРДИТЬ"} ${r.kind} ${r.title} | ${r.sub ?? ""} | ${r.amountText ?? ""}`);
    return true;
  });
  log(`будет подтверждено: ${todo.length}`);
  if (!APPLY || todo.length === 0) {
    if (!APPLY) log("\nПробный прогон: ничего не изменено. Для применения добавьте --apply.");
    return;
  }
  if (!NO_BACKUP) log("резервная копия:", execFileSync("bash", [path.join(ROOT, "scripts", "backup.sh")], { encoding: "utf-8" }).trim());
  const journal = readJ();
  const note = `Подтверждено массово (${new Date().toISOString().slice(0, 10)}): замечаний нет — документы, суммы, количества и даты сошлись.`;
  for (const r of todo) {
    const now = new Date();
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    if (r.kind === "payment" || r.kind === "prodPayment") {
      const cur = r.kind === "payment"
        ? await prisma.payment.findFirstOrThrow({ where: { id: r.id, organizationId: org }, select: { confirmed: true, confirmedAt: true, confirmedBy: true } })
        : await prisma.productionPayment.findFirstOrThrow({ where: { id: r.id, organizationId: org }, select: { confirmed: true, confirmedAt: true, confirmedBy: true } });
      before = { ...cur };
      after = { confirmed: true, confirmedAt: now, confirmedBy: BASIS };
      if (r.kind === "payment") await prisma.payment.update({ where: { id: r.id }, data: after });
      else await prisma.productionPayment.update({ where: { id: r.id }, data: after });
    } else {
      const sel = { verifiedAt: true, verifiedBy: true, verifyNote: true } as const;
      const cur = r.kind === "order" ? await prisma.productionOrder.findFirstOrThrow({ where: { id: r.id, organizationId: org }, select: sel })
        : r.kind === "purchase" ? await prisma.purchase.findFirstOrThrow({ where: { id: r.id, organizationId: org }, select: sel })
        : await prisma.productionBatch.findFirstOrThrow({ where: { id: r.id, organizationId: org }, select: sel });
      before = { ...cur };
      after = { verifiedAt: now, verifiedBy: BASIS, verifyNote: note };
      if (r.kind === "order") await prisma.productionOrder.update({ where: { id: r.id }, data: after });
      else if (r.kind === "purchase") await prisma.purchase.update({ where: { id: r.id }, data: after });
      else await prisma.productionBatch.update({ where: { id: r.id }, data: after });
    }
    journal.push({ time: now.toISOString(), kind: r.kind, id: r.id, label: `${r.title} | ${r.sub ?? ""}`, before, after });
    writeJ(journal);
  }
  log(`подтверждено: ${todo.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
