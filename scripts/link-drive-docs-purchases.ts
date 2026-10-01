/**
 * Привязка документов Google Drive к ЗАКУПКАМ, лотам, оплатам и поставщику.
 *
 * Источники: отчёты агентов docs-inventory/extract/p2025a|p2025b|p2026a|p2026b (.json/.md)
 * и docs-inventory/drive-manifest.json (fileId, path, title, mimeType, size, viewUrl).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-purchases.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-purchases.ts --apply    # запись
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-purchases.ts --rollback docs-inventory/corrections-journal-drive-links.json
 *
 * ПЕРЕД --apply СДЕЛАЙТЕ БЭКАП БАЗЫ (scripts/backup.sh).
 *
 * Как устроено:
 *   1. Правила привязки — таблица RULES ниже (fileId → цели). Цели резолвятся
 *      SELECT-ами: номер закупки (P:), аукцион Purchase.auctionSession (S:),
 *      Purchase.invoiceNumber (I:), оплата по номеру счёта и дате (pay),
 *      лот (LOT:), поставщик (SUP). Файл должен быть покрыт правилом, дублем или
 *      записью в «спорное» — иначе скрипт останавливается.
 *   2. Одна строка DriveDocument на (файл × закупка/оплата/лот/поставщик).
 *      Ключ идемпотентности: organizationId + driveFileId + purchaseId|paymentId|lotId|supplierId.
 *   3. Дубли (одинаковые title+size, duplicateOf из отчёта при том же расширении/размере,
 *      «~$»-файлы) пропускаются. Файлы, уже загруженные как PurchaseDocument
 *      (то же имя и размер), не дублируются.
 *   4. --apply: одна транзакция на цель (закупка/оплата/лот/поставщик). Журнал
 *      docs-inventory/corrections-journal-drive-links.json дописывается после каждой
 *      транзакции. --rollback <журнал> удаляет созданные строки (по id).
 *   5. Неоднозначное и не привязанное — docs-inventory/pending-links.md,
 *      полный план — docs-inventory/drive-links-plan-purchases.txt.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL_PATH = join(INV, "corrections-journal-drive-links.json");
const PENDING_PATH = join(INV, "pending-links.md");
const PLAN_PATH = join(INV, "drive-links-plan-purchases.txt");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;

const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

// ---------------------------------------------------------------- типы
type DocType =
  | "AUCTION_INVOICE" | "UPD" | "CALC_SHEET" | "SPECIFICATION" | "CONTRACT" | "TZ_APPENDIX"
  | "PAYMENT_PROOF" | "PAYMENT_INVOICE" | "APPROVAL_EMAIL" | "BALANCE" | "OTHER";
type PayRef = { inv: string; date: string };
type Rule = {
  f: string; // префикс fileId
  to?: string[]; // цели: P:номер | S:сессия|сессия | I:счёт аукциона | SUP | LOT:номер@закупка
  pay?: PayRef[]; // оплаты по номеру счёта (+дата счёта); если не найдены — fb
  fb?: string[]; // запасные цели, если оплата не найдена (и для «осиротевших» оплат)
  type?: DocType;
  note?: string;
};
type Pending = { title: string; files: string; why: string };

// ---------------------------------------------------------------- правила
const RULES: Rule[] = [];
const PAY = (inv: string, date: string, fb: string[]) => ({ pay: [{ inv, date }], fb });
function R(prefixes: string, spec: Partial<Rule>) {
  for (const f of prefixes.split(/\s+/).filter(Boolean)) RULES.push({ f, ...spec });
}
const P = (n: number) => "P:З-2026-" + String(n).padStart(4, "0");

// --- 2025: закупки норки/свакары/каракуля (p2025a)
R("1783cI 1-6d7a 18odrQ 1oz-qF 1SHkG_ 1d8wgq 1rZb8r", { to: [P(2)] });
R("1Iq6Zk", PAY("40", "2025-03-10", [P(2)]));
R("1n1MGc", PAY("46", "2025-03-14", [P(2)]));
R("1R1f_u 1kGu6I 1OV1nt", PAY("76", "2025-05-13", [P(2)]));
R("15zHh7", PAY("103", "2025-07-03", [P(2)]));
R("1Ge8J1", PAY("96", "2025-06-24", [P(9)]));
R("1YjnZH 1LT26C", { to: [P(9)] });
R("1SO7Vn 1rOlrO", PAY("80", "2025-05-26", [P(8)]));
R("19yfmw 1E829o", { to: [P(8)] });
R("1Yo4CX 1o6gly 109FhF 1G3A-a 1cu0UN", { to: [P(5)] });
R("1wniie 16PXmJ", PAY("81", "2025-05-26", [P(5)]));
R("1nSY2v 1XDtOR 1vvAgv", PAY("117", "2025-07-29", [P(5)]));
R("1884L6 1cVbJG 1yX9MM 1qFTXc", { to: [P(6), P(7)] });
R("1-40DV", PAY("95", "2025-06-24", [P(6), P(7)]));
R("1HZbb_ 1I5Alr 1FDXvD", PAY("122", "2025-08-04", [P(6), P(7)]));
R("1hgRS7 1vL70w 1jZglM 1-C0AR 11hFQc 1EOhpy 1ZrWLg", { to: [P(3)] });
R("1LFeLx 19UOyw 1vsXvn", PAY("92", "2025-06-16", [P(3)]));
R("17phLb 1_a27M", PAY("127", "2025-08-13", [P(3)]));

// --- 2025: соболь, подкладка, договоры (p2025b)
const S0325 = "S:РП 03.25|СП 03.25";
const S0525 = "S:РП 05.25|СП 05.25";
R("1h507v 1T5V2E", { to: [S0325] });
R("13zGQV", PAY("31", "2025-02-27", [S0325]));
R("1Cxd10 1QTIPs 15BH0m", PAY("75", "2025-05-13", [S0325]));
R("1ZZCEt 1bmsHN 15VGjM 1Mtrmw", { to: ["S:РП 03.25"] });
R("19Z3ur 1B012E 12o198", { to: ["S:СП 03.25"] });
R("1lz9oF", { to: ["I:1046"] });
R("1ufcVJ", { to: ["I:1048"] });
R("1q5xyE", { to: ["I:1049"] });
R("1KGEvY", { to: ["I:1050"] });
R("14QpCc", { to: ["I:1051"] });
R("1UJi2E", { to: ["I:1052"] });
R("1mvQS-", { to: ["I:1053"] });
R("1Qo6Y0", { to: ["SUP"], type: "CONTRACT", note: "Договор КП №2502 от 26.02.2025 (в файле также Спец. №1)" });
R("1Qo6Y0", { to: [S0325], type: "SPECIFICATION", note: "Спецификация №1 — в составе файла договора КП №2502" });
R("1lqmos", { to: ["SUP"], type: "CONTRACT", note: "Договор КП №2502 от 26.02.2025 + Спец. №1–2" });
R("1BYBFi", { to: ["SUP"], type: "CONTRACT", note: "Переписка по договору подряда (ВеллМех — Меркури Мода)" });
R("1BN61a", { to: ["SUP"], type: "CONTRACT", note: "Черновик договора подряда и закупки сырья от 16.05.2025, без рецензии" });
R("16Dkx_ 1MpCwO 1A_YrG 1qoa2r 1ogZtF 14YvrZ", { to: [S0525] });
R("1Jrgpj 1PBRGK 1LPW4l 1R5Uaa", PAY("83", "2025-05-26", [S0525]));
R("1keyPD 1GVQMc", PAY("143", "2025-09-18", [S0525]));
R("1pu6bM 1IuWW3", { to: ["I:2227"] });
R("1zb47O 1ObB4m", { to: ["I:2094"] });
R("1TUdGl 1FajrD", { to: ["I:2095"] });
R("1PjKZH 1iVd-4", { to: ["I:2004"] });
R("1-7e8z 1GVCK-", PAY("241", "2025-12-22", [P(4)]));
R("1byxKL 1mj2bu 1CL8KO 1ciU5d 1nxIOF 1Ta_SW 1pYggT", { to: [P(4)] });
R("1qj2oY 1YqOfj", { to: [P(32)] });
R("1ljKjQ 1rabzN 1xntI0", PAY("100", "2025-07-01", [P(32)]));

// --- 2026: AME, лот 302127, лиса, рысь, SAGA 03-26 (p2026a)
R("1wrE1H 1antkx", PAY("253", "2026-09-09", [P(58)]));
R("1qx4qR 1AtV0o 1YTcVq 19SKFK 18qqVI 121IGl 15vVWq", { to: [P(58)] });
R("1xo07B 1I6c1v", PAY("167", "2026-05-29", [P(58)]));
R("1WxlJO 1bxWXB", PAY("153", "2026-05-22", [P(58)]));
R("1lm3YP 1Jbmgk", PAY("195", "2026-07-03", [P(40)]));
R("1NV8AU 1OTDnW", { to: [P(40)] });
R("16gCpG", { to: ["LOT:302127@З-2026-0040"], note: "Инвойс аукциона на лот 302127 (артикул 0278-003)" });
R("1Cx3SQ 1CUxGR 1p0hX6", { to: [P(59)] });
R("1gwhXi", PAY("209", "2026-07-16", [P(59)]));
R("1t0ede 1fPrYO", PAY("173", "2026-06-05", [P(49)]));
R("1oTfVX 1wEN3d", PAY("155", "2026-05-22", [P(49)]));
R("1Xjmil 1MIkP5 1OwmRh 1UWfIZ 1Cz03c 1DuLNQ 1xGrjR", { to: [P(49)] });
const S0326 = "S:SAGA 03-26";
R("1BQZey 1SqtIb 1IMa5K 1NCBE- 1AsUwj 1vyh_s 1O3f9k 1ruQO2", { to: [S0326] });
R("1oRD5S 1PH70z", PAY("105", "2026-04-06", [S0326]));
R("1NixKu 1Oi4KO", PAY("93", "2026-03-25", [S0326]));

// --- 2026: соболь РП 04-26 / СП 05-26 / СП 09-26 / СП 12.25 (p2026b)
const SRP = "S:Закупка меха 04-26";
const SSP = "S:СОЮЗПУШНИНА 05-26";
R("1ZFN8r 1B15QN 1cqmXS", { to: [SRP + "|СОЮЗПУШНИНА 05-26"] });
R("1TN_5y 1pUpng 1viv-O 1qFebp 1B0_ev", { to: [SRP] });
R("19oECr 1TZIXC 1aGu51 1zv5Vr", { to: [SSP] });
R("1kzqrH 1b5qMV 1qj9OG", PAY("197", "2026-07-09", [SRP + "|СОЮЗПУШНИНА 05-26"]));
R("1N752q 1nB6Um 1M-8iM", { to: [SSP] });
R("1Q7XJv 1er4_9 1lMjjg", { to: [SRP] });
R("1hq8ai", { to: [SRP + "|СОЮЗПУШНИНА 05-26"] });
R("1aM4Gv", { to: [SRP + "|СОЮЗПУШНИНА 05-26"], type: "OTHER", note: "Транспортный счёт (перевозка на выделку, МК ЛИС)" });
R("1uRmC1", { to: [SRP], type: "OTHER", note: "Транспортный счёт (доставка 670 шкур, МП-Прогресс)" });
R("14uyYh 1pbe_q", PAY("149", "2026-05-22", [SSP]));
R("1CrUft 11Zhm6", PAY("131", "2026-05-04", [SRP]));
R("1ZXuHb 1H1OZ9", PAY("117", "2026-04-13", [SRP + "|СОЮЗПУШНИНА 05-26"]));
R("1lf1-o 1xTFU6", {
  pay: [{ inv: "117", date: "2026-04-13" }, { inv: "131", date: "2026-05-04" }],
  fb: [SRP + "|СОЮЗПУШНИНА 05-26"],
});
R("15AlTW", { to: ["I:2019"] });
R("15KPpK", { to: ["I:2020"] });
R("1XLjZL 1aRjMC 134ZVp", { to: ["S:СП 09-26"] });
R("1QTOS6", { to: ["I:3050"] });
R("1sBK_1", { to: ["I:3024"] });
R("1eZ4Ur", { to: ["I:3020"] });
R("1AUtOm", { to: ["I:3017"] });
R("1q9XnM", { to: ["I:3023"] });
R("1bG9Vt", { to: ["I:3022"] });
R("19YR9s", { to: ["I:3019"] });
R("11JgwK", { to: ["I:3018"] });
R("1w3vhf", { to: ["S:СП 09-26"] });

// Явные дубли, которых нет в duplicateOf отчётов: [дубль, оригинал]
const MANUAL_DUPS: [string, string][] = [["1pYggT", "1mj2bu"]];

// Спорное / без цели в БД (файл → причина)
const PENDING_FILES: { f: string; title: string; why: string }[] = [
  { f: "1qt1ts", title: "Счета.pdf (сводный PDF счетов Веллмех №75, 76, 80, 81, 83)", why: "один файл на 5 разных закупок/аукционов; каждый счёт лежит в Drive отдельным файлом и привязан отдельно — сводник не привязан, чтобы не дублировать" },
  { f: "1DWzY2", title: "Соболь счета выделка + перевозки.pdf", why: "акты исполнителей (МК ЛИС, МП-Прогресс, Деловые Линии, ПЭК), часть выписана на ООО «Русский Мех»; отчёт p2025b велит привязывать осторожно — решение за владельцем" },
  { f: "1bnnr-", title: "RE ВЕЛЛМЕХ - МЕРКУРИ МОДА - УПД на соболь.msg", why: "письмо не прочитано агентом (не ясно, к какому УПД/аукциону относится)" },
  { f: "1uS6sP", title: "подкладка 2026 / Номера подкладок.xlsx", why: "закупки подкладки 2026 (спец. 13, счёт 157) в БД нет — привязывать не к чему" },
  { f: "1JzKvY", title: "подкладка 2026 / Re закупка подкладочной ткани ….msg", why: "закупки подкладки 2026 в БД нет" },
  { f: "1V37v-", title: "подкладка 2026 / инвойс подкладка Лавин.jpg", why: "закупки подкладки 2026 в БД нет" },
  { f: "1DIfQO", title: "подкладка 2026 / предварительный_расчет_за_подкладку.xlsx", why: "закупки подкладки 2026 в БД нет" },
  { f: "1silgJ", title: "подкладка 2026 / Счет на оплату № 157 от 26.05.2026.pdf", why: "закупки подкладки 2026 в БД нет; оплата 5 400 000 в БД нет" },
  { f: "1x2Klb", title: "подкладка 2026 / ПРИЛОЖЕНИЕ 13.docx", why: "закупки подкладки 2026 в БД нет" },
  { f: "1X09Yv", title: "доп материалы / Re меховой проект MVST - дозакупка материалов.msg", why: "закупки доп. материалов (спец. 16, счёт 181) в БД нет" },
  { f: "1telqH", title: "доп материалы / расчет за доп.материалы.xlsx", why: "закупки доп. материалов в БД нет" },
  { f: "1vtFw7", title: "доп материалы / Счет на оплату № 181 от 16.06.2026.pdf", why: "закупки доп. материалов в БД нет; оплата 19 870 в БД нет" },
  { f: "1h4Mel", title: "доп материалы / ПРИЛОЖЕНИЕ 16.docx", why: "закупки доп. материалов в БД нет" },
];

// ---------------------------------------------------------------- данные
type Json = any;
const manifest: Json[] = JSON.parse(readFileSync(join(INV, "drive-manifest.json"), "utf-8"));
const manById = new Map<string, Json>(manifest.map((m) => [m.id, m]));
type Rep = { src: string; it: Json };
const reps: Rep[] = [];
for (const n of ["p2025a", "p2025b", "p2026a", "p2026b"]) {
  const d = JSON.parse(readFileSync(join(INV, "extract", n + ".json"), "utf-8"));
  for (const it of Array.isArray(d) ? d : d.documents) reps.push({ src: n, it });
}
const repOrder = new Map(reps.map((r, i) => [r.it.fileId as string, i]));
const repById = new Map(reps.map((r) => [r.it.fileId as string, r]));

function resolvePrefix(p: string): string {
  const hits = reps.filter((r) => (r.it.fileId as string).startsWith(p));
  if (hits.length !== 1) throw new Error(`Префикс fileId «${p}» даёт ${hits.length} совпадений`);
  return hits[0].it.fileId;
}

const ext = (t: string) => (/\.([a-z0-9]+)$/i.exec(t)?.[1] ?? "").toLowerCase();
const normTitle = (t: string) =>
  t.toLowerCase().replace(/[_\s]+/g, " ").replace(/\(\d+\)/g, "").replace(/^копия\s+/, "").replace(/\s+\./g, ".").replace(/\s+/g, " ").trim();

/** fileId → fileId оставляемого оригинала, если файл — дубль (пропускается). */
function findDups(): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const { it } of reps) parent.set(it.fileId, it.fileId);
  const tilde = new Set<string>();
  const byKey = new Map<string, string>();
  for (const { it } of reps) {
    const m = manById.get(it.fileId);
    if (!m) continue;
    if (m.title.startsWith("~$")) { tilde.add(it.fileId); continue; }
    const key = `${m.title}|${m.size}`;
    if (byKey.has(key)) union(it.fileId, byKey.get(key)!);
    else byKey.set(key, it.fileId);
    const d = typeof it.duplicateOf === "string" ? it.duplicateOf : "";
    if (d && !/частично/i.test(d)) {
      const oid = d.trim().split(/\s+/)[0];
      const om = manById.get(oid);
      // копия в другом формате (xlsx ↔ pdf, docx ↔ pdf) — не дубль
      if (om && ext(om.title) === ext(m.title) && (om.size === m.size || normTitle(om.title) === normTitle(m.title))) union(it.fileId, oid);
    }
  }
  for (const [dupP, origP] of MANUAL_DUPS) union(resolvePrefix(dupP), resolvePrefix(origP));
  // в группе оставляем «лучший» файл: не «Копия…», без «(n)», раньше в отчётах
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  const score = (id: string) => {
    const t = manById.get(id)?.title ?? "";
    return [/^копия/i.test(t) ? 1 : 0, /\(\d+\)/.test(t) ? 1 : 0, repOrder.get(id) ?? 0];
  };
  const dup = new Map<string, string>();
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => { const x = score(a), y = score(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
    for (const id of sorted.slice(1)) dup.set(id, sorted[0]);
  }
  // явный дубль всегда уходит в пользу указанного оригинала
  for (const [dupP, origP] of MANUAL_DUPS) { dup.set(resolvePrefix(dupP), resolvePrefix(origP)); dup.delete(resolvePrefix(origP)); }
  for (const id of tilde) dup.set(id, "~$");
  return dup;
}

function autoType(it: Json, title: string): DocType {
  if (ext(title) === "msg") return "APPROVAL_EMAIL";
  const t = String(it.docType ?? "").toLowerCase();
  if (t === "счёт аукциона" || t === "auction_invoice") return "AUCTION_INVOICE";
  if (t === "упд" || t === "upd") return "UPD";
  if (t === "расчёт" || t === "calc_sheet") return "CALC_SHEET";
  if (t === "спецификация" || t === "specification") return "SPECIFICATION";
  if (t === "договор") return "CONTRACT";
  if (t === "счёт" || t.startsWith("счёт на оплату") || t === "advance_invoice") return "PAYMENT_INVOICE";
  if (/письмо|согласование|email/.test(t)) return "APPROVAL_EMAIL";
  return "OTHER";
}

const RU_MONTHS: Record<string, number> = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
function docNumberOf(type: DocType, title: string): string | null {
  const t = title;
  let m: RegExpExecArray | null;
  if (type === "PAYMENT_INVOICE" && (m = /сч[её]т(?:\s+на\s+оплату)?\s*(?:№\s*)?(\d+)/i.exec(t))) return m[1];
  if (type === "UPD" && (m = /УПД(?:\s*\(статус 1\))?\s*(?:№\s*)?(\d+)|УПД_статус_1_№_(\d+)/i.exec(t))) return m[1] ?? m[2];
  if (type === "SPECIFICATION" && (m = /(?:спец(?:ификация|\.)?|приложение)[\s_]*(?:№\s*)?(\d+)/i.exec(t))) return m[1];
  if (type === "AUCTION_INVOICE") {
    if ((m = /^(\d{4,5})\s/.exec(t))) return m[1];
    if ((m = /inv\s+(\d{4}-\d{3})/i.exec(t))) return m[1];
  }
  return null;
}
function docDateOf(type: DocType, it: Json, title: string): Date | null {
  if (!["PAYMENT_INVOICE", "UPD", "SPECIFICATION", "AUCTION_INVOICE", "CONTRACT"].includes(type)) return null;
  const m = /от\s+(\d{1,2})\s+([а-я]+)\s+(\d{4})/i.exec(title);
  if (m && RU_MONTHS[m[2].toLowerCase()]) return new Date(Date.UTC(+m[3], RU_MONTHS[m[2].toLowerCase()] - 1, +m[1]));
  const d = typeof it.date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.date) : null;
  return d ? new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])) : null;
}

// ---------------------------------------------------------------- журнал / откат
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

// ---------------------------------------------------------------- план
type Row = {
  fileId: string; target: { kind: "purchase" | "payment" | "lot" | "supplier"; id: string; label: string };
  data: Record<string, unknown>; src: string; exists: boolean;
};
const rows: Row[] = [];
const pending: Pending[] = [];
const skippedDup: string[] = [];
const skippedAttached: string[] = [];
const infoNoPayment: string[] = [];
const planLines: string[] = [];

async function plan() {
  const org = await prisma.organization.findFirstOrThrow();
  const orgId = org.id;
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: orgId },
    include: { items: { select: { lotId: true } }, supplier: { select: { id: true, name: true } } },
    orderBy: { number: "asc" },
  });
  const byNum = new Map(purchases.map((p) => [p.number, p]));
  const payments = await prisma.payment.findMany({ where: { organizationId: orgId } });
  const lots = await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId }, select: { id: true, lotNumber: true, purchaseId: true } });
  const existingDrive = await prisma.driveDocument.findMany({ where: { organizationId: orgId } });
  const existingKeys = new Set(
    existingDrive.map((d) => `${d.driveFileId}|${d.purchaseId ?? ""}|${d.paymentId ?? ""}|${d.lotId ?? ""}|${d.supplierId ?? ""}`)
  );
  const pdocs = await prisma.purchaseDocument.findMany({ where: { organizationId: orgId } });
  const normName = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").trim();
  const supplierIds = new Set(purchases.map((p) => p.supplierId));
  if (supplierIds.size !== 1) throw new Error("Ожидался один поставщик, найдено " + supplierIds.size);
  const supplier = purchases[0].supplier;

  const dups = findDups();
  const pendingByFile = new Map(PENDING_FILES.map((p) => [resolvePrefix(p.f), p]));
  const rulesByFile = new Map<string, Rule[]>();
  for (const rule of RULES) {
    const id = resolvePrefix(rule.f);
    rulesByFile.set(id, [...(rulesByFile.get(id) ?? []), rule]);
  }

  // покрытие
  const uncovered = reps.filter(({ it }) => !rulesByFile.has(it.fileId) && !pendingByFile.has(it.fileId) && !dups.has(it.fileId));
  if (uncovered.length) {
    for (const u of uncovered) console.error("НЕ ПОКРЫТ ПРАВИЛОМ:", u.src, u.it.fileId, u.it.title);
    throw new Error(`${uncovered.length} файлов отчётов не покрыты правилами`);
  }
  for (const [id, p] of pendingByFile) pending.push({ title: p.title, files: id, why: p.why });

  const sessPurchases = (spec: string) => {
    const names = spec.split("|");
    return purchases.filter((p) => p.auctionSession && names.includes(p.auctionSession));
  };
  const isAttached = (p: (typeof purchases)[number], title: string, size: number | null) =>
    pdocs.some((d) => d.sizeBytes === size && normName(d.originalName) === normName(title) && (d.purchaseId === p.id || (d.batch && d.batch === p.auctionSession)));

  const add = (fileId: string, rule: Rule, type: DocType, kind: Row["target"]["kind"], id: string, label: string, extraNote: string | null) => {
    const m = manById.get(fileId)!;
    const { it, src } = repById.get(fileId)!;
    const data: Record<string, unknown> = {
      id: newId(), organizationId: orgId, driveFileId: fileId, title: m.title, docType: type,
      mimeType: m.mimeType ?? null, sizeBytes: m.size ?? null, drivePath: m.path ?? null, viewUrl: m.viewUrl ?? null,
      docDate: docDateOf(type, it, m.title), docNumber: docNumberOf(type, m.title),
      year: typeof it.year === "number" ? it.year : null,
      notes: [rule.note, extraNote, `Привязка по отчёту ${src}`].filter(Boolean).join(". "),
      purchaseId: null, paymentId: null, lotId: null, supplierId: null,
    };
    data[kind === "purchase" ? "purchaseId" : kind === "payment" ? "paymentId" : kind === "lot" ? "lotId" : "supplierId"] = id;
    const key = `${fileId}|${data.purchaseId ?? ""}|${data.paymentId ?? ""}|${data.lotId ?? ""}|${data.supplierId ?? ""}`;
    if (rows.some((r) => `${r.fileId}|${r.data.purchaseId ?? ""}|${r.data.paymentId ?? ""}|${r.data.lotId ?? ""}|${r.data.supplierId ?? ""}` === key)) return;
    rows.push({ fileId, target: { kind, id, label }, data, src, exists: existingKeys.has(key) });
  };

  const addPurchase = (fileId: string, rule: Rule, type: DocType, p: (typeof purchases)[number], extra: string | null) => {
    const m = manById.get(fileId)!;
    if (isAttached(p, m.title, m.size)) { skippedAttached.push(`${m.title} → ${p.number} (уже вложен как PurchaseDocument)`); return; }
    add(fileId, rule, type, "purchase", p.id, p.number, extra);
  };

  function resolveTargets(fileId: string, rule: Rule, specs: string[], type: DocType, extra: string | null) {
    const m = manById.get(fileId)!;
    for (const spec of specs) {
      if (spec.startsWith("P:")) {
        const p = byNum.get(spec.slice(2));
        if (!p) { pending.push({ title: m.title, files: fileId, why: `закупка ${spec.slice(2)} не найдена` }); continue; }
        addPurchase(fileId, rule, type, p, extra);
      } else if (spec.startsWith("S:")) {
        const list = sessPurchases(spec.slice(2));
        if (!list.length) { pending.push({ title: m.title, files: fileId, why: `нет закупок с auctionSession «${spec.slice(2)}»` }); continue; }
        for (const p of list) addPurchase(fileId, rule, type, p, extra);
      } else if (spec.startsWith("I:")) {
        const list = purchases.filter((p) => p.invoiceNumber === spec.slice(2));
        if (list.length !== 1) { pending.push({ title: m.title, files: fileId, why: `invoiceNumber ${spec.slice(2)}: найдено закупок ${list.length}` }); continue; }
        addPurchase(fileId, rule, type, list[0], extra);
      } else if (spec === "SUP") {
        add(fileId, rule, type, "supplier", supplier.id, `Поставщик ${supplier.name}`, extra);
      } else if (spec.startsWith("LOT:")) {
        const [num, pn] = spec.slice(4).split("@");
        const p = byNum.get(pn);
        const l = lots.filter((x) => x.lotNumber === num && x.purchaseId === p?.id);
        if (l.length !== 1) { pending.push({ title: m.title, files: fileId, why: `лот ${num} в ${pn}: найдено ${l.length}` }); continue; }
        add(fileId, rule, type, "lot", l[0].id, `лот ${num} (${pn})`, extra);
      } else throw new Error("Неизвестная цель " + spec);
    }
  }

  for (const { it } of reps) {
    const fileId: string = it.fileId;
    const m = manById.get(fileId);
    if (!m) { pending.push({ title: it.title, files: fileId, why: "нет в drive-manifest.json" }); continue; }
    if (dups.has(fileId)) { skippedDup.push(`${m.title} (${fileId.slice(0, 6)}) — дубль ${dups.get(fileId)!.slice(0, 6)}`); continue; }
    for (const rule of rulesByFile.get(fileId) ?? []) {
      const type = rule.type ?? autoType(it, m.title);
      if (rule.to) { resolveTargets(fileId, rule, rule.to, type, null); continue; }
      // оплата по номеру счёта и дате
      const matched: typeof payments = [];
      for (const pr of rule.pay ?? []) {
        const d0 = new Date(pr.date + "T00:00:00Z").getTime();
        const re = new RegExp(`сч[её]т(?:\\s+Веллмех)?\\s*№\\s*${pr.inv}(?!\\d)`, "i");
        for (const pay of payments) {
          const dt = pay.paidAt.getTime();
          if (re.test(`${pay.docRef ?? ""} ${pay.notes ?? ""}`) && dt >= d0 - 3 * 864e5 && dt <= d0 + 150 * 864e5 && !matched.includes(pay)) matched.push(pay);
        }
      }
      if (!matched.length) {
        infoNoPayment.push(`${m.title} — оплаты по счёту ${(rule.pay ?? []).map((x) => x.inv).join("/")} в БД нет, привязан к закупке`);
        resolveTargets(fileId, rule, rule.fb ?? [], type, null);
        continue;
      }
      let orphan = false;
      for (const pay of matched) {
        const lab = `оплата ${pay.paidAt.toISOString().slice(0, 10)} ${pay.amount} (${(pay.notes ?? "").match(/\[fix:P\d+\]/)?.[0] ?? pay.id})`;
        add(fileId, rule, type, "payment", pay.id, lab, null);
        if (!pay.purchaseId && !pay.auctionSession) orphan = true;
      }
      if (orphan) resolveTargets(fileId, rule, rule.fb ?? [], type, "оплата без закупки/аукциона — дублируется на закупки для видимости");
    }
  }

  // --- вывод плана
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(`${r.target.kind}:${r.target.id}`, [...(groups.get(`${r.target.kind}:${r.target.id}`) ?? []), r]);
  planLines.push("=== ПЛАН ПРИВЯЗКИ (цель → документы) ===");
  const order = [...groups.entries()].sort((a, b) => a[1][0].target.label.localeCompare(b[1][0].target.label));
  for (const [, rs] of order) {
    planLines.push(`\n${rs[0].target.label} — ${rs.length} док.`);
    for (const r of rs) planLines.push(`  ${r.exists ? "[уже есть]" : "[+]"} ${String(r.data.docType).padEnd(15)} ${r.data.title}${r.data.docNumber ? "  №" + r.data.docNumber : ""}`);
  }
  planLines.push("\n=== ПРОПУЩЕНО КАК ДУБЛИ ===", ...skippedDup.map((s) => "  " + s));
  planLines.push("\n=== УЖЕ ВЛОЖЕНО КАК PurchaseDocument ===", ...skippedAttached.map((s) => "  " + s));
  planLines.push("\n=== СЧЕТА/ПИСЬМА БЕЗ ОПЛАТЫ В БД (привязаны к закупке) ===", ...[...new Set(infoNoPayment)].map((s) => "  " + s));

  // --- закупки без документов
  const payToPurchase = new Map(payments.filter((p) => p.purchaseId).map((p) => [p.id, p.purchaseId!]));
  const lotToPurchase = new Map(lots.filter((l) => l.purchaseId).map((l) => [l.id, l.purchaseId!]));
  const have = new Set<string>();
  const mark = (pid: string | null | undefined, lid: string | null | undefined, payid: string | null | undefined) => {
    if (pid) have.add(pid);
    if (lid && lotToPurchase.has(lid)) have.add(lotToPurchase.get(lid)!);
    if (payid && payToPurchase.has(payid)) have.add(payToPurchase.get(payid)!);
  };
  for (const d of existingDrive) mark(d.purchaseId, d.lotId, d.paymentId);
  for (const d of pdocs) if (d.purchaseId) have.add(d.purchaseId);
  for (const d of pdocs) if (d.batch) for (const p of purchases) if (p.auctionSession === d.batch) have.add(p.id);
  for (const r of rows) mark(r.data.purchaseId as string, r.data.lotId as string, r.data.paymentId as string);
  const noDocs = purchases.filter((p) => !have.has(p.id));
  return { noDocs, total: purchases.length, withDocs: purchases.length - noDocs.length };
}

const NO_DOC_REASON = (num: string, note: string | null): string => {
  const n = Number(num.slice(-4));
  if (n === 1) return "лиса 55 шт — документов в отчётах/Drive нет";
  if ([10, 11, 12, 13].includes(n)) return "«Доп закупк сырья партия N» — в Drive нет документов";
  if ([30, 31].includes(n)) return "реконструировано из ТЗ — документов нет";
  return note ?? "в отчётах документов нет";
};

async function main() {
  const url = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : ROLLBACK ? "ОТКАТ" : "DRY-RUN (в БД не пишем)"}; БД: ${url}`);
  if (ROLLBACK) return rollback(ROLLBACK);

  const { noDocs, total, withDocs } = await plan();
  const todo = rows.filter((r) => !r.exists);
  const kinds = (rs: Row[]) => ({
    purchase: rs.filter((r) => r.target.kind === "purchase").length,
    payment: rs.filter((r) => r.target.kind === "payment").length,
    lot: rs.filter((r) => r.target.kind === "lot").length,
    supplier: rs.filter((r) => r.target.kind === "supplier").length,
  });
  const k = kinds(todo);
  const types = new Map<string, number>();
  for (const r of todo) types.set(String(r.data.docType), (types.get(String(r.data.docType)) ?? 0) + 1);

  planLines.push("\n=== ЗАКУПКИ БЕЗ ДОКУМЕНТОВ ПОСЛЕ ПРИВЯЗКИ ===", ...noDocs.map((p) => `  ${p.number}: ${NO_DOC_REASON(p.number, null)}`));
  writeFileSync(PLAN_PATH, planLines.join("\n") + "\n");

  const md = [
    "# Спорное и не привязанное — привязка документов Drive к закупкам", "",
    `Сформировано scripts/link-drive-docs-purchases.ts (${new Date().toISOString().slice(0, 10)}). Ничего из этого в базе не привязано.`, "",
  ];
  pending.forEach((p, i) => md.push(`## ${i + 1}. ${p.title}`, "", `**fileId:** ${p.files}`, "", `**Почему не привязано:** ${p.why}`, ""));
  md.push("## Справка: оплаты, которых нет в базе", "", "Счета и письма по этим оплатам привязаны к закупке (платежа в БД нет):", "", ...[...new Set(infoNoPayment)].map((s) => `- ${s}`), "");
  md.push("## Справка: оплаты без закупки и аукциона (P06, P07, P08)", "", "Документы этих оплат привязаны к оплате и дополнительно к закупкам аукциона/подкладки — иначе они не видны ни на одной странице. После ручной привязки оплаты к закупке дубли на закупках можно удалить.", "");
  writeFileSync(PENDING_PATH, md.join("\n"));

  console.log(`\nФайлов в отчётах: ${reps.length}; дублей пропущено: ${skippedDup.length}; уже вложено как PurchaseDocument (строк): ${skippedAttached.length}; в «спорное»: ${pending.length}`);
  console.log(`Строк DriveDocument: всего в плане ${rows.length}, к созданию ${todo.length}, уже есть ${rows.length - todo.length}`);
  console.log(`  к закупкам ${k.purchase}, к оплатам ${k.payment}, к лотам ${k.lot}, к поставщику ${k.supplier}`);
  console.log("  по типам: " + [...types].map(([t, n]) => `${t} ${n}`).join(", "));
  console.log(`Закупок с документами (с учётом лотов/оплат/PurchaseDocument): ${withDocs} из ${total}; без документов: ${noDocs.length}`);
  for (const p of noDocs) console.log(`  ${p.number}: ${NO_DOC_REASON(p.number, null)}`);
  console.log(`План: ${PLAN_PATH}\nСпорное: ${PENDING_PATH}`);

  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала бэкап!)."); return; }
  if (!todo.length) { console.log("Нечего применять — всё уже привязано."); return; }

  // --- запись: одна транзакция на цель
  const groups = new Map<string, Row[]>();
  for (const r of todo) groups.set(`${r.target.kind}:${r.target.id}`, [...(groups.get(`${r.target.kind}:${r.target.id}`) ?? []), r]);
  let created = 0;
  let already = 0;
  for (const [, rs] of groups) {
    const time = new Date().toISOString();
    const made: Row[] = [];
    await prisma.$transaction(async (tx) => {
      for (const r of rs) {
        const d = r.data as any;
        const dup = await tx.driveDocument.findFirst({
          where: {
            organizationId: d.organizationId, driveFileId: d.driveFileId,
            purchaseId: d.purchaseId, paymentId: d.paymentId, lotId: d.lotId, supplierId: d.supplierId,
          },
          select: { id: true },
        });
        if (dup) { already++; continue; }
        await tx.driveDocument.create({ data: d });
        made.push(r);
      }
    }, { timeout: 120_000, maxWait: 60_000 });
    created += made.length;
    journalAppend(made.map((r) => ({
      time, entity: "DriveDocument", id: r.data.id, field: "__create__", before: null,
      after: { ...r.data, docDate: r.data.docDate ? (r.data.docDate as Date).toISOString() : null }, source: `${r.src}; ${r.target.label}`,
    })));
  }
  console.log(`\nГОТОВО: создано ${created}, уже было ${already}. Журнал ${JOURNAL_PATH}. Откат: --rollback ${JOURNAL_PATH}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
