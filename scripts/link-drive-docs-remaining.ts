/**
 * Доп. привязка документов Google Drive: 51 файл манифеста, у которых не было ни одной строки DriveDocument
 * (docs-inventory/unlinked-files.json). Образец — link-drive-docs-purchases.ts.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-remaining.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-remaining.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-remaining.ts --rollback docs-inventory/corrections-journal-drive-links-2.json
 *
 * ПЕРЕД --apply — бэкап базы (scripts/backup.sh). Документы подкладки/доп. материалов привязываются к закупкам,
 * которые создаёт scripts/create-draft-lining-extra-purchases.ts — запустите её раньше (иначе эти 10 файлов
 * будут перечислены как «ждут закупку» и привяжутся при следующем запуске).
 *
 * Решение по каждому из 51 файлов зашито в таблице DECISIONS:
 *   LINK — привязать (цели: S:сессия | I:счёт | SUP);
 *   DUP  — дубль уже привязанного файла (тот же размер/содержимое, проверено по отчётам и чтением из Drive) — пропуск;
 *   PENDING — не привязывать, причина в docs-inventory/pending-links-2.md.
 * Для DUP скрипт проверяет, что файл-оригинал действительно имеет DriveDocument в базе; иначе файл уходит в «ждёт оригинал».
 * Ключ идемпотентности: organizationId + driveFileId + purchaseId|supplierId. Журнал — corrections-journal-drive-links-2.json.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL_PATH = join(INV, "corrections-journal-drive-links-2.json");
const PLAN_PATH = join(INV, "drive-links-plan-remaining.txt");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

type DocType = "AUCTION_INVOICE" | "UPD" | "CALC_SHEET" | "SPECIFICATION" | "CONTRACT" | "TZ_APPENDIX" | "PAYMENT_PROOF" | "PAYMENT_INVOICE" | "APPROVAL_EMAIL" | "BALANCE" | "OTHER";
type Decision =
  | { k: "LINK"; f: string; to: string[]; type: DocType; note?: string; date?: string; num?: string }
  | { k: "DUP"; f: string; of: string; why: string }
  | { k: "PENDING"; f: string; why: string };

const SP = "S:СП 09-26";
const L13 = "S:Подкладка Спец. 13";
const E16 = "S:Доп. материалы Спец. 16";
const DECISIONS: Decision[] = [
  // --- СП 09-26 (в приложении уже вложены как PurchaseDocument на уровне партии; добавляем ссылки на Drive на те же закупки)
  { k: "LINK", f: "1XLjZL", to: [SP], type: "PAYMENT_INVOICE", date: "2026-09-30", num: "271", note: "Счёт №271 от 30.09.2026 на аванс 60 831 100 ₽ (оплаты в Drive нет)" },
  { k: "LINK", f: "1aRjMC", to: [SP], type: "CALC_SHEET", note: "Расчёт закупки СП 09-26" },
  { k: "LINK", f: "134ZVp", to: [SP], type: "SPECIFICATION", date: "2026-09-30", num: "20", note: "Спецификация №20 от 30.09.2026 (СП 09-26)" },
  { k: "LINK", f: "1QTOS6", to: ["I:3050"], type: "AUCTION_INVOICE", num: "3050" },
  { k: "LINK", f: "1sBK_1", to: ["I:3024"], type: "AUCTION_INVOICE", num: "3024" },
  { k: "LINK", f: "1eZ4Ur", to: ["I:3020"], type: "AUCTION_INVOICE", num: "3020" },
  { k: "LINK", f: "1AUtOm", to: ["I:3017"], type: "AUCTION_INVOICE", num: "3017" },
  { k: "LINK", f: "1q9XnM", to: ["I:3023"], type: "AUCTION_INVOICE", num: "3023" },
  { k: "LINK", f: "1bG9Vt", to: ["I:3022"], type: "AUCTION_INVOICE", num: "3022" },
  { k: "LINK", f: "19YR9s", to: ["I:3019"], type: "AUCTION_INVOICE", num: "3019" },
  { k: "LINK", f: "11JgwK", to: ["I:3018"], type: "AUCTION_INVOICE", num: "3018" },
  // --- Подкладка 2026 (Спец. №13, счёт №157) — закупка создаётся create-draft-lining-extra-purchases.ts
  { k: "LINK", f: "1x2Klb", to: [L13], type: "SPECIFICATION", date: "2026-05-26", num: "13", note: "Спецификация №13 от 26.05.2026: подкладочная ткань 1200 м.п., 5 400 000 ₽" },
  { k: "LINK", f: "1silgJ", to: [L13], type: "PAYMENT_INVOICE", date: "2026-05-26", num: "157", note: "Счёт №157 от 26.05.2026 на 5 400 000 ₽ (оплаты в Drive нет)" },
  { k: "LINK", f: "1DIfQO", to: [L13], type: "CALC_SHEET", note: "Предварительный расчёт стоимости подкладки" },
  { k: "LINK", f: "1JzKvY", to: [L13], type: "APPROVAL_EMAIL", note: "Согласование оплаты 5 400 000 ₽ (письмо 26–29.05.2026; в письме — счёт №157, Приложение 13, расчёт, инвойс Lavin)" },
  { k: "LINK", f: "1V37v-", to: [L13], type: "OTHER", note: "Инвойс поставщика подкладки (Lavin) — вложение письма о закупке подкладки; изображение, содержимое не распознано" },
  { k: "LINK", f: "1uS6sP", to: [L13], type: "OTHER", note: "Таблица потребности подкладки по моделям (не закупочный документ; лежит в папке закупки подкладки)" },
  // --- Доп. материалы (Спец. №16, счёт №181)
  { k: "LINK", f: "1h4Mel", to: [E16], type: "SPECIFICATION", date: "2026-06-16", num: "16", note: "Спецификация №16 от 16.06.2026: шерсть/альпака/шёлк 2 м.п., кожа 0,5 м.п., 19 870 ₽" },
  { k: "LINK", f: "1vtFw7", to: [E16], type: "PAYMENT_INVOICE", date: "2026-06-16", num: "181", note: "Счёт №181 от 16.06.2026 на 19 870 ₽ (оплаты в Drive нет)" },
  { k: "LINK", f: "1telqH", to: [E16], type: "CALC_SHEET", note: "Расчёт за доп. материалы" },
  { k: "LINK", f: "1X09Yv", to: [E16], type: "APPROVAL_EMAIL", note: "Согласование оплаты 19 870 ₽ (письмо 16–29.06.2026)" },
  // --- письмо без читаемого тела
  { k: "LINK", f: "1bnnr-", to: ["SUP"], type: "APPROVAL_EMAIL", note: "Письмо ВЕЛЛМЕХ — МЕРКУРИ МОДА «УПД на соболь» (2025). Тело (сжатый RTF/вложения) не читается — к конкретной закупке не привязано, только к поставщику" },
  // --- дубли уже привязанных файлов
  { k: "DUP", f: "1h507v", of: "1T5V2E", why: "«Копия расчет себестоимости Соболь (итоговый)»: содержимое идентично оригиналу (прочитаны оба из Drive)" },
  { k: "DUP", f: "1-6d7a", of: "1783cI", why: "ПРИЛОЖЕНИЕ 2 (испр): тот же размер 407 936 б" },
  { k: "DUP", f: "1PBRGK", of: "1Jrgpj", why: "Счёт 83: тот же размер и имя" },
  { k: "DUP", f: "1MpCwO", of: "16Dkx_", why: "Спец. №4: тот же размер и имя" },
  { k: "DUP", f: "1IuWW3", of: "1pu6bM", why: "Счёт 2227: тот же размер 244 024 б" },
  { k: "DUP", f: "1ObB4m", of: "1zb47O", why: "Счёт 2094: тот же размер 278 864 б" },
  { k: "DUP", f: "1FajrD", of: "1TUdGl", why: "Счёт 2095: тот же размер 275 867 б" },
  { k: "DUP", f: "1iVd-4", of: "1PjKZH", why: "Счёт 2004: тот же размер 275 962 б" },
  { k: "DUP", f: "1aGu51", of: "1TZIXC", why: "УПД №199 pdf: тот же размер и имя" },
  { k: "DUP", f: "1zv5Vr", of: "19oECr", why: "УПД №199 xlsx: тот же размер и имя" },
  { k: "DUP", f: "1viv-O", of: "1pUpng", why: "УПД №201 pdf: тот же размер и имя" },
  { k: "DUP", f: "1qFebp", of: "1TN_5y", why: "УПД №201 xlsx: тот же размер и имя" },
  { k: "DUP", f: "1b5qMV", of: "1kzqrH", why: "Счёт №197: тот же размер и имя" },
  { k: "DUP", f: "1er4_9", of: "1Q7XJv", why: "закупка РП 04-2026.xlsx: тот же размер и имя" },
  { k: "DUP", f: "1nB6Um", of: "1N752q", why: "закупка СП 05-2026.xlsx: тот же размер и имя" },
  { k: "DUP", f: "1cqmXS", of: "1ZFN8r", why: "Спецификация 10: текст идентичен (по отчёту p2026b), вторая копия 501 363 б" },
  { k: "DUP", f: "1B15QN", of: "1ZFN8r", why: "Спецификация 10: текст идентичен (по отчёту p2026b), вторая копия 501 363 б" },
  { k: "DUP", f: "1pYggT", of: "1mj2bu", why: "ПРИЛОЖЕНИЕ 8 (152 шкуры Союзпушнина): тот же размер 16 000 б" },
  { k: "DUP", f: "1c9Oaj", of: "16uxtG", why: "баланс 040226: тот же размер 12 631 б" },
  { k: "DUP", f: "1ZvF4G", of: "1XfGHH", why: "письмо по партии 3: тот же размер 71 168 б" },
  { k: "DUP", f: "1s67X_", of: "1iaE9m", why: "предварительный расчёт 130825: тот же размер 24 751 б" },
  { k: "DUP", f: "1gK1dp", of: "1iaE9m", why: "предварительный расчёт 130825: тот же размер 24 751 б" },
  { k: "DUP", f: "1aVl67", of: "1X_Oan", why: "расчёт доплаты за 14 г-у: тот же размер 11 675 б" },
  { k: "DUP", f: "1CYkrV", of: "114zcj", why: "письмо по партиям 12/13: тот же размер 77 824 б" },
  { k: "DUP", f: "12EQLS", of: "12wdlC", why: "расчёт пошива 8 партии: содержимое идентично «расчет производства партии 8» (прочитаны оба из Drive)" },
  { k: "DUP", f: "1vPnz9", of: "12wdlC", why: "служебный lock-файл Excel (~$…), 165 б" },
  { k: "DUP", f: "1oJMmp", of: "1HbFIP", why: "ПРИЛОЖЕНИЕ 84: тот же размер 21 494 б" },
  { k: "DUP", f: "1kgJ7Y", of: "1cvMaN", why: "письмо об оплате пошива за 82 ед: тот же размер 118 272 б" },
  // --- спорное
  { k: "PENDING", f: "1DWzY2", why: "«Соболь счета выделка + перевозки.pdf»: скан актов МК ЛИС, МП-Прогресс, Деловые Линии, ПЭК; часть выписана на ООО «Русский Мех», не на Веллмех/ММ; относится к СП/РП 03.25 сразу (12 закупок) — решение владельца" },
];

const ext = (t: string) => (/\.([a-z0-9]+)$/i.exec(t)?.[1] ?? "").toLowerCase();
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

  const manifest: any[] = JSON.parse(readFileSync(join(INV, "drive-manifest.json"), "utf-8"));
  const unlinked: any[] = JSON.parse(readFileSync(join(INV, "unlinked-files.json"), "utf-8"));
  const byPrefix = (p: string) => {
    const h = manifest.filter((m) => m.id.startsWith(p));
    if (h.length !== 1) throw new Error(`Префикс «${p}» даёт ${h.length} совпадений в манифесте`);
    return h[0];
  };
  // покрытие: каждый из 51 файлов — ровно одно решение
  const decided = new Map<string, Decision>();
  for (const d of DECISIONS) {
    const id = byPrefix(d.f).id;
    if (d.k === "LINK" || d.k === "PENDING") { if (decided.has(id)) throw new Error("два решения на " + d.f); }
    decided.set(id, d);
  }
  const missing = unlinked.filter((u) => !decided.has(u.id));
  if (missing.length) { missing.forEach((u) => console.error("НЕТ РЕШЕНИЯ:", u.id, u.title)); throw new Error(`${missing.length} файлов без решения`); }
  const extra = [...decided.keys()].filter((id) => !unlinked.some((u) => u.id === id));
  if (extra.length) throw new Error("решения для файлов вне списка: " + extra.join(","));

  const org = await prisma.organization.findFirstOrThrow();
  const purchases = await prisma.purchase.findMany({ where: { organizationId: org.id }, select: { id: true, number: true, auctionSession: true, invoiceNumber: true } });
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organizationId: org.id, name: { contains: "Веллмех", mode: "insensitive" } } });
  const existing = await prisma.driveDocument.findMany({ where: { organizationId: org.id }, select: { driveFileId: true, purchaseId: true, supplierId: true } });
  const linkedFiles = new Set(existing.map((e) => e.driveFileId));
  const keys = new Set(existing.map((e) => `${e.driveFileId}|${e.purchaseId ?? ""}|${e.supplierId ?? ""}`));

  type Row = { data: Record<string, unknown>; label: string };
  const rows: Row[] = [];
  const waiting: string[] = [];
  const dups: string[] = [];
  const pending: { title: string; id: string; why: string }[] = [];
  const planLines: string[] = [];

  for (const [fileId, d] of decided) {
    const m = manifest.find((x) => x.id === fileId)!;
    if (d.k === "PENDING") { pending.push({ title: m.title, id: fileId, why: d.why }); continue; }
    if (d.k === "DUP") {
      const orig = byPrefix(d.of);
      const ok = linkedFiles.has(orig.id) || decided.has(orig.id) && decided.get(orig.id)!.k === "LINK";
      if (!ok) { waiting.push(`${m.title} (${fileId.slice(0, 6)}) — оригинал ${orig.title} (${d.of}) в базе не привязан`); pending.push({ title: m.title, id: fileId, why: `дубль, но оригинал ${d.of} не привязан в этой базе` }); continue; }
      dups.push(`${m.title} (${fileId.slice(0, 6)}) = ${orig.title} (${d.of}): ${d.why}`);
      continue;
    }
    const targets: { kind: "purchaseId" | "supplierId"; id: string; label: string }[] = [];
    let unresolved = false;
    for (const spec of d.to) {
      if (spec === "SUP") targets.push({ kind: "supplierId", id: supplier.id, label: `Поставщик ${supplier.name}` });
      else if (spec.startsWith("S:")) {
        const list = purchases.filter((p) => p.auctionSession === spec.slice(2));
        if (!list.length) { unresolved = true; waiting.push(`${m.title} (${fileId.slice(0, 6)}) — нет закупок с auctionSession «${spec.slice(2)}» (запустите create-draft-lining-extra-purchases.ts)`); }
        list.forEach((p) => targets.push({ kind: "purchaseId", id: p.id, label: p.number }));
      } else if (spec.startsWith("I:")) {
        const list = purchases.filter((p) => p.invoiceNumber === spec.slice(2));
        if (list.length !== 1) { unresolved = true; waiting.push(`${m.title} (${fileId.slice(0, 6)}) — invoiceNumber ${spec.slice(2)}: закупок ${list.length}`); }
        else targets.push({ kind: "purchaseId", id: list[0].id, label: list[0].number });
      }
    }
    if (unresolved) continue;
    for (const t of targets) {
      const key = `${fileId}|${t.kind === "purchaseId" ? t.id : ""}|${t.kind === "supplierId" ? t.id : ""}`;
      const data: Record<string, unknown> = {
        id: newId(), organizationId: org.id, driveFileId: fileId, title: m.title, docType: d.type,
        mimeType: m.mimeType ?? null, sizeBytes: m.size ?? null, drivePath: m.path ?? null, viewUrl: m.viewUrl ?? null,
        docDate: d.date ? new Date(d.date + "T00:00:00Z") : null, docNumber: d.num ?? null,
        year: /закупка 2026|Производство.*2026/.test(m.path) ? 2026 : /2025/.test(m.path) ? 2025 : null,
        notes: [d.note, "Привязка скриптом link-drive-docs-remaining (по документам Drive)"].filter(Boolean).join(". "),
        purchaseId: null, supplierId: null,
      };
      data[t.kind] = t.id;
      planLines.push(`${keys.has(key) ? "[уже есть]" : "[+]"} ${d.type.padEnd(15)} ${m.title}  →  ${t.label}`);
      if (!keys.has(key)) rows.push({ data, label: t.label });
    }
  }

  planLines.push("", "=== ДУБЛИ (пропущены) ===", ...dups.map((s) => "  " + s), "", "=== ЖДУТ ЗАКУПКУ/ОРИГИНАЛ ===", ...waiting.map((s) => "  " + s), "", "=== СПОРНОЕ ===", ...pending.map((p) => `  ${p.title}: ${p.why}`));
  writeFileSync(PLAN_PATH, planLines.join("\n") + "\n");
  const types = new Map<string, number>();
  rows.forEach((r) => types.set(String(r.data.docType), (types.get(String(r.data.docType)) ?? 0) + 1));
  console.log(`Файлов в списке: ${unlinked.length}; к привязке (файлов): ${new Set(rows.map((r) => r.data.driveFileId)).size}; дублей пропущено: ${dups.length}; ждут закупку/оригинал: ${waiting.length}; спорных: ${pending.length}`);
  console.log(`Строк DriveDocument к созданию: ${rows.length} (${[...types].map(([t, n]) => `${t} ${n}`).join(", ")})`);
  waiting.forEach((w) => console.log("  ЖДЁТ: " + w));
  console.log(`План: ${PLAN_PATH}`);
  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала бэкап!)."); return; }
  if (!rows.length) { console.log("Нечего применять — всё уже привязано."); return; }

  const groups = new Map<string, Row[]>();
  for (const r of rows) { const k = String(r.data.purchaseId ?? r.data.supplierId); groups.set(k, [...(groups.get(k) ?? []), r]); }
  let created = 0, already = 0;
  for (const [, rs] of groups) {
    const time = new Date().toISOString();
    const made: Row[] = [];
    await prisma.$transaction(async (tx) => {
      for (const r of rs) {
        const dd = r.data as any;
        const dup = await tx.driveDocument.findFirst({ where: { organizationId: dd.organizationId, driveFileId: dd.driveFileId, purchaseId: dd.purchaseId, supplierId: dd.supplierId, paymentId: null, lotId: null }, select: { id: true } });
        if (dup) { already++; continue; }
        await tx.driveDocument.create({ data: dd });
        made.push(r);
      }
    }, { timeout: 120_000, maxWait: 60_000 });
    created += made.length;
    journalAppend(made.map((r) => ({
      time, entity: "DriveDocument", id: r.data.id, field: "__create__", before: null,
      after: { ...r.data, docDate: r.data.docDate ? (r.data.docDate as Date).toISOString() : null }, source: `link-drive-docs-remaining; ${r.label}`,
    })));
  }
  console.log(`\nГОТОВО: создано ${created}, уже было ${already}. Журнал ${JOURNAL_PATH}. Откат: --rollback ${JOURNAL_PATH}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
