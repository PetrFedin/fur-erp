/**
 * Оплаты производства, даты ТЗ и списание сырья по ТЗ без списаний — ТОЛЬКО по
 * документам Google Drive (папка «мех»; договор подряда №1605, ООО «Меркури
 * Мода» ↔ ООО «ВеллМех»). Продолжение apply-drive-production-corrections.ts.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-production-payments-dates.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-production-payments-dates.ts --apply    # запись
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-production-payments-dates.ts --rollback docs-inventory/corrections-journal-production-payments.json
 *
 * ПЕРЕД --apply СДЕЛАЙТЕ БЭКАП БАЗЫ (scripts/backup.sh).
 *
 * Что делает (всё идемпотентно, повторный прогон = 0 операций):
 *   1. ОПЛАТЫ ПРОИЗВОДСТВА. Новый ProductionPayment заводится только при
 *      документально подтверждённых ДАТЕ ФАКТИЧЕСКОЙ ОПЛАТЫ и СУММЕ. Письмо
 *      «согласовано» / «можно доплатить» — не оплата. Дата и сумма фактической
 *      оплаты по документам Drive подтверждены ТОЛЬКО для 11 уже заведённых
 *      платежей (баланс 040226 по 21.01.2026; письма «аванс оплачен 06.07.2026»),
 *      поэтому новых платежей скрипт не создаёт: все остальные счета/авансы
 *      выписаны в pending-таблицу с тем, чего не хватает. К существующим оплатам
 *      добавляются документы-подтверждения (баланс 040226, «Расчет по оплатам»,
 *      письма партий 17/18 о «аванс оплачен 06.07.2026») и пояснение к платежу
 *      партии 5 (в notes; сумма не меняется). ProductionPaymentOrder (привязка к
 *      ТЗ) НЕ добавляется: приложение считает «оплачено» по ТЗ/партии как полную
 *      сумму каждой связанной оплаты (batch-stats.ts, production/[id]/page.tsx;
 *      суммы по ТЗ в связи не хранятся), поэтому привязка аванса к ТЗ нескольких
 *      партий задвоила бы оплату — см. pending.
 *   2. ДАТЫ ТЗ. workOrderDate — из ТЗ-приложений Drive с конкретной датой
 *      (шаблонная 16.05.2025 = дата договора игнорируется). endDate (стоит
 *      дата импорта 01.10.2026) — на дату отгрузки/поставки партии из документов
 *      (баланс 040226 + счёт/расчёт той же даты; письма «поставка принята»), только
 *      где документы однозначны. Денежные поля не пересчитываются.
 *   3. СПИСАНИЕ СЫРЬЯ у ТЗ без списаний: только если лоты однозначно определяются
 *      приложением ТЗ (номер лота + цена: цена ТЗ = цена лота без НДС × 1,04) и
 *      остатка хватает на ВСЕ строки (как в приложении, всё-или-ничего). Правила
 *      — consumeFromLot из src/lib/stock.ts (продублированы ниже): StockMovement
 *      PRODUCTION_OUT + уменьшение остатка лота + ProductionMaterialUsage по цене лота,
 *      статус PLANNED → IN_PROGRESS.
 *   4. Журнал docs-inventory/corrections-journal-production-payments.json;
 *      --rollback возвращает всё с конца (пропуская изменённое после скрипта).
 *   5. Спорное → docs-inventory/pending-decisions-production-payments.md.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL_PATH = join(INV, "corrections-journal-production-payments.json");
const PENDING_PATH = join(INV, "pending-decisions-production-payments.md");
const PLAN_PATH = join(INV, "corrections-plan-production-payments.txt");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const NOW = new Date();

// ---------------------------------------------------------------- утилиты
type ModelName =
  | "ProductionOrder" | "ProductionPayment" | "DriveDocument" | "StockMovement" | "RawMaterialLot" | "ProductionMaterialUsage";
type Change = { field: string; before: unknown; after: unknown };
type Op =
  | { kind: "update"; cat: string; model: ModelName; id: string; changes: Change[]; label: string; source: string }
  | { kind: "create"; cat: string; model: ModelName; id: string; data: Record<string, unknown>; label: string; source: string };
const ops: Op[] = [];
type Pending = { title: string; what: string; variants: string; sources: string };
const pending: Pending[] = [];
const pend = (title: string, what: string, variants: string, sources: string) => pending.push({ title, what, variants, sources });

const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");
const delegate = (m: ModelName) => m[0].toLowerCase() + m.slice(1);
const isDec = (v: unknown): v is Decimal => v instanceof Decimal;
const D = (v: Decimal.Value) => new Decimal(v);
const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const r3 = (v: Decimal) => v.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
const money = (v: Decimal.Value) => D(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(".", ",");
const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return "∅";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (isDec(v)) return v.toString();
  return String(v);
};
function eq(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (a instanceof Date || b instanceof Date) return new Date(a as never).getTime() === new Date(b as never).getTime();
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  try {
    return D(a as never).eq(D(b as never));
  } catch {
    return a === b;
  }
}
const iso = (s: string) => new Date(s + "T00:00:00.000Z");
const dmy = (s: string): Date | null => {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s.trim());
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const n = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return n ? new Date(Date.UTC(+n[1], +n[2] - 1, +n[3])) : null;
};
const LOOK: Record<string, string> = { а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", х: "x", у: "y" };
const nl = (s: string) => s.trim().toLowerCase().replace(/[а-яё]/g, (c) => LOOK[c] ?? c);

// ---------------------------------------------------------------- журнал / откат
const DATE_FIELDS = new Set(["workOrderDate", "paidAt", "startDate", "endDate", "date", "docDate", "createdAt"]);
function ser(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (isDec(v)) return v.toString();
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ser(x)]));
  return v;
}
const deser = (field: string, v: unknown): unknown => (DATE_FIELDS.has(field) && typeof v === "string" ? new Date(v) : v);
function buildJournal(time: string) {
  const out: Record<string, unknown>[] = [];
  for (const op of ops) {
    if (op.kind === "create") out.push({ time, entity: op.model, id: op.id, field: "__create__", before: null, after: ser(op.data), source: op.source });
    else for (const c of op.changes) out.push({ time, entity: op.model, id: op.id, field: c.field, before: ser(c.before), after: ser(c.after), source: op.source });
  }
  return out;
}
async function rollback(file: string) {
  const entries = JSON.parse(readFileSync(resolve(file), "utf-8")) as { entity: ModelName; id: string; field: string; before: unknown; after: unknown }[];
  console.log(`Откат по журналу ${file}: ${entries.length} записей (с конца).`);
  let reverted = 0, skipped = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const e of [...entries].reverse()) {
        const d = (tx as never as Record<string, any>)[delegate(e.entity)];
        if (e.field === "__create__") {
          const r = await d.deleteMany({ where: { id: e.id } });
          r.count ? reverted++ : skipped++;
          continue;
        }
        const where = { id: e.id, [e.field]: deser(e.field, e.after) };
        const r = await d.updateMany({ where: FORCE ? { id: e.id } : where, data: { [e.field]: deser(e.field, e.before) } });
        if (r.count) reverted++;
        else {
          skipped++;
          console.log(`  пропуск: ${e.entity} ${e.id} ${e.field} — значение уже не «${fmt(e.after)}» (менялось после скрипта); --force откатит принудительно`);
        }
      }
    },
    { timeout: 600_000, maxWait: 60_000 }
  );
  console.log(`Откат завершён: возвращено ${reverted}, пропущено ${skipped}.`);
}

// ---------------------------------------------------------------- данные отчётов
type Json = any;
const loadJson = (n: string): Json[] => JSON.parse(readFileSync(join(INV, "extract", n), "utf-8"));
const extract: Json[] = [...loadJson("prod2025a.json"), ...loadJson("prod2025b.json"), ...loadJson("prod2026.json")];
const manifest: Json[] = JSON.parse(readFileSync(join(INV, "drive-manifest.json"), "utf-8"));
const manifestById = new Map<string, Json>(manifest.map((f) => [f.id, f]));
const isDraft = (it: Json) => /черновик/i.test(String(it.docType ?? ""));
const isTzDoc = (it: Json) => /^ПРИЛОЖЕНИЕ/i.test(String(it.title ?? ""));

type DocLot = { lot: string; qty: number; priceExVat: number };
const tzDocs = new Map<number, { item: Json; w: Json }[]>();
for (const it of extract) {
  if (!isTzDoc(it) || isDraft(it)) continue;
  for (const w of it.workOrders ?? []) {
    if (typeof w.tzNumber !== "number") continue;
    const a = tzDocs.get(w.tzNumber) ?? [];
    a.push({ item: it, w });
    tzDocs.set(w.tzNumber, a);
  }
}

// ---------------------------------------------------------------- 2. ДАТЫ: endDate по партиям
// Дата отгрузки/поставки партии — только где документы однозначны.
const IMPORT_DAY = "2026-10-01"; // дата импорта, которой заполнены endDate
const BATCH_END: Record<number, { date: string; src: string }> = {
  1: { date: "2025-09-22", src: "баланс 040226: «отгрузка 41 изделий» 22.09.2025 = «расчёт доплаты за пошив 22.09.2025» = счёт №147 от 22.09.2025" },
  3: { date: "2025-10-10", src: "баланс 040226: отгрузка 10.10.2025 = «расчёт доплаты за пошив партия 3 10.10.2025» («Расчет по оплатам.xlsx»)" },
  4: { date: "2025-11-14", src: "баланс 040226: отгрузка 14.11.2025 = расчёт 14.11.2025 = счёт №203 от 14.11.2025" },
  6: { date: "2025-12-18", src: "баланс 040226: отгрузка 18.12.2025 = расчёт 18.12.2025 = счёт №239 от 18.12.2025" },
  7: { date: "2026-01-15", src: "баланс 040226: отгрузка 15.01.2026 = счёт №1 от 15.01.2026 («новый расчёт выслан 15.01.2026»)" },
  9: { date: "2026-02-04", src: "баланс 040226: отгрузка 04.02.2026 = счёт №7 от 04.02.2026 (расчёт выслан 04.02.2026)" },
  14: { date: "2026-07-06", src: "письмо «Re Партия 14» (12.08.2026): «поставка была 06.07.2026»" },
  19: { date: "2026-09-17", src: "письмо «Re Партия 19»: «Поставка принята сегодня – 17 сентября 2026»" },
};

// ---------------------------------------------------------------- 1. ОПЛАТЫ: документы-подтверждения к существующим платежам
const BALANCE_ID = "16uxtGDeePNXqZ8HeHPx5ofgyZpKUpbSh"; // баланс 040226.xlsx
const CALC_PAY_ID = "1UW9jXdunbvZYXeQz7ADEnTZqsp12jAh7"; // Расчет по оплатам.xlsx
const LETTER_17 = "1v5Cs3RwZiNmDD2v9kyxImo4KQhhQ6kQl"; // Re расчет доплаты по партии 17.msg
const LETTER_18 = "1n7t3aanTRxR79CsbEzxbbPGC3MuZNKNw"; // RE доплата ... поставка 18.msg
type PayDoc = { fileId: string; docType: "BALANCE" | "CALC_SHEET" | "APPROVAL_EMAIL"; payments: string[]; note: string };
const PAY_DOCS: PayDoc[] = [
  { fileId: BALANCE_ID, docType: "BALANCE", payments: ["Счёт №147 от 22.09.2025", "Счёт №170 от 30.09.2025", "Счёт №181 от 17.10.2025", "Счёт №203 от 14.11.2025", "Счёт №209 от 19.11.2025", "Счёт №235 от 04.12.2025", "Счёт №239 от 18.12.2025", "Счёт №1 от 15.01.2026", "Счёт №110 от 21.07.2025"],
    note: "Источник даты фактической оплаты: «Баланс по оплате за пошив … сверка по выполненным работам и оплатам» (баланс 040226.xlsx): строки «оплата, Меркури мода» с датами 08.2025 … 21.01.2026." },
  { fileId: CALC_PAY_ID, docType: "CALC_SHEET", payments: ["Счёт №110 от 21.07.2025", "Счёт №235 от 04.12.2025"],
    note: "Разнесение аванса 04.08.2025 по ТЗ/партиям и расчёт доплат партий 1–9 («Расчет по оплатам.xlsx»); для партии 5: к доплате 5 669 120 = работа 3 540 220 + шкуры подрядчика 4 584 500 − аванс 2 455 600." },
  { fileId: LETTER_17, docType: "APPROVAL_EMAIL", payments: ["Счёт №141 от 15.05.2026", "Счёт №143 от 15.05.2026"],
    note: "Письмо партии 17 (12.08.2026): «Аванс оплачен 06.07.2026» — подтверждение даты фактической оплаты авансов №141/№143." },
  { fileId: LETTER_18, docType: "APPROVAL_EMAIL", payments: ["Счёт №141 от 15.05.2026", "Счёт №143 от 15.05.2026"],
    note: "Письмо партии 18 (27.08/01.09.2026): «Аванс 70% был оплачен 06.07.2026» — подтверждение даты фактической оплаты авансов №141/№143." },
];
const BATCH5_DOCREF = "Счёт №235 от 04.12.2025";
const BATCH5_MARK = "Пояснение (платёж больше работы партии)";
const BATCH5_NOTE =
  " " + BATCH5_MARK + ": 5 669 120 = работа партии 5 3 540 220 + шкуры свакары подрядчика 4 584 500 − аванс 70% по партии 5 2 455 600 (уже оплачен в составе аванса 04.08.2025; «расчёт доплаты за 5ю партию», «Расчет по оплатам.xlsx»). " +
  "Превышение над работой 2 128 900 = 4 584 500 − 2 455 600; это оплата шкур подрядчика, а не переплата. Сумма платежа не менялась.";

// Кандидаты на оплаты, НЕ заведённые: нет документа о ФАКТИЧЕСКОЙ оплате (дата + сумма).
type Cand = { what: string; amount: string; doc: string; status: string; need: string };
const CANDS: Cand[] = [
  { what: "партия 8 (ТЗ 84–89)", amount: "400625.59", doc: "счёта и письма в Drive нет; расчёт «расчет пошива 8 партии.xlsx» (выслан 27.01.2026)", status: "по балансу 04.02.2026 сальдо 427 227,39 = счёт №7 (партия 9) — то есть отдельная доплата по партии 8 в балансе уже погашена; факта платежа нет", need: "платёжка/выписка или подтверждение бухгалтерии; решить, не покрыта ли доплата авансом (по расчёту аванс партии 8 = 814 949,80)" },
  { what: "партия 9 (ТЗ 90–96)", amount: "427227.39", doc: "счёт №7 от 04.02.2026; расчёт; баланс 040226", status: "согласовано 09.02.2026 (Решетняк В.); баланс 04.02.2026: сальдо = сумма счёта", need: "платёжка или письмо «оплачено» с датой" },
  { what: "партия 10 (ТЗ 97–100)", amount: "303372", doc: "счёт №41 от 18.02.2026; расчёт; письмо 19.02", status: "согласовано 19.02.2026", need: "платёжка/«оплачено»" },
  { what: "партия 11 (ТЗ 101–104)", amount: "347895", doc: "счёт №51 от 24.02.2026; расчёт; письмо 24.02–02.03", status: "согласовано 27.02.2026", need: "платёжка/«оплачено»" },
  { what: "партия 12, аксессуары (ТЗ 105–109)", amount: "1183135", doc: "счёт №65 от 02.03.2026; расчёт; письмо 02–10.03", status: "согласовано 10.03.2026", need: "платёжка/«оплачено»" },
  { what: "партия 12, жилет М003 (ТЗ 110)", amount: "217350", doc: "счёт №63 от 02.03.2026; письмо 14–20.04.2026", status: "согласовано 17.04.2026 (Решетняк); письмо 20.04: задержка оплаты из-за сверки, сверка 15.04.2026 — «расчёты по оплатам сошлись»", need: "платёжка/«оплачено» (сверка 15.04 даты платежа не называет)" },
  { what: "партия 13 (ТЗ 111–112)", amount: "183400", doc: "счёт №71 от 06.03.2026; расчёт; письмо 14–20.04.2026", status: "согласовано 17.04.2026; те же оговорки, что у №63", need: "платёжка/«оплачено»" },
  { what: "партия 14 (ТЗ 113–115)", amount: "158600", doc: "счёт №121 от 24.06.2026; расчёт; письмо «Re Партия 14»", status: "подтверждена партия 01.07.2026; письмо 12.08.2026: «если получили — естественно доплачиваем» — оплаты нет", need: "платёжка/«оплачено»" },
  { what: "партия 17 (ТЗ 118)", amount: "71400", doc: "счёт №207 от 16.07.2026; расчёт; письмо «Re расчёт доплаты по партии 17»", status: "12.08.2026: «Ок. Тогда можно доплатить»", need: "платёжка/«оплачено»" },
  { what: "партия 18 (ТЗ 119–135)", amount: "3397795", doc: "счёт №237 от 25.08.2026; расчёт; письмо", status: "согласовано 01.09.2026; «доплату поставим на исполнение 02 или 03.09»", need: "платёжка/«оплачено»" },
  { what: "партия 19 (ТЗ 136–151)", amount: "2126255", doc: "счёт №257 от 15.09.2026; расчёт 30%; письмо", status: "поставка принята 17.09.2026, оплата согласована 18.09.2026", need: "платёжка/«оплачено»" },
  { what: "партия 20 (ТЗ 152–162)", amount: "1892430", doc: "счёт №265 от 22.09.2026; расчёт; письмо «Re Партия 20»", status: "поставка принята 25.09.2026; «Ок» Киржнера; счёт занижен (см. отдельный пункт)", need: "платёжка/«оплачено»" },
  { what: "партия 21 (ТЗ 163–168)", amount: "442980", doc: "счёт №275 от 01.10.2026; расчёт", status: "выставлен 01.10.2026, срок оплаты 06.10.2026; согласования нет", need: "платёжка/«оплачено»" },
  { what: "аванс 2 (26 изд., без подклада)", amount: "2272060", doc: "счёт №247 от 01.09.2026; «07092026.xlsx»; письмо «Re аванс за пошив 2»", status: "согласовано 03.09.2026 (Киржнер); отгрузки 21–23.09", need: "платёжка/«оплачено»" },
  { what: "аванс 3 (55 изд.)", amount: "8290940", doc: "счёт №251 от 02.09.2026; «в работе на 01.09.2026»; письмо «Re Аванс за пошив 3»", status: "согласовано 03.09.2026 (отгрузки до 15.10)", need: "платёжка/«оплачено»" },
  { what: "дозаказ: аванс 6 × М001Е арктическая лиса", amount: "1008000", doc: "счёт №259 от 15.09.2026; письмо про дозаказ", status: "согласовано 16.09.2026 (Киржнер)", need: "платёжка/«оплачено»" },
  { what: "дозаказ: аванс 10 × М029 красная лиса", amount: "805000", doc: "счёт №261 от 15.09.2026; письмо про дозаказ", status: "согласовано 16.09.2026", need: "платёжка/«оплачено»" },
  { what: "индивидуальный кейп М057 (ТЗ 117)", amount: "248000", doc: "счёт №145 от 21.05.2026; расчёт; письмо «Re оплата производства инд.заказа на кейп»", status: "согласовано 26.05.2026 (Решетняк), срок 15.06", need: "платёжка/«оплачено»" },
  { what: "капсула CR01 (ТЗ нет)", amount: "660000", doc: "счёт №193 от 02.07.2026; расчёт", status: "согласования и оплаты в документах нет", need: "согласование + платёжка" },
];

// ---------------------------------------------------------------- состояние БД
type LotRec = { id: string; rawMaterialId: string; warehouseId: string; lotNumber: string | null; rem: Decimal; unitCost: Decimal; mex: Decimal; matName: string };
let orgId = "";

async function plan() {
  const org = await prisma.organization.findFirstOrThrow();
  orgId = org.id;

  // ============================================================ 2. ДАТЫ ТЗ
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId },
    include: { batch: { select: { number: true } }, materialUsages: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });
  const tzOf = (o: { workOrderNumber: string | null }) => (o.workOrderNumber && /^\d+$/.test(o.workOrderNumber) ? Number(o.workOrderNumber) : null);

  // --- workOrderDate: единственная конкретная дата во всех ТЗ-приложениях (без черновиков); 16.05.2025 — дата договора, не ТЗ
  const woSrc = new Map<number, Date>();
  let templ = 0;
  const woConflict: string[] = [];
  for (const [tz, list] of tzDocs) {
    const set = new Map<string, string>();
    for (const { item } of list) {
      const raw = String(item.date ?? "");
      if (/^16\.05\.2025/.test(raw) || /^2025-05-16/.test(raw)) { templ++; continue; }
      const d = dmy(raw);
      if (d) set.set(d.toISOString().slice(0, 10), item.title);
    }
    if (set.size === 1) woSrc.set(tz, iso([...set.keys()][0]));
    else if (set.size > 1) woConflict.push(`ТЗ ${tz}: ${[...set.keys()].join(" / ")}`);
  }
  let woCount = 0;
  const woFlag: number[] = [];
  for (const o of orders) {
    const tz = tzOf(o);
    if (tz == null || o.workOrderDate) continue;
    const d = woSrc.get(tz);
    if (!d) continue;
    woCount++;
    if (tz === 118 || (tz >= 113 && tz <= 115)) woFlag.push(tz);
    ops.push({ kind: "update", cat: "workOrderDate", model: "ProductionOrder", id: o.id, label: `ТЗ ${tz} (${o.number}) / workOrderDate`,
      source: `ТЗ-приложение Drive «${tzDocs.get(tz)![0].item.title}»: дата ТЗ ${d.toISOString().slice(0, 10)} (не шаблонная 16.05.2025)`,
      changes: [{ field: "workOrderDate", before: o.workOrderDate, after: d }] });
  }

  // --- endDate: заменить дату импорта на дату партии из документов
  const noEnd = new Map<number, number>();
  let endCount = 0;
  for (const o of orders) {
    if (!o.endDate || o.endDate.toISOString().slice(0, 10) !== IMPORT_DAY) continue;
    const bn = o.batch?.number ?? null;
    const m = bn != null ? BATCH_END[bn] : undefined;
    if (!m) { const key = bn ?? 0; noEnd.set(key, (noEnd.get(key) ?? 0) + 1); continue; }
    endCount++;
    ops.push({ kind: "update", cat: "endDate", model: "ProductionOrder", id: o.id, label: `ТЗ ${o.workOrderNumber ?? "—"} (${o.number}), партия ${bn} / endDate`,
      source: m.src, changes: [{ field: "endDate", before: o.endDate, after: iso(m.date) }] });
  }

  // ============================================================ 3. СПИСАНИЯ СЫРЬЯ
  const warehouse =
    (await prisma.warehouse.findFirst({ where: { organizationId: orgId, isDefault: true } })) ??
    (await prisma.warehouse.findFirstOrThrow({ where: { organizationId: orgId } }));
  void warehouse;
  const lotsDb = await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId }, include: { rawMaterial: { select: { name: true } } } });
  const lots: LotRec[] = lotsDb.map((l) => ({
    id: l.id, rawMaterialId: l.rawMaterialId, warehouseId: l.warehouseId, lotNumber: l.lotNumber, rem: l.quantityRemaining,
    unitCost: l.unitCost, mex: l.materialCostExclVat, matName: l.rawMaterial.name,
  }));
  const usedBy = async (lotId: string) =>
    (await prisma.productionMaterialUsage.findMany({ where: { lotId }, include: { productionOrder: { select: { workOrderNumber: true } } } }))
      .map((u) => u.productionOrder.workOrderNumber).filter(Boolean).join(", ");

  const noStock = orders.filter((o) => o.materialUsages.length === 0 && o.status !== "CANCELLED");
  const consumed: string[] = [];
  for (const o of noStock) {
    const tz = tzOf(o);
    if (tz == null) continue;
    const cand = (tzDocs.get(tz) ?? [])[0];
    const src = cand ? `«${cand.item.title}» (prod2026.json)` : "приложение ТЗ в выгрузке не найдено";
    if (!cand) { pend(`ТЗ ${tz}: списаний нет`, "Приложение ТЗ в выгрузке отчётов не найдено — лоты определить не по чему.", "—", "prod2026.md"); continue; }
    const docLots: DocLot[] = (cand.w.rawMaterials ?? []).map((r: Json) => ({ lot: String(r.lot), qty: Number(r.qty), priceExVat: Number(r.priceExVat) }));
    if (docLots.length === 0) {
      pend(`ТЗ ${tz}: списаний нет — по документам сырья нет`, `В приложении ТЗ нет строк «Заказчик передал» (${cand.w.contractor_skins_per_unit ? `сырьё подрядчика ${cand.w.contractor_skins_per_unit} ₽/ед. — шкуры без лота` : "сырьё в цене изделия/лоскут"}); без лота списывать нечего.`, "Оставить без списаний, пока не появится документ с лотом.", src);
      continue;
    }
    const problems: string[] = [];
    const need = new Map<string, { lot: LotRec; qty: Decimal; names: string[] }>();
    for (const dl of docLots) {
      const inner = /\(([^)]+)\)/.exec(dl.lot);
      const key = nl(inner ? inner[1] : dl.lot);
      const alias = /^\d+$/.test(key) ? `fw26-${key}` : null; // «1525» в ТЗ ↔ лот FW26-1525, если по цене совпадает
      const byName = lots.filter((l) => l.lotNumber && (nl(l.lotNumber) === key || (alias && nl(l.lotNumber) === alias)));
      const byPrice = byName.filter((l) => l.mex.mul("1.04").sub(dl.priceExVat).abs().lessThanOrEqualTo("0.03") || l.mex.sub(dl.priceExVat).abs().lessThanOrEqualTo("0.03"));
      if (byName.length === 0) { problems.push(`лот ${dl.lot} не найден в базе`); continue; }
      if (byPrice.length === 0) { problems.push(`лот ${dl.lot}: по номеру найден (${byName.map((l) => `${l.lotNumber} @${l.mex} без НДС`).join("; ")}), но цена ТЗ ${dl.priceExVat} (= цена лота × 1,04) не совпадает`); continue; }
      if (byPrice.length > 1) { problems.push(`лот ${dl.lot} неоднозначен по номеру и цене (${byPrice.map((l) => l.lotNumber).join(", ")})`); continue; }
      const c = byPrice[0];
      const e = need.get(c.id) ?? { lot: c, qty: D(0), names: [] };
      e.qty = e.qty.add(dl.qty);
      e.names.push(dl.lot);
      need.set(c.id, e);
    }
    for (const e of need.values()) {
      if (e.lot.rem.lessThan(e.qty)) problems.push(`лот ${e.lot.lotNumber}: нужно ${e.qty}, остаток ${e.lot.rem}${e.lot.rem.isZero() ? ` (всё списано на ТЗ ${await usedBy(e.lot.id)})` : ""}`);
    }
    if (problems.length || need.size === 0) {
      pend(`ТЗ ${tz}: сырьё не списано`, `Списание по документу не подобрано: ${problems.join("; ")}.`, "Поступить сырью/поправить лоты и остатки (приход или корректировка с документом), затем добавить списание в карточке ТЗ или повторить скрипт.", src);
      continue;
    }
    // --- списание (consumeFromLot из src/lib/stock.ts: движение PRODUCTION_OUT + остаток лота + ProductionMaterialUsage по цене лота)
    for (const { lot, qty } of need.values()) {
      const total = r2(lot.unitCost.mul(qty));
      const mid = newId();
      ops.push({ kind: "create", cat: "Списание сырья", model: "StockMovement", id: mid, label: `ТЗ ${tz}: списание лота ${lot.lotNumber} ×${qty}`, source: src,
        data: { id: mid, organizationId: orgId, warehouseId: lot.warehouseId, rawMaterialId: lot.rawMaterialId, lotId: lot.id, type: "PRODUCTION_OUT", quantity: r3(qty), unitCost: lot.unitCost, totalCost: total, productionOrderId: o.id, date: NOW } });
      ops.push({ kind: "update", cat: "Списание сырья", model: "RawMaterialLot", id: lot.id, label: `Лот ${lot.lotNumber}: остаток`, source: src, changes: [{ field: "quantityRemaining", before: lot.rem, after: lot.rem.sub(qty) }] });
      lot.rem = lot.rem.sub(qty);
      const uid = newId();
      ops.push({ kind: "create", cat: "Списание сырья", model: "ProductionMaterialUsage", id: uid, label: `ТЗ ${tz}: расход ${lot.matName} лот ${lot.lotNumber} ×${qty} по ${lot.unitCost}`, source: src,
        data: { id: uid, productionOrderId: o.id, rawMaterialId: lot.rawMaterialId, lotId: lot.id, quantity: r3(qty), unitCost: lot.unitCost, totalCost: total, date: NOW, commission4: true } });
      consumed.push(`ТЗ ${tz}: ${lot.lotNumber} ×${qty}`);
    }
    if (o.status === "PLANNED") {
      ops.push({ kind: "update", cat: "Списание сырья", model: "ProductionOrder", id: o.id, label: `ТЗ ${tz} (${o.number}) / status`, source: src, changes: [{ field: "status", before: "PLANNED", after: "IN_PROGRESS" }] });
    }
    const lin = cand.w.lining?.fabric;
    if (lin) pend(`ТЗ ${tz}: подкладка не списана`, `Подкладка по ТЗ: ${lin.name}, ${lin.meters} м (по ${lin.priceExVat} без НДС, ${lin.totalInclVat} с НДС); остаток подкладочных тканей на складе 0 — списание невозможно.`, "Оприходовать подкладку и списать, либо не списывать (политика владельца, как у ТЗ 119–151).", src);
  }
  // ТЗ без списаний, у которых есть известная причина — 75, 97, 104 покрыты ветвью «docLots.length === 0» (если приложения есть в выгрузке)
  for (const tz of [75, 97, 104]) {
    if (!orders.some((o) => tzOf(o) === tz)) continue;
    if (!pending.some((p) => p.title.startsWith(`ТЗ ${tz}:`))) {
      pend(`ТЗ ${tz}: списаний нет — по документам сырья нет`, tz === 75 ? "Лоскут соболя заказчика без лота (файл «тут нет продажи 4%»); изделие по документам изготовлено и оплачено в партии 7." : "Бобр — в цене изделия 16 980 (счёт, письмо 19.02.2026); лотов сырья в документах нет.", "Оставить без списаний.", "prod2025b.md §5");
    }
  }
  // лот 10026 — ТЗ №116
  {
    const l = lotsDb.find((x) => x.lotNumber === "10026");
    if (l) {
      const mv = await prisma.stockMovement.findMany({ where: { lotId: l.id, type: "ADJUSTMENT_OUT", productionOrderId: null } });
      const sum = mv.reduce((s, m) => s.add(m.quantity), D(0));
      pend("Лот 10026: 16 шт. списаны на «ТЗ №116 Ремонт пальто» без ТЗ", `В Drive (папка «мех», поиск по названию/тексту «ПРИЛОЖЕНИЕ 116», «ремонт пальто», «ТЗ 116») документа ТЗ 116 нет; в отчётах prod2025a/b/2026 ТЗ 116 тоже отсутствует (номер пропущен между 115 и 117). В базе есть только движение ADJUSTMENT_OUT ${sum} шт. (${mv.length} записей) с пометкой «реестр, строка 520-521». Лот 10026: получено ${l.quantityReceived}, остаток ${l.quantityRemaining}.`, "Оставить как есть (корректировка остатка по реестру) либо при появлении документа ТЗ 116 завести ТЗ и привязать списание.", "поиск по Drive (search_files); prod2026.md §5, §11");
    }
  }

  // ============================================================ 1. ОПЛАТЫ: документы к существующим платежам
  const payments = await prisma.productionPayment.findMany({ where: { organizationId: orgId } });
  const payByRef = new Map(payments.map((p) => [p.docRef ?? "", p]));
  const existingDocs = await prisma.driveDocument.findMany({ where: { organizationId: orgId, productionPaymentId: { not: null } }, select: { driveFileId: true, productionPaymentId: true } });
  const have = new Set(existingDocs.map((d) => `${d.driveFileId}|${d.productionPaymentId}`));
  let docCount = 0;
  for (const pd of PAY_DOCS) {
    const f = manifestById.get(pd.fileId);
    if (!f) throw new Error("Файл не найден в drive-manifest.json: " + pd.fileId);
    const title: string = f.title;
    for (const ref of pd.payments) {
      const p = payByRef.get(ref);
      if (!p) { console.log(`  [пропуск] оплата «${ref}» не найдена в БД`); continue; }
      if (have.has(`${pd.fileId}|${p.id}`)) continue;
      const id = newId();
      docCount++;
      ops.push({ kind: "create", cat: "Документы к оплатам", model: "DriveDocument", id, label: `[${pd.docType}] «${title}» → оплата ${ref}`, source: `drive-manifest: ${f.path}`,
        data: { id, organizationId: orgId, driveFileId: f.id, title, docType: pd.docType, mimeType: f.mimeType ?? null, sizeBytes: f.size != null && Number(f.size) < 2_147_483_647 ? Number(f.size) : null,
          drivePath: f.path, viewUrl: f.viewUrl ?? null, docDate: null, docNumber: null, year: null, notes: pd.note, productionPaymentId: p.id } });
      have.add(`${pd.fileId}|${p.id}`);
    }
  }
  // пояснение к платежу партии 5 (сумма не меняется)
  const p5 = payByRef.get(BATCH5_DOCREF);
  if (p5 && !(p5.notes ?? "").includes(BATCH5_MARK)) {
    ops.push({ kind: "update", cat: "Платёж партии 5", model: "ProductionPayment", id: p5.id, label: `Оплата ${BATCH5_DOCREF} / notes (пояснение; сумма не меняется)`,
      source: "расчёт доплаты за 5ю партию; «Расчет по оплатам.xlsx»", changes: [{ field: "notes", before: p5.notes, after: (p5.notes ?? "") + BATCH5_NOTE }] });
  }

  // ============================================================ PENDING
  const candSum = CANDS.reduce((s, c) => s.add(c.amount), D(0));
  const pCand = CANDS.filter((c) => /партия|кейп/.test(c.what) && !/аванс/.test(c.what) && !/капсула/.test(c.what)).reduce((s, c) => s.add(c.amount), D(0));
  const aCand = CANDS.filter((c) => /аванс/.test(c.what)).reduce((s, c) => s.add(c.amount), D(0));
  pend("Оплаты производства: НОВЫЕ платежи не заведены — нет документа о фактической оплате",
    `Дата и сумма ФАКТИЧЕСКОЙ оплаты (баланс 040226 по 21.01.2026; письма «аванс оплачен 06.07.2026») подтверждены только для 11 уже заведённых платежей (54 093 752,54 ₽). Для остальных документы Drive содержат лишь счёт и «согласовано/можно доплатить/ок» (это не оплата). Не заведено ${CANDS.length} позиций на ${money(candSum)} ₽ (доплаты и кейп ${money(pCand)} + авансы по счетам №247/251/259/261 ${money(aCand)} + капсула №193 660 000,00):\n\n` +
    "| Позиция | Сумма, ₽ | Документ | Что в документах | Чего не хватает |\n|---|---|---|---|---|\n" +
    CANDS.map((c) => `| ${c.what} | ${money(c.amount)} | ${c.doc} | ${c.status} | ${c.need} |`).join("\n"),
    "Передать платёжки/выписки (или письмо бухгалтерии «оплачено» с датой) — тогда заведу платёж с этой датой; либо владелец сам решает завести их как confirmed = false с датой согласования.",
    "prod2025b.md §7; prod2026.md §6; письма партий 8–21 (Drive); баланс 040226");
  pend("Платёж партии 5 (22.12.2025, 5 669 120) больше работы партии (3 540 220) на 2 128 900 — это не переплата",
    "Партия 5: работа 3 540 220 + шкуры свакары подрядчика 4 584 500 (4 584 500 — не работа, а продажа шкур подрядчиком; в расчёте доплаты колонка «Стоимость шкур»). Аванс 70% по партии 5 = 2 455 600 был оплачен 04.08.2025 в составе 21 627 900. Доплата = 3 540 220 + 4 584 500 − 2 455 600 = 5 669 120 (счёт №235, баланс 040226: «оплата 12/22/2025», «расчёт … партия 5 (включая шкуры)» 8 124 720). Превышение над работой: 5 669 120 − 3 540 220 = 2 128 900 = 4 584 500 − 2 455 600. Сумма платежа не менялась; пояснение дописано в notes платежа.",
    "Если «шкуры подрядчика» нужно учитывать отдельно от работ — разделить платёж на «работу» и «шкуры» (в модели нет поля) либо не относить шкуры к ТЗ партии; в списке закупок «Доп закупк сырья партия 5» (4 584 500) — проверить двойной учёт долга поставщику и оплаты клиента.",
    "«Расчет по оплатам.xlsx» (блок «партия 5»), баланс 040226, prod2025a.md §5");
  pend("Счёт №265 занижен на 115 110 — верная доплата по партии 20 = 2 007 540 (счёт НЕ менялся)",
    "Расчёт партии 20 (старая версия в Drive): ТЗ 152 М002А учтён по 18 000 вместо 386 500 (30% от разницы: недостаёт 110 550) и МН03 (ТЗ 160) по 7 600 вместо 9 500 (4 560). Σ = 115 110. Счёт №265 = 1 892 430; по расчёту должно быть 1 892 430 + 115 110 = 2 007 540. Письмо 22.09.2026 исправило лишь количество МН05 (10 → 14); новый расчёт был вложением, в Drive остался старый.",
    "Выставить доплату 115 110 / скорректировать счёт у подрядчика; в базе платёж по партии 20 не заводился.", "prod2026.md §6; расчёт доплаты по партии 20; счёт №265");
  pend("Аванс 21 627 900 и авансы 2026 не привязаны к ТЗ (ProductionPaymentOrder не добавлялся)",
    "Приложение (batch-stats.ts, карточка ТЗ) считает «оплачено» по ТЗ/партии как ПОЛНУЮ сумму каждой связанной оплаты (сумма по ТЗ в связи не хранится). Привязка аванса 21 627 900 (04.08.2025) к ТЗ партий 1–8 или авансов 141/143 (06.07.2026) к ТЗ партий 18–21 показала бы в каждой партии «оплачено» всю сумму аванса. Документы дают разнесение по партиям («Расчет по оплатам.xlsx», «Оплачено аванс 04.08.25»): партия 1 — 4 603 900; 2 — 2 840 600; 3 — 4 714 500; 4 — 3 942 400; 5 — 2 455 600; 6 — 1 114 750; 7 — 2 066 400; 8 — 814 949,80 (Σ 22 553 099,80; фактически оплачено 21 627 900, Δ 925 200 — по документам не объяснена). Для авансов 141/143 состав по изделиям — «расчёт взятых в работу изделий 01072026.xlsx» (по изделию «модель+размер», не по ТЗ). Поле партии у ProductionPayment отсутствует.",
    "Либо добавить в модель сумму по связи (ProductionPaymentOrder.amount) и разнести по таблице выше, либо оставить авансы без привязки (как сейчас). Лишние 925 200 — решить, на какие партии отнести.", "«Расчет по оплатам.xlsx»; prod2025a.md §5, §7; prod2026.md §6");
  pend("Партия 8: доплата 400 625,59 в балансе погашена, платежа нет",
    "Баланс 040226 на 04.02.2026: отгрузки 39 429 329,93 − оплаты 39 002 102,54 = сальдо 427 227,39 = счёт №7 (партия 9). Оплаты (все 9 заведены) превышают отгрузки по партию 8 включительно на 431 199,61, поэтому отдельная доплата партии 8 в балансе не требовалась; в «Расчет по оплатам.xlsx» к доплате партии 8 стоит 400 625,59 (аванс 814 949,80). Год партии 8 в документах противоречив (отгрузка 29.12.2025 в балансе vs расчёт 26–27.01.2026).",
    "Подтвердить у бухгалтерии, что по партии 8 доплата не выставлялась/зачтена.", "баланс 040226; «Расчет по оплатам.xlsx»");
  pend("Аванс 166 600 по ТЗ 118", "«оплачен вместе с авансом по аксессуарам» — входит в счёт №143 (3 230 780); отдельным платежом не заводился во избежание двойного счёта.", "Подтвердить, что 166 600 ⊂ №143.", "prod2026.md §2, §6");
  pend("workOrderDate: применены даты из ТЗ-приложений, проверить",
    `Проставлено дат ТЗ: ${woCount} (строк ТЗ). Шаблонная дата 16.05.2025 (дата договора; в ${templ} ТЗ-файлах) НЕ использована — у ТЗ 1–96 workOrderDate остаётся пустым. Для ТЗ 97–115 в документах везде «12.01.2026» (в т.ч. у ТЗ 113–115, поставленных в июле 2026 — дата выглядит копией шаблона, но это дата, стоящая в документах); у ТЗ 118 — «17.03.2026» (при счёте №207 от 16.07.2026 и поставке в июле; возможна опечатка 17.06). Конфликтов дат между версиями файлов: ${woConflict.length ? woConflict.join("; ") : "нет"}.`,
    "Если 12.01.2026 для ТЗ 113–115 и 17.03.2026 для ТЗ 118 неверны — откатить эти строки по журналу (поле workOrderDate) или поправить в карточке.", "extract/prod2025b.json, prod2026.json; pending №27 прежнего скрипта");
  const noEndTxt = [...noEnd.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => `${b === 0 ? "вне партии (ТЗ 117)" : "партия " + b}: ${n}`).join("; ");
  pend("endDate: даты поставки партий, которые документы не определяют однозначно",
    `Заменено дат окончания (с даты импорта 01.10.2026): ${endCount}. Остались с датой импорта (ТЗ): ${noEndTxt || "—"}. Причины: партия 2 — баланс 29.09.2025 vs расчёт 22.09.2025 vs УПД №171/счёт №170 30.09.2025; партия 5 — баланс 18.11.2025 vs расчёт/счёт №235 04.12.2025; партия 8 — баланс 29.12.2025 (опечатка?) vs расчёт 26–27.01.2026; партии 10–11 — только счета 18.02/24.02.2026 и согласования; партии 12–13 — «отгружены в начале марта 2026», счета 02.03/06.03; партия 17 — письма 03.07.2026 (ожидание активации КИЗ) без акта поставки; партия 18 — «поставка 31.08», затем «завтра 02.09.2026» (план, не акт); ТЗ 117 — только счёт №145 (срок 15.06) без акта; партии 20–21 — ТЗ в статусе IN_PROGRESS (endDate пуст, партия 20 принята 25.09.2026, партия 21 — счёт 01.10.2026).`,
    "Дать УПД/акты приёмки партий 2, 5, 8, 10–13, 17, 18, 20, 21 и ТЗ 117 — проставлю точные даты.", "баланс 040226; счета; письма партий (Drive)");
  const pend156 = consumed.length ? consumed.join("; ") : "—";
  pend("Лоты по ТЗ 156/157/165/167: итог", `Списаны по документам: ${pend156}. ТЗ 156: «лот 1525» из приложения — это лот FW26-1525 (48 шт.), а не старый лот 1525: цена в ТЗ 48 592,35 без НДС = 46 723,41 × 1,04 (цена FW26-1525 и 1526 одинакова), у старого лота 1525 цена 14 409,20; так же сверены 1526 (46 723,41), 1589 (41 731,65 × 1,04 = 43 400,92), 1587 (40 067,71 × 1,04 = 41 670,42). Остальное — см. пункты «ТЗ N: сырьё не списано» выше (ТЗ 157/167 — лоты есть и цены сходятся, но остаток 0: РП0426.x, СП0526.23 целиком ушли на ТЗ 139/142/144/151; ТЗ 165 — лота СП0526.19 в базе нет).`, "—", "приложения ТЗ 156/157/165/167");
  void woFlag;
}

// ---------------------------------------------------------------- вывод плана
function printPlan() {
  const lines: string[] = [];
  const byCat = new Map<string, Op[]>();
  for (const op of ops) byCat.set(op.cat, [...(byCat.get(op.cat) ?? []), op]);
  for (const [cat, list] of byCat) {
    lines.push(`\n=== ${cat} (${list.length}) ===`);
    for (const op of list) {
      if (op.kind === "update") for (const c of op.changes) lines.push(`${op.label.includes(c.field) ? op.label : op.label + " / " + c.field}: «${fmt(c.before)}» → «${fmt(c.after)}»   [${op.source}]`);
      else lines.push(`СОЗДАТЬ ${op.model}: ${op.label}   [${op.source}]`);
    }
  }
  return lines;
}

async function main() {
  const url = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : ROLLBACK ? "ОТКАТ" : "DRY-RUN (в БД не пишем)"}; БД: ${url}`);
  if (ROLLBACK) return rollback(ROLLBACK);

  await plan();
  const lines = printPlan();
  const keepOld = ops.length === 0 && existsSync(PLAN_PATH);
  if (!keepOld) writeFileSync(PLAN_PATH, lines.join("\n") + "\n");

  const SHORT = new Set(["endDate", "workOrderDate", "Документы к оплатам"]);
  let skip = false;
  for (const l of lines) {
    if (l.startsWith("\n=== ")) { const name = l.slice(5, l.indexOf(" (")); skip = SHORT.has(name); console.log(l); if (skip) console.log("  … полный список в docs-inventory/corrections-plan-production-payments.txt"); continue; }
    if (!skip) console.log(l);
  }
  console.log("\n=== СВОДКА ===");
  const cats = new Map<string, number>();
  for (const op of ops) cats.set(op.cat, (cats.get(op.cat) ?? 0) + (op.kind === "update" ? op.changes.length : 1));
  for (const [c, n] of cats) console.log(`  ${c}: ${n}`);
  console.log(`  Всего операций: ${ops.length}; pending-решений: ${pending.length}`);

  const md: string[] = ["# Спорное: оплаты производства, даты ТЗ, списания сырья — требуется решение владельца", "",
    `Сформировано скриптом apply-drive-production-payments-dates (${NOW.toISOString().slice(0, 10)}). Ничего из этого в базе не менялось.`, ""];
  pending.forEach((p, i) => md.push(`## ${i + 1}. ${p.title}`, "", `**Что:** ${p.what}`, "", `**Варианты:** ${p.variants}`, "", `**Источники:** ${p.sources}`, ""));
  if (!keepOld) writeFileSync(PENDING_PATH, md.join("\n"));
  console.log(keepOld ? "\nПлан пуст — файлы плана и pending предыдущего прогона не тронуты." : `\nPending: ${PENDING_PATH}\nПолный план: ${PLAN_PATH}`);

  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала бэкап!)."); return; }
  if (ops.length === 0) { console.log("Нечего применять — всё уже сделано."); return; }

  const time = new Date().toISOString();
  const journalNew = buildJournal(time);
  writeFileSync(JOURNAL_PATH + ".planned", JSON.stringify(journalNew, null, 2));
  await prisma.$transaction(
    async (tx) => {
      let i = 0;
      while (i < ops.length) {
        const op = ops[i];
        const d = (tx as never as Record<string, any>)[delegate(op.model)];
        if (op.kind === "create") {
          const batch = [op];
          while (i + batch.length < ops.length) {
            const nx = ops[i + batch.length];
            if (nx.kind === "create" && nx.model === op.model) batch.push(nx); else break;
          }
          await d.createMany({ data: batch.map((b) => (b as { data: Record<string, unknown> }).data) });
          i += batch.length;
          continue;
        }
        const where: Record<string, unknown> = { id: op.id };
        const data: Record<string, unknown> = {};
        for (const c of op.changes) { where[c.field] = c.before; data[c.field] = c.after; }
        const r = await d.updateMany({ where, data });
        if (r.count !== 1) throw new Error(`Не применено: ${op.model} ${op.id} — ${op.label} (значение в БД уже изменилось). Транзакция отменена.`);
        i++;
      }
    },
    { timeout: 900_000, maxWait: 60_000 }
  );
  const prev: unknown[] = existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) : [];
  writeFileSync(JOURNAL_PATH, JSON.stringify([...prev, ...journalNew], null, 2));
  try { unlinkSync(JOURNAL_PATH + ".planned"); } catch { /* */ }
  console.log(`\nГОТОВО: применено операций ${ops.length}, журнал ${JOURNAL_PATH} (+${journalNew.length} записей). Откат: --rollback ${JOURNAL_PATH}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
