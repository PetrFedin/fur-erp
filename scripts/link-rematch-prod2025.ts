/**
 * Повторное сопоставление Drive «Производство меховых изделий/2025» с БД (только привязки DriveDocument, уровень exact).
 * Образец — link-drive-docs-remaining.ts. Основание каждой привязки — в поле reason (проверено чтением файлов Drive).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-prod2025.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-prod2025.ts --apply    # (сначала scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-prod2025.ts --rollback docs-inventory/corrections-journal-prod2025.json
 *
 * Идемпотентность: ключ organizationId + driveFileId + (productionBatchId | productionPaymentId | supplierId).
 * Журнал: docs-inventory/corrections-journal-prod2025.json (откат удаляет только созданные строки).
 */
import "./lib/drive-links-disabled";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL_PATH = join(INV, "corrections-journal-prod2025.json");
const PLAN_PATH = join(INV, "rematch-prod2025-plan.txt");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

type DocType = "BALANCE" | "CONTRACT" | "SPECIFICATION" | "APPROVAL_EMAIL";
type Target = { kind: "batch"; n: number } | { kind: "supplier" } | { kind: "payRef"; ref: string };
type Link = { f: string; to: Target[]; type: DocType; num?: string; date?: string; reason: string };

const BAL = "1C5PRrPdP5JXEnlDLXTRsJaZkHWfMcCga"; // баланс 040226.xlsx (поставка 9)
const balReason = (n: number, what: string) =>
  `Баланс 04.02.2026: строка «отгрузка» партии ${n} — ${what}; сумма совпадает с итогом расчёта доплаты/УПД партии ${n}`;

const LINKS: Link[] = [
  { f: BAL, to: [{ kind: "batch", n: 1 }], type: "BALANCE", date: "2026-02-04", reason: balReason(1, "6 470 390 ₽ 22.09.2025 (= УПД №170)") },
  { f: BAL, to: [{ kind: "batch", n: 2 }], type: "BALANCE", date: "2026-02-04", reason: balReason(2, "4 049 170 ₽ (= УПД №171)") },
  { f: BAL, to: [{ kind: "batch", n: 3 }], type: "BALANCE", date: "2026-02-04", reason: balReason(3, "6 795 860 ₽ 10.10.2025") },
  { f: BAL, to: [{ kind: "batch", n: 5 }], type: "BALANCE", date: "2026-02-04", reason: balReason(5, "8 124 720 ₽ = работа 3 540 220 + шкуры подрядчика 4 584 500") },
  { f: BAL, to: [{ kind: "batch", n: 6 }], type: "BALANCE", date: "2026-02-04", reason: balReason(6, "2 061 620 ₽ 18.12.2025 = работа 1 597 870 + шкуры 463 750") },
  { f: BAL, to: [{ kind: "batch", n: 7 }], type: "BALANCE", date: "2026-02-04", reason: balReason(7, "4 147 787,54 ₽ 15.01.2026 = 3 030 323,84 + 1 117 463,70") },
  { f: BAL, to: [{ kind: "batch", n: 8 }], type: "BALANCE", date: "2026-02-04", reason: balReason(8, "1 215 575,39 ₽ = 1 182 657 + 32 918,39; отдельных счёта/платежа по партии 8 в балансе нет") },
  // письмо по партиям 12/13 — копия в папке «поставка 13» (то же имя и размер 77 824 б, что у привязанной к партии 12)
  { f: "1gwNiHv6ojQjLixaInGAjBF7yJ8WiBnpP", to: [{ kind: "batch", n: 13 }], type: "APPROVAL_EMAIL", reason: "Письмо «…партия 12 (остаток - 1 ед) и партия 13 (20 ед)» лежит в папке поставка 13; согласует счёт №71 на 183 400 ₽ (20 ед.) — совпадает с расчётом и счётом партии 13" },
];
// id файлов договоров берём из DriveDocument по заголовку (в базе они уже привязаны к клиенту)
const CONTRACT_TITLES: { title: string; num: string; date?: string; reason: string }[] = [
  { title: "Договор подписанный с 2-х сторон.pdf", num: "1605", date: "2025-05-16", reason: "Договор подряда №1605 от 16.05.2025, подписан обеими сторонами (Заказчик ММ, Подрядчик Веллмех)" },
  { title: "Веллмех_ММ_Договор подряда № 1605 от 16.05.25_+ Прил. № 1-2.pdf", num: "1605", date: "2025-05-16", reason: "Договор подряда №1605 от 16.05.2025 (Заказчик ММ, Подрядчик Веллмех) + Прил. 1–2" },
  { title: "Доп соглашение 1.pdf", num: "ДС №1 к 1605", reason: "ДС №1 к Договору подряда №1605 (аванс 70%/30%, поставка партиями), подписанный скан" },
  { title: "ДС Веллмех ММ.pdf", num: "ДС №1 к 1605", reason: "ДС №1 к Договору подряда №1605, второй скан (за Веллмех — Погромова Т.М. по доверенности)" },
];
const SPEC_IDS = [
  { f: "16OYQFjYethKSZCepV_XrYLn8lff9z3kw", w: "ЖГУ соболь 789 200 + МГУ… (Σ работ по трём файлам 2 524 100)" },
  { f: "1TPv57sTpX40D30Gxm7eyE0e3iOd0BBFd", w: "МГУ (общ)" },
  { f: "1aFt-4DCJeLZLKyYXLq2iFa8Q7_yyHm4d", w: "ЖГУ норка" },
];

function loadManifest(): Map<string, any> {
  const m = new Map<string, any>();
  for (const f of readdirSync(INV).filter((x) => /^drive-live-batch-\d+\.json$/.test(x)))
    for (const x of JSON.parse(readFileSync(join(INV, f), "utf-8"))) m.set(x.id, x);
  return m;
}
const journalAppend = (entries: unknown[]) => {
  const prev: unknown[] = existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) : [];
  writeFileSync(JOURNAL_PATH, JSON.stringify([...prev, ...entries], null, 2));
};

async function rollback(file: string) {
  const entries = JSON.parse(readFileSync(resolve(file), "utf-8")) as { entity: string; id: string; field: string }[];
  const creates = entries.filter((e) => e.entity === "DriveDocument" && e.field === "__create__");
  console.log(`Откат по журналу ${file}: ${creates.length} созданных строк DriveDocument.`);
  const r = await prisma.driveDocument.deleteMany({ where: { id: { in: creates.map((e) => e.id) } } });
  console.log(`Удалено ${r.count}, уже отсутствовало ${creates.length - r.count}.`);
}

async function main() {
  const url = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : ROLLBACK ? "ОТКАТ" : "DRY-RUN (в БД не пишем)"}; БД: ${url}`);
  if (ROLLBACK) return rollback(ROLLBACK);

  const man = loadManifest();
  const org = await prisma.organization.findFirstOrThrow();
  const batches = await prisma.productionBatch.findMany({ where: { organizationId: org.id }, select: { id: true, number: true } });
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organizationId: org.id, name: { contains: "Веллмех", mode: "insensitive" } } });
  const pays209 = await prisma.productionPayment.findMany({ where: { organizationId: org.id, docRef: { contains: "№209" } }, select: { id: true, amount: true, paidAt: true } });
  if (pays209.length !== 5) throw new Error(`Ожидалось 5 оплат по счёту №209, найдено ${pays209.length}`);
  const existing = await prisma.driveDocument.findMany({
    where: { organizationId: org.id },
    select: { driveFileId: true, title: true, productionBatchId: true, productionPaymentId: true, supplierId: true },
  });
  const keys = new Set(existing.map((e) => `${e.driveFileId}|${e.productionBatchId ?? ""}|${e.productionPaymentId ?? ""}|${e.supplierId ?? ""}`));

  // раскрываем договоры и спецификации в общий список
  const links: Link[] = [...LINKS];
  for (const c of CONTRACT_TITLES) {
    const hit = existing.filter((e) => e.title === c.title);
    const ids = [...new Set(hit.map((h) => h.driveFileId))];
    if (ids.length !== 1) throw new Error(`Договор «${c.title}»: файлов ${ids.length}`);
    links.push({ f: ids[0], to: [{ kind: "supplier" }], type: "CONTRACT", num: c.num, date: c.date, reason: c.reason });
  }
  for (const s of SPEC_IDS)
    links.push({
      f: s.f, to: [{ kind: "payRef", ref: "№209" }], type: "SPECIFICATION", date: "2025-11-19",
      reason: "Спецификация аксессуаров от 19.11.2025: Σ работ ЖГУ соболь 1 270 900 + ЖГУ норка 464 000 + МГУ 789 200 = 2 524 100; 70% = 1 766 870 = аванс по счёту №209 от 19.11.2025",
    });

  const rows: { data: Record<string, any>; label: string }[] = [];
  const plan: string[] = [];
  for (const l of links) {
    const m = man.get(l.f);
    if (!m) throw new Error(`Файла нет в drive-live-batch: ${l.f}`);
    for (const t of l.to) {
      let entityKey: Record<string, string | null>;
      let label: string;
      if (t.kind === "batch") {
        const b = batches.find((x) => x.number === t.n);
        if (!b) throw new Error(`Нет партии ${t.n}`);
        entityKey = { productionBatchId: b.id }; label = `Партия ${t.n}`;
      } else if (t.kind === "supplier") { entityKey = { supplierId: supplier.id }; label = `Поставщик ${supplier.name}`; }
      else {
        const ps = pays209;
        for (const p of ps) {
          const k = `${l.f}||${p.id}|`;
          const has = keys.has(k);
          plan.push(`${has ? "[уже есть]" : "[+]"} ${l.type.padEnd(14)} ${m.title}  →  Оплата ${p.paidAt.toISOString().slice(0, 10)} ${p.amount}`);
          if (!has) rows.push({ data: mkRow(org.id, l, m, { productionPaymentId: p.id }), label: `Оплата ${p.id}` });
        }
        continue;
      }
      const k = `${l.f}|${entityKey.productionBatchId ?? ""}||${entityKey.supplierId ?? ""}`;
      const has = keys.has(k);
      plan.push(`${has ? "[уже есть]" : "[+]"} ${l.type.padEnd(14)} ${m.title}  →  ${label}`);
      if (!has) rows.push({ data: mkRow(org.id, l, m, entityKey), label });
    }
  }
  writeFileSync(PLAN_PATH, plan.join("\n") + "\n");
  console.log(`Решений: ${links.length}; строк DriveDocument к созданию: ${rows.length}; уже есть: ${plan.filter((p) => p.startsWith("[уже")).length}`);
  console.log(`План: ${PLAN_PATH}`);
  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала scripts/backup.sh!)."); return; }
  if (!rows.length) { console.log("Нечего применять — всё уже привязано."); return; }

  const time = new Date().toISOString();
  const made: typeof rows = [];
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const d = r.data;
      const dup = await tx.driveDocument.findFirst({
        where: { organizationId: d.organizationId, driveFileId: d.driveFileId, productionBatchId: d.productionBatchId ?? null, productionPaymentId: d.productionPaymentId ?? null, supplierId: d.supplierId ?? null },
        select: { id: true },
      });
      if (dup) continue;
      await tx.driveDocument.create({ data: d as any });
      made.push(r);
    }
  }, { timeout: 120_000, maxWait: 60_000 });
  journalAppend(made.map((r) => ({
    time, entity: "DriveDocument", id: r.data.id, field: "__create__", before: null,
    after: { ...r.data, docDate: r.data.docDate ? (r.data.docDate as Date).toISOString() : null }, source: `link-rematch-prod2025; ${r.label}`,
  })));
  console.log(`\nГОТОВО: создано ${made.length}. Журнал ${JOURNAL_PATH}. Откат: --rollback ${JOURNAL_PATH}`);
}

function mkRow(organizationId: string, l: Link, m: any, entity: Record<string, string | null>): Record<string, any> {
  const docDate = l.date ? new Date(l.date + "T00:00:00Z") : null;
  return {
    id: newId(), organizationId, driveFileId: l.f, title: m.title, docType: l.type,
    mimeType: m.mime_type ?? null, sizeBytes: m.size ? Number(m.size) : null, drivePath: m.path ?? null, viewUrl: m.url ?? null,
    docDate, docNumber: l.num ?? null, year: docDate ? docDate.getUTCFullYear() : /2026/.test(m.path ?? "") ? 2026 : /2025/.test(m.path ?? "") ? 2025 : null,
    notes: `${l.reason}. Привязка скриптом link-rematch-prod2025 (уровень exact)`,
    ...entity,
  };
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
