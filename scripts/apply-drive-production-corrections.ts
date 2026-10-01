/**
 * Применение подтверждённых документами Google Drive исправлений по
 * производству («Производство меховых изделий — копия», договор подряда
 * №1605, ООО «Меркури Мода» ↔ ООО «ВеллМех») и свод ТЗ по партиям.
 *
 * Источники: отчёты агентов docs-inventory/extract/prod2025a|prod2025b|prod2026
 * (.md и .json) и docs-inventory/drive-manifest.json.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-production-corrections.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-production-corrections.ts --apply    # запись
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-production-corrections.ts --rollback docs-inventory/corrections-journal-production.json
 *
 * ПЕРЕД --apply СДЕЛАЙТЕ БЭКАП БАЗЫ (scripts/backup.sh).
 *
 * Как устроено:
 *   1. План строится только чтением (SELECT): снимок БД в памяти + данные
 *      отчётов → список операций «изменить поле / создать запись» с «было → стало»
 *      и источником. DRY-RUN печатает план (и пишет полный текст в
 *      docs-inventory/corrections-plan-production.txt), в БД не пишет ничего.
 *   2. --apply выполняет ту же самую операцию-за-операцией в ОДНОЙ транзакции.
 *      Перед каждым изменением поля сверяется, что в БД всё ещё «было» —
 *      иначе транзакция откатывается целиком (данные успели поменяться).
 *   3. Журнал docs-inventory/corrections-journal-production.json — массив
 *      {time, entity, id, field, before, after, source}; создание записи —
 *      field "__create__". --rollback <журнал> идёт по журналу с конца:
 *      возвращает before и удаляет созданные записи (пропуская то, что
 *      после скрипта уже кто-то менял — с предупреждением).
 *   4. Идемпотентно: что уже сделано, повторно не планируется.
 *   5. СПОРНОЕ не применяется, а пишется в
 *      docs-inventory/pending-decisions-production.md.
 *
 * Правила учёта — как в приложении (src/app/(app)/production/actions.ts,
 * src/lib/stock.ts): списание сырья из лота по фиксированной цене лота с
 * проверкой остатка (StockMovement PRODUCTION_OUT + уменьшение остатка +
 * ProductionMaterialUsage), нумерация П-ГГГГ-NNNN, статус IN_PROGRESS при
 * наличии списаний. Лот не найден / неоднозначен / мало остатка — списание
 * этого ТЗ целиком не делается (ничего не выдумываем), ТЗ создаётся без
 * сырья, причина — в pending.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL_PATH = join(INV, "corrections-journal-production.json");
const PENDING_PATH = join(INV, "pending-decisions-production.md");
const PLAN_PATH = join(INV, "corrections-plan-production.txt");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;

const NOW = new Date();

// ---------------------------------------------------------------- источники
const SRC_A = "prod2025a.md";
const SRC_B = "prod2025b.md";
const SRC_C = "prod2026.md";

const CLIENT_NAME = "ООО Меркури Мода";
const CONTRACT = "№ 1605 от 16.05.2025";
const CLIENT_INN = "5032277847";
const CLIENT_KPP = "997350001";
const CLIENT_ADDRESS = "143082, Московская обл., г. Одинцово, д. Барвиха, д. 114, стр. 2, эт. 1, пом. 100";

// ТЗ → партия (по таблицам отчётов). ТЗ 116 в Drive и базе нет, ТЗ 117 — индивидуальный кейп вне партии.
const BATCH_RANGES: [number, number, number][] = [
  [1, 1, 18], [2, 19, 23], [3, 24, 36], [4, 37, 48], [5, 49, 58], [6, 59, 69], [7, 70, 83],
  [8, 84, 89], [9, 90, 96], [10, 97, 100], [11, 101, 104], [12, 105, 110], [13, 111, 112],
  [14, 113, 115], [17, 118, 118], [18, 119, 135], [19, 136, 151], [20, 152, 162], [21, 163, 168],
];
const batchOfTz = (tz: number): number | null => BATCH_RANGES.find(([, a, b]) => tz >= a && tz <= b)?.[0] ?? null;

// plannedUnits — изделий по документам (счета/расчёты доплат); year — по датам счетов.
const BATCH_META: Record<number, { year: number | null; units: number | null; notes: string }> = {
  1: { year: 2025, units: 41, notes: "ТЗ 1–18. Счёт №147 от 22.09.2025, УПД №170 от 30.09.2025." },
  2: { year: 2025, units: 23, notes: "ТЗ 19–23. Счёт №170 от 30.09.2025, УПД №171, УПД МФВМ/19–23." },
  3: { year: 2025, units: 34, notes: "ТЗ 24–36. Счёт №181 от 17.10.2025." },
  4: { year: 2025, units: 30, notes: "ТЗ 37–48. Счёт №203 от 14.11.2025." },
  5: { year: 2025, units: 25, notes: "ТЗ 49–58. Счёт №235 от 04.12.2025 (+ шкуры свакары подрядчика 4 584 500)." },
  6: { year: 2025, units: 37, notes: "ТЗ 59–69. Счёт №239 от 18.12.2025." },
  7: { year: 2026, units: 50, notes: "ТЗ 70–83 (+ТЗ 75). Счёт №1 от 15.01.2026." },
  8: { year: 2026, units: 46, notes: "ТЗ 84–89. Счёта и письма в Drive нет; расчёт выслан 27.01.2026, в балансе «отгрузка партии 8» 29.12.2025 — год уточнить." },
  9: { year: 2026, units: 26, notes: "ТЗ 90–96. Счёт №7 от 04.02.2026; сальдо баланса 04.02.2026 = 427 227,39." },
  10: { year: 2026, units: 26, notes: "ТЗ 97–100. Счёт №41 от 18.02.2026 (в названии папки «28 ед», по документам 26)." },
  11: { year: 2026, units: 14, notes: "ТЗ 101–104. Счёт №51 от 24.02.2026." },
  12: { year: 2026, units: 49, notes: "ТЗ 105–110. Счета №63 (ТЗ 110) и №65 от 02.03.2026." },
  13: { year: 2026, units: 20, notes: "ТЗ 111–112. Счёт №71 от 06.03.2026." },
  14: { year: 2026, units: 14, notes: "ТЗ 113–115. Счёт №121 от 24.06.2026." },
  15: { year: null, units: null, notes: "Документов в Drive нет (папки «поставка 15» не существует); ТЗ не привязаны." },
  16: { year: null, units: null, notes: "Документов в Drive нет (папки «поставка 16» не существует); ТЗ не привязаны." },
  17: { year: 2026, units: 4, notes: "ТЗ 118 (4 аксессуара). Счёт №207 от 16.07.2026." },
  18: { year: 2026, units: 64, notes: "ТЗ 119–135 (37 верх + 27 аксессуаров). Счёт №237 от 25.08.2026." },
  19: { year: 2026, units: 41, notes: "ТЗ 136–151. Счёт №257 от 15.09.2026." },
  20: { year: 2026, units: 68, notes: "ТЗ 152–162 (24 верх + 44 аксессуара). Счёт №265 от 22.09.2026." },
  21: { year: 2026, units: 14, notes: "ТЗ 163–168. Счёт №275 от 01.10.2026." },
};

// ---------------------------------------------------------------- типы / утилиты
type ModelName =
  | "ProductionBatch" | "ProductionOrder" | "ProductionMaterialUsage" | "StockMovement" | "RawMaterialLot"
  | "ProductModel" | "Client" | "ProductionPayment" | "ProductionPaymentOrder" | "DriveDocument"
  | "FinishedGoodsMovement" | "FinishedGoodsStock";
type Change = { field: string; before: unknown; after: unknown };
type Op =
  | { kind: "update"; cat: string; model: ModelName; id: string; changes: Change[]; label: string; source: string }
  | { kind: "create"; cat: string; model: ModelName; id: string; data: Record<string, unknown>; label: string; source: string };

const ops: Op[] = [];
type Pending = { id: string; title: string; what: string; variants: string; sources: string };
const pending: Pending[] = [];
const pend = (title: string, what: string, variants: string, sources: string) =>
  pending.push({ id: String(pending.length + 1), title, what, variants, sources });

const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");
const delegate = (m: ModelName) => m[0].toLowerCase() + m.slice(1);
const isDec = (v: unknown): v is Decimal => v instanceof Decimal;
const D = (v: Decimal.Value) => new Decimal(v);
const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const r3 = (v: Decimal) => v.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
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
const dmy = (s: string): Date => {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s.trim());
  if (!m) throw new Error("bad date " + s);
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
};
const iso = (s: string) => new Date(s + "T00:00:00.000Z");
const MONTHS: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
};

// Латиница/кириллица-двойники: «М002А» (кир.) и «M002A» (лат.) — одно и то же.
const LOOK: Record<string, string> = { а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", х: "x", у: "y" };
const nl = (s: string) => s.trim().toLowerCase().replace(/[а-яё]/g, (c) => LOOK[c] ?? c);
const nm = (s: string) => nl(s).replace(/[\s\-_]/g, "");

// ---------------------------------------------------------------- журнал
const DATE_FIELDS = new Set(["workOrderDate", "paidAt", "startDate", "endDate", "date", "docDate", "createdAt", "receivedDate"]);
function ser(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (isDec(v)) return v.toString();
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ser(x)]));
  return v;
}
function deser(field: string, v: unknown): unknown {
  if (DATE_FIELDS.has(field) && typeof v === "string") return new Date(v);
  return v;
}
function buildJournal(time: string) {
  const out: Record<string, unknown>[] = [];
  for (const op of ops) {
    if (op.kind === "create") {
      out.push({ time, entity: op.model, id: op.id, field: "__create__", before: null, after: ser(op.data), source: op.source });
    } else {
      for (const c of op.changes) {
        out.push({ time, entity: op.model, id: op.id, field: c.field, before: ser(c.before), after: ser(c.after), source: op.source });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- откат
async function rollback(file: string) {
  const entries = JSON.parse(readFileSync(resolve(file), "utf-8")) as {
    entity: ModelName; id: string; field: string; before: unknown; after: unknown;
  }[];
  console.log(`Откат по журналу ${file}: ${entries.length} записей (с конца).`);
  let reverted = 0;
  let skipped = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const e of [...entries].reverse()) {
        const d = (tx as never as Record<string, any>)[delegate(e.entity)];
        if (e.field === "__create__") {
          const r = await d.deleteMany({ where: { id: e.id } });
          if (r.count) reverted++;
          else skipped++;
          continue;
        }
        const where = { id: e.id, [e.field]: deser(e.field, e.after) };
        const r = await d.updateMany({ where: FORCE ? { id: e.id } : where, data: { [e.field]: deser(e.field, e.before) } });
        if (r.count) reverted++;
        else {
          skipped++;
          console.log(`  пропуск: ${e.entity} ${e.id} ${e.field} — значение уже не «${fmt(e.after)}» (после скрипта менялось); --force откатит принудительно`);
        }
      }
    },
    { timeout: 600_000, maxWait: 60_000 }
  );
  console.log(`Откат завершён: возвращено ${reverted}, пропущено ${skipped}.`);
}

// ---------------------------------------------------------------- данные отчётов (JSON)
type Json = any;
const loadJson = (n: string): Json[] => JSON.parse(readFileSync(join(INV, "extract", n), "utf-8"));
const extract: Json[] = [...loadJson("prod2025a.json"), ...loadJson("prod2025b.json"), ...loadJson("prod2026.json")];
const jsonById = new Map<string, Json>();
for (const it of extract) if (it.fileId) jsonById.set(it.fileId, it);
const isDraft = (it: Json) => /черновик/i.test(String(it.docType ?? ""));
const isTzDoc = (it: Json) => /^ПРИЛОЖЕНИЕ/i.test(String(it.title ?? ""));
// tz -> записи ТЗ-приложений (без черновиков)
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
function docColor(tz: number): string | null {
  const set = new Set<string>();
  for (const { w } of tzDocs.get(tz) ?? []) {
    const c = typeof w.color === "string" ? w.color.trim() : "";
    if (c) set.add(c);
  }
  if (set.size !== 1) return null;
  const c = [...set][0];
  if (/[\/,]|разн|расход|верси/i.test(c)) return null;
  return c;
}

// ---------------------------------------------------------------- состояние БД (снимок)
type Usage = {
  id: string; rawMaterialId: string; lotId: string; quantity: Decimal; unitCost: Decimal; totalCost: Decimal;
  commission4: boolean; unit: string; matName: string; lotNumber: string | null; date: Date;
};
type OrderRec = {
  id: string; number: string; tz: string | null; modelId: string; modelName: string; status: string;
  plannedQuantity: Decimal; producedQuantity: Decimal; color: string | null; size: string | null;
  lining: string | null; clientId: string | null; contractNumber: string | null; workOrderDate: Date | null;
  clientWorkPricePerUnit: Decimal | null; batchId: string | null; materialCost: Decimal | null;
  expenseCost: Decimal | null; totalCost: Decimal | null; unitCost: Decimal | null;
  finishedWarehouseId: string; usages: Usage[]; isNew?: boolean;
};
type LotRec = { id: string; rawMaterialId: string; lotNumber: string | null; rem: Decimal; unitCost: Decimal; matName: string; unit: string };

let orgId = "";
let orders: OrderRec[] = [];
const lots: LotRec[] = [];

const tzRows = (tz: number | string) => orders.filter((o) => o.tz === String(tz));
const orderLabel = (o: OrderRec) => `ТЗ ${o.tz ?? "—"} (${o.number})`;

function push(op: Op) {
  ops.push(op);
}
/** Меняет поле заказа (если значение отличается) и фиксирует операцию. */
function setOrder(o: OrderRec, cat: string, field: keyof OrderRec & string, after: unknown, source: string, label = orderLabel(o)) {
  const before = (o as never as Record<string, unknown>)[field];
  if (eq(before, after)) return false;
  push({ kind: "update", cat, model: "ProductionOrder", id: o.id, changes: [{ field, before, after }], label: `${label} / ${field}`, source });
  (o as never as Record<string, unknown>)[field] = after;
  return true;
}

// ---------------------------------------------------------------- основной план
async function plan() {
  const org = await prisma.organization.findFirstOrThrow();
  orgId = org.id;
  const warehouse =
    (await prisma.warehouse.findFirst({ where: { organizationId: orgId, isDefault: true } })) ??
    (await prisma.warehouse.findFirstOrThrow({ where: { organizationId: orgId } }));

  // --- снимок
  const dbOrders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId },
    include: {
      productModel: { select: { name: true } },
      materialUsages: { include: { rawMaterial: { select: { name: true, unit: true } }, lot: { select: { lotNumber: true } } } },
    },
    orderBy: { number: "asc" },
  });
  orders = dbOrders.map((o) => ({
    id: o.id, number: o.number, tz: o.workOrderNumber, modelId: o.productModelId, modelName: o.productModel.name,
    status: o.status, plannedQuantity: o.plannedQuantity, producedQuantity: o.producedQuantity, color: o.color, size: o.size,
    lining: o.lining, clientId: o.clientId, contractNumber: o.contractNumber, workOrderDate: o.workOrderDate,
    clientWorkPricePerUnit: o.clientWorkPricePerUnit, batchId: o.batchId, materialCost: o.materialCost,
    expenseCost: o.expenseCost, totalCost: o.totalCost, unitCost: o.unitCost, finishedWarehouseId: o.finishedWarehouseId,
    usages: o.materialUsages.map((u) => ({
      id: u.id, rawMaterialId: u.rawMaterialId, lotId: u.lotId, quantity: u.quantity, unitCost: u.unitCost,
      totalCost: u.totalCost, commission4: u.commission4, unit: u.rawMaterial.unit, matName: u.rawMaterial.name,
      lotNumber: u.lot.lotNumber, date: u.date,
    })),
  }));
  const dbLots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: orgId },
    include: { rawMaterial: { select: { name: true, unit: true } } },
  });
  for (const l of dbLots) {
    lots.push({ id: l.id, rawMaterialId: l.rawMaterialId, lotNumber: l.lotNumber, rem: l.quantityRemaining, unitCost: l.unitCost, matName: l.rawMaterial.name, unit: l.rawMaterial.unit });
  }

  // =========================================================== (1) ПАРТИИ
  const existingBatches = await prisma.productionBatch.findMany({ where: { organizationId: orgId } });
  const batchId = new Map<number, string>();
  for (const b of existingBatches) batchId.set(b.number, b.id);
  for (let n = 1; n <= 21; n++) {
    const meta = BATCH_META[n];
    const src = `${n <= 5 ? SRC_A : n <= 13 ? SRC_B : SRC_C}, партия ${n}`;
    const ex = existingBatches.find((b) => b.number === n);
    if (!ex) {
      const id = newId();
      batchId.set(n, id);
      push({
        kind: "create", cat: "Партии", model: "ProductionBatch", id, label: `Партия ${n}`, source: src,
        data: { id, organizationId: orgId, number: n, name: `Поставка ${n}`, year: meta.year, plannedUnits: meta.units, notes: meta.notes },
      });
    } else {
      // только дозаполняем пустые поля, чужое не перезаписываем
      const ch: Change[] = [];
      if (ex.name == null) ch.push({ field: "name", before: null, after: `Поставка ${n}` });
      if (ex.year == null && meta.year != null) ch.push({ field: "year", before: null, after: meta.year });
      if (ex.plannedUnits == null && meta.units != null) ch.push({ field: "plannedUnits", before: null, after: meta.units });
      if (ex.notes == null) ch.push({ field: "notes", before: null, after: meta.notes });
      if (ch.length) push({ kind: "update", cat: "Партии", model: "ProductionBatch", id: ex.id, changes: ch, label: `Партия ${n}`, source: src });
    }
  }

  // =========================================================== клиент
  let client = await prisma.client.findFirst({ where: { organizationId: orgId, name: { equals: CLIENT_NAME, mode: "insensitive" } } });
  let clientIdVal: string;
  if (!client) {
    clientIdVal = newId();
    push({ kind: "create", cat: "Заказчик", model: "Client", id: clientIdVal, label: CLIENT_NAME, source: `${SRC_C} §5.10`, data: { id: clientIdVal, organizationId: orgId, name: CLIENT_NAME, inn: CLIENT_INN, address: CLIENT_ADDRESS, notes: `КПП ${CLIENT_KPP}` } });
  } else {
    clientIdVal = client.id;
    const ch: Change[] = [];
    if (!client.inn) ch.push({ field: "inn", before: client.inn, after: CLIENT_INN });
    if (!client.address) ch.push({ field: "address", before: client.address, after: CLIENT_ADDRESS });
    // отдельного поля КПП нет (поля не добавляем) — пишем в заметки, только если они пусты
    if (!client.notes) ch.push({ field: "notes", before: client.notes, after: `КПП ${CLIENT_KPP}` });
    if (ch.length) push({ kind: "update", cat: "Реквизиты заказчика", model: "Client", id: client.id, changes: ch, label: `Клиент «${client.name}»`, source: `${SRC_C} §5.10 (счета ВеллМех: ИНН 5032277847, КПП 997350001)` });
  }

  // =========================================================== модели (MH07, MGL03)
  const models = await prisma.productModel.findMany({ where: { organizationId: orgId } });
  const modelIdByNorm = new Map<string, string[]>();
  for (const m of models) modelIdByNorm.set(nm(m.name), [...(modelIdByNorm.get(nm(m.name)) ?? []), m.id]);
  const modelNameById = new Map(models.map((m) => [m.id, m.name]));
  function ensureModel(docName: string, category: string | null, source: string): string | null {
    const ids = modelIdByNorm.get(nm(docName)) ?? [];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) {
      pend(`Модель «${docName}» неоднозначна`, `В ProductModel несколько записей с названием, совпадающим по написанию (${ids.length}).`, "Объединить дубли моделей (scripts/merge-*.ts) и перезапустить скрипт.", source);
      return null;
    }
    const id = newId();
    push({ kind: "create", cat: "Модели", model: "ProductModel", id, label: `Модель ${docName}`, source, data: { id, organizationId: orgId, name: docName, category } });
    modelIdByNorm.set(nm(docName), [id]);
    modelNameById.set(id, docName);
    return id;
  }
  ensureModel("MH07", "Головной убор (ободок из лоскута соболя)", `${SRC_B} §5.1 (ТЗ 75)`);
  ensureModel("MGL03", "Варежки", `${SRC_B} §5.4 (ТЗ 88)`);

  // =========================================================== (1)+(2) партии, клиент, договор у существующих ТЗ
  const docTzSet = new Set<number>([...tzDocs.keys(), 88]);
  for (const o of orders) {
    if (!o.tz) continue;
    const tz = Number(o.tz);
    if (Number.isNaN(tz)) continue;
    const b = batchOfTz(tz);
    if (b != null && !o.batchId) setOrder(o, "Партия ТЗ", "batchId", batchId.get(b)!, `${tz <= 58 ? SRC_A : tz <= 112 ? SRC_B : SRC_C}: ТЗ ${tz} → партия ${b}`);
  }
  for (const o of orders) {
    if (!o.tz) continue;
    const tz = Number(o.tz);
    if (!docTzSet.has(tz)) continue;
    const src = `${tz <= 58 ? SRC_A : tz <= 112 ? SRC_B : SRC_C}: ТЗ-приложение к договору №1605 (ООО «Меркури Мода»)`;
    if (!o.clientId) setOrder(o, "Заказчик/договор", "clientId", clientIdVal, src);
    if (!o.contractNumber) setOrder(o, "Заказчик/договор", "contractNumber", CONTRACT, src);
  }

  // =========================================================== (2) точечные исправления
  const fixField = (tz: string, field: "size" | "lining", expectedBefore: string, after: string, src: string, cat: string) => {
    const rows = tzRows(tz);
    if (rows.length !== 1) { pend(`ТЗ ${tz}: поле ${field}`, `Ожидалась одна строка ТЗ, найдено ${rows.length}.`, `Исправить вручную на «${after}».`, src); return; }
    const o = rows[0];
    const cur = o[field];
    if (eq(cur, after)) return;
    if (!eq(cur, expectedBefore)) { pend(`ТЗ ${tz}: ${field}`, `В БД «${fmt(cur)}», в отчёте ожидалось «${expectedBefore}».`, `Применить «${after}» вручную, если документ верен.`, src); return; }
    setOrder(o, cat, field, after, src);
  };
  fixField("33", "size", "46, 46.50", "50, 46, 46", `${SRC_A} §6: ПРИЛОЖЕНИЕ 33 (размеры 50, 46, 46)`, "Размеры");
  fixField("54", "size", "44.48", "44, 48", `${SRC_A} §6: ПРИЛОЖЕНИЕ 54 (размеры 44, 48)`, "Размеры");
  fixField("113", "size", "58,60,62,64", "58,60,61,62", `${SRC_C} §5.3: ПРИЛОЖЕНИЕ 113`, "Размеры");
  fixField("137", "size", "40 42 42 44 44 44 46 48 50", "40 42 42 44 44 44 46 46 48 50", `${SRC_C} §5.4: ПРИЛОЖЕНИЕ 137 (10 шт.)`, "Размеры");
  fixField("124", "size", "42 44 45", "42 44 46", `${SRC_C} §5.5: ПРИЛОЖЕНИЕ 124`, "Размеры");
  fixField("122", "lining", "100 % шерсть", "100 % кашемир", `${SRC_C} §5.8: ПРИЛОЖЕНИЕ 122`, "Текст подкладки");
  fixField("126", "lining", "Кашемир Colombo 97064 (74% кашемир 22% вискоза 1% шелка)", "Кашемир Colombo 97064 (74% кашемир 23% вискоза 3% шелка)", `${SRC_C} §5.8: ПРИЛОЖЕНИЕ 126`, "Текст подкладки");
  fixField("131", "lining", "100% Кашемир", "94% шерсть 6% шелк", `${SRC_C} §5.8: ПРИЛОЖЕНИЕ 131`, "Текст подкладки");

  // ТЗ 78: цвета по строкам (2 синих 42/46 + 1 чёрная 42) вместо единого NAVY
  {
    const rows = tzRows(78);
    if (rows.length === 1) {
      if (rows[0].color === "NAVY") setOrder(rows[0], "Цвет", "color", "NAVY ×2 (42, 46); BLACK ×1 (42)", `${SRC_B} §5.7: ТЗ 78 — синяя 42 (лот 728002), синяя 46 (728001), чёрная 42 (728011)`);
      else if (rows[0].color !== "NAVY ×2 (42, 46); BLACK ×1 (42)") pend("ТЗ 78: цвет", `В БД «${fmt(rows[0].color)}»`, "Проставить «NAVY ×2 (42, 46); BLACK ×1 (42)» вручную.", `${SRC_B} §5.7`);
    }
  }
  // ТЗ 146: цена работы 29 500 (расчёт партии 19 + счёт №257 + ТЗ)
  for (const o of tzRows(146)) {
    if (eq(o.clientWorkPricePerUnit, 28163)) setOrder(o, "Цена работы", "clientWorkPricePerUnit", D(29500), `${SRC_C} §5.1: ТЗ 146 — 29 500 (ТЗ, расчёт партии 19, счёт №257)`);
    else if (!eq(o.clientWorkPricePerUnit, 29500)) pend("ТЗ 146: цена работы", `В БД ${fmt(o.clientWorkPricePerUnit)}`, "Поставить 29 500.", SRC_C);
  }
  // ТЗ 135: дата 27.08.2026 (в БД 12.01.2026 скопирована с ТЗ 113)
  for (const o of tzRows(135)) {
    const want = iso("2026-08-27");
    if (o.workOrderDate && eq(o.workOrderDate, iso("2026-01-12"))) setOrder(o, "Дата ТЗ", "workOrderDate", want, `${SRC_C} §5.2: ТЗ 135 — 27.08.2026 (12.01.2026 скопирована с ТЗ 113)`);
    else if (!o.workOrderDate) setOrder(o, "Дата ТЗ", "workOrderDate", want, `${SRC_C} §5.2: ТЗ 135 — 27.08.2026`);
  }
  // Даты ТЗ, конкретные в документах: 117 (18.05.2026), 119–134 (25–27.08.2026). Только если в БД пусто.
  for (const tz of [117, ...Array.from({ length: 16 }, (_, i) => 119 + i)]) {
    const entry = (tzDocs.get(tz) ?? []).find(({ item }) => /^\d{2}\.\d{2}\.\d{4}$/.test(String(item.date ?? "")));
    if (!entry) continue;
    for (const o of tzRows(tz)) if (!o.workOrderDate) setOrder(o, "Дата ТЗ", "workOrderDate", dmy(entry.item.date), `${SRC_C} §5.6: ПРИЛОЖЕНИЕ ${tz} — дата ${entry.item.date}`);
  }
  // Цвет: заполняем только пустой цвет у однострочных ТЗ, если документ называет единственный цвет.
  for (const [tz] of tzDocs) {
    const rows = tzRows(tz);
    if (rows.length !== 1 || rows[0].color) continue;
    const c = docColor(tz);
    if (c) setOrder(rows[0], "Цвет", "color", c, `${tz <= 58 ? SRC_A : tz <= 112 ? SRC_B : SRC_C}: ПРИЛОЖЕНИЕ ${tz} — цвет «${c}»`);
    else if ((tzDocs.get(tz) ?? []).some(({ w }) => w.color)) {
      // версии расходятся (ТЗ 110) — в pending
      if (tz === 110) pend("ТЗ 110: цвет", "Версия «+4%» — «бежевый», базовая — «коричневый» (в xlsx партии 12 — «коричневый»).", "бежевый / коричневый", `${SRC_B} §5 п.12`);
    }
  }

  // --- ТЗ 110: 3 → 1 шт., работа 217 350 (как updateProducedQuantity в приложении)
  {
    const rows = tzRows(110);
    if (rows.length === 1) {
      const o = rows[0];
      const src = `${SRC_B} §5 п.5: ТЗ 110 — «1 изд.», 69 шкур, счёт №63 «1 ед.» 217 350`;
      if (eq(o.plannedQuantity, 3) && eq(o.producedQuantity, 3) && eq(o.clientWorkPricePerUnit, 72450)) {
        const newUnit = r2((o.totalCost ?? D(0)).div(1));
        const oldContribution = o.producedQuantity.mul(o.unitCost ?? D(0));
        const newContribution = D(1).mul(newUnit);
        const stock = await prisma.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: o.finishedWarehouseId, productModelId: o.modelId } } });
        let stockOk = true;
        if (stock) {
          const newQ = stock.quantity.sub(3).add(1);
          if (newQ.lessThan(0)) stockOk = false;
        }
        if (!stockOk) {
          pend("ТЗ 110: 3 → 1 шт.", "Остаток готовой продукции модели уйдёт в минус, правку количества не делаем.", "Скорректировать остаток вручную.", src);
        } else {
          setOrder(o, "Количество ТЗ", "plannedQuantity", D(1), src);
          setOrder(o, "Количество ТЗ", "producedQuantity", D(1), src);
          setOrder(o, "Цена работы", "clientWorkPricePerUnit", D(217350), src);
          setOrder(o, "Количество ТЗ", "unitCost", newUnit, src);
          if (stock) {
            const newQ = stock.quantity.sub(3).add(1);
            const newVal = stock.quantity.mul(stock.avgUnitCost).sub(oldContribution).add(newContribution);
            const newAvg = newQ.isZero() ? stock.avgUnitCost : r2(newVal.div(newQ));
            push({ kind: "update", cat: "Количество ТЗ", model: "FinishedGoodsStock", id: stock.id, label: `Остаток готовой продукции (модель ТЗ 110) / quantity, avgUnitCost`, source: src,
              changes: [{ field: "quantity", before: stock.quantity, after: newQ }, { field: "avgUnitCost", before: stock.avgUnitCost, after: newAvg }] });
            push({ kind: "create", cat: "Количество ТЗ", model: "FinishedGoodsMovement", id: newId(), label: `Движение ГП: корректировка ТЗ 110 (−2 шт.)`, source: src,
              data: { id: "", organizationId: orgId, warehouseId: o.finishedWarehouseId, productModelId: o.modelId, type: "ADJUSTMENT_OUT", quantity: D(2), unitCost: newUnit, totalCost: r2(newContribution.sub(oldContribution).abs()), productionOrderId: o.id, date: NOW, notes: "Корректировка фактически произведённого количества после завершения ТЗ (3 → 1, ТЗ 110; apply-drive-production-corrections)" } });
            (ops[ops.length - 1] as { data: Record<string, unknown>; id: string }).data.id = (ops[ops.length - 1] as { id: string }).id;
            // исходное движение PRODUCTION_IN (3 шт.) остаётся как есть — как и в приложении
          }
        }
      } else if (!(eq(o.plannedQuantity, 1) && eq(o.clientWorkPricePerUnit, 217350))) {
        pend("ТЗ 110: количество/цена", `В БД: ${fmt(o.plannedQuantity)} шт. по ${fmt(o.clientWorkPricePerUnit)}.`, "Привести к 1 шт. по 217 350 вручную.", src);
      }
    }
  }

  // =========================================================== ТЗ 88: разнести П-2026-0096
  await split88(batchId.get(8)!, clientIdVal, ensureModel("MGL03", "Варежки", `${SRC_B} §5.4`)!, ensureModel("MGL01", null, SRC_B)!, ensureModel("MGL02", null, SRC_B)!);

  // =========================================================== (3) новые ТЗ: 75, 97, 104, 152–168
  const seqState = (() => {
    const pfx = `П-${NOW.getFullYear()}-`;
    let max = 0;
    for (const o of orders) if (o.number.startsWith(pfx)) max = Math.max(max, Number(o.number.slice(pfx.length)) || 0);
    return { pfx, max };
  })();
  const nextNumber = () => `${seqState.pfx}${String(++seqState.max).padStart(4, "0")}`;
  // 88 уже использует номера — подвинем счётчик
  for (const o of orders) if (o.number.startsWith(seqState.pfx)) seqState.max = Math.max(seqState.max, Number(o.number.slice(seqState.pfx.length)) || 0);

  const lotIndex = () => {
    const m = new Map<string, LotRec[]>();
    for (const l of lots) {
      if (!l.lotNumber || !l.rem.greaterThan(0)) continue;
      const k = nl(l.lotNumber);
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return m;
  };

  type NewSpec = {
    tz: number; model: string; qty: number; color: string | null; size: string | null; materialDescription?: string | null;
    lining?: string | null; price: number; date: Date | null; lots: { lot: string; qty: number }[]; source: string; docTitle: string;
    liningNote?: string | null; extraPending?: string | null;
  };
  const createOrder = (s: NewSpec) => {
    if (tzRows(s.tz).length > 0) return; // уже есть (идемпотентность)
    const mid = ensureModel(s.model, null, s.source);
    if (!mid) return;
    const b = batchOfTz(s.tz);
    // --- сырьё: all-or-nothing по лотам (как в приложении), без выдумок
    const idx = lotIndex();
    const need = new Map<string, { lot: LotRec; qty: Decimal; names: string[] }>();
    const problems: string[] = [];
    for (const l of s.lots) {
      const inner = /\(([^)]+)\)/.exec(l.lot);
      const key = nl(inner ? inner[1] : l.lot);
      const cands = idx.get(key) ?? [];
      if (cands.length === 0) { problems.push(`лот ${l.lot} не найден (или нет остатка)`); continue; }
      if (cands.length > 1) { problems.push(`лот ${l.lot} неоднозначен (${cands.length} лота)`); continue; }
      const c = cands[0];
      const e = need.get(c.id) ?? { lot: c, qty: D(0), names: [] };
      e.qty = e.qty.add(l.qty);
      e.names.push(l.lot);
      need.set(c.id, e);
    }
    for (const e of need.values()) if (e.lot.rem.lessThan(e.qty)) problems.push(`лот ${e.names[0]}: нужно ${e.qty}, остаток ${e.lot.rem}`);
    const consume = problems.length === 0 && need.size > 0;
    if (problems.length) {
      pend(`ТЗ ${s.tz}: сырьё не списано`, `ТЗ создано без списаний. Причины: ${problems.join("; ")}.`, "Поступить сырью/поправить лоты, затем добавить списание в карточке ТЗ (или повторить скрипт после удаления ТЗ).", `${s.source}; ${s.docTitle}`);
    }
    if (s.extraPending) pend(`ТЗ ${s.tz}`, s.extraPending, "—", s.source);

    const id = newId();
    const number = nextNumber();
    const status = consume ? "IN_PROGRESS" : "PLANNED";
    const data: Record<string, unknown> = {
      id, organizationId: orgId, number, productModelId: mid, rawWarehouseId: warehouse.id, finishedWarehouseId: warehouse.id,
      status, plannedQuantity: D(s.qty), color: s.color, size: s.size, materialDescription: s.materialDescription ?? null,
      lining: s.lining ?? null, clientId: clientIdVal, contractNumber: CONTRACT, workOrderNumber: String(s.tz),
      workOrderDate: s.date, clientWorkPricePerUnit: D(s.price), batchId: b != null ? batchId.get(b)! : null,
      notes: `ТЗ №${s.tz}: создано по документу Drive «${s.docTitle}» (apply-drive-production-corrections).`,
    };
    push({ kind: "create", cat: "Новые ТЗ", model: "ProductionOrder", id, label: `ТЗ ${s.tz} (${number}) ${s.model} ×${s.qty}`, source: s.source, data });
    const rec: OrderRec = {
      id, number, tz: String(s.tz), modelId: mid, modelName: modelNameById.get(mid) ?? s.model, status, plannedQuantity: D(s.qty),
      producedQuantity: D(0), color: s.color, size: s.size, lining: s.lining ?? null, clientId: clientIdVal, contractNumber: CONTRACT,
      workOrderDate: s.date, clientWorkPricePerUnit: D(s.price), batchId: b != null ? batchId.get(b)! : null, materialCost: null,
      expenseCost: null, totalCost: null, unitCost: null, finishedWarehouseId: warehouse.id, usages: [], isNew: true,
    };
    orders.push(rec);
    if (consume) {
      for (const { lot, qty } of need.values()) {
        const total = r2(lot.unitCost.mul(qty));
        push({ kind: "create", cat: "Списание сырья", model: "StockMovement", id: newId(), label: `ТЗ ${s.tz}: списание лота ${lot.lotNumber} ×${qty}`, source: s.source,
          data: { id: "", organizationId: orgId, warehouseId: warehouse.id, rawMaterialId: lot.rawMaterialId, lotId: lot.id, type: "PRODUCTION_OUT", quantity: r3(qty), unitCost: lot.unitCost, totalCost: total, productionOrderId: id, date: NOW } });
        const mv = ops[ops.length - 1] as { id: string; data: Record<string, unknown> };
        mv.data.id = mv.id;
        push({ kind: "update", cat: "Списание сырья", model: "RawMaterialLot", id: lot.id, label: `Лот ${lot.lotNumber}: остаток`, source: s.source, changes: [{ field: "quantityRemaining", before: lot.rem, after: lot.rem.sub(qty) }] });
        lot.rem = lot.rem.sub(qty);
        const uid = newId();
        push({ kind: "create", cat: "Списание сырья", model: "ProductionMaterialUsage", id: uid, label: `ТЗ ${s.tz}: расход ${lot.matName} лот ${lot.lotNumber} ×${qty} по ${lot.unitCost}`, source: s.source,
          data: { id: uid, productionOrderId: id, rawMaterialId: lot.rawMaterialId, lotId: lot.id, quantity: r3(qty), unitCost: lot.unitCost, totalCost: total, date: NOW, commission4: true } });
        rec.usages.push({ id: uid, rawMaterialId: lot.rawMaterialId, lotId: lot.id, quantity: qty, unitCost: lot.unitCost, totalCost: total, commission4: true, unit: lot.unit, matName: lot.matName, lotNumber: lot.lotNumber, date: NOW });
      }
    }
    if (s.liningNote) pend(`ТЗ ${s.tz}: подкладка не списана`, s.liningNote, "Списывать подкладку или нет — политика владельца (у ТЗ 119–151 подкладка тоже не списана).", s.source);
  };

  // --- 75, 97, 104: без сырья по документам
  createOrder({
    tz: 75, model: "MH07", qty: 4, color: "коричневый", size: "58", materialDescription: "ободок из лоскута соболя", lining: "100% кашемир",
    price: 8641, date: null, lots: [], source: `${SRC_B} §5 п.1: ТЗ 75 (оба файла), xlsx партии 7 строка «МН07… 4… 8641… 34564», счёт №1`,
    docTitle: "ПРИЛОЖЕНИЕ 75 (MH07 соболь повязка).docx",
    extraPending: "Сырья от заказчика нет (лоскут, файл «тут нет продажи 4%») — ТЗ создано без списаний, статус PLANNED (приложение не даёт завершить ТЗ без списаний; изделие по документам изготовлено и оплачено в партии 7).",
  });
  createOrder({
    tz: 97, model: "МН17", qty: 9, color: "черный", size: "62 61 60 59 59 59 58 58 57", materialDescription: "бобр черный стриженый", lining: "кашемир",
    price: 16980, date: null, lots: [], source: `${SRC_B} §5 п.2: ТЗ 97 (обе версии), xlsx 10 строка 1, счёт №41, письмо 19.02.2026`,
    docTitle: "ПРИЛОЖЕНИЕ 97 (МН17 бобр + ткань).docx",
    extraPending: "16 980 за изделие включает бобра и пошив (письмо 19.02.2026) — лотов сырья нет, ТЗ создано без списаний (PLANNED).",
  });
  createOrder({
    tz: 104, model: "МН17", qty: 1, color: "черный", size: "61", materialDescription: "бобр черный стриженый", lining: "кашемир",
    price: 16980, date: null, lots: [], source: `${SRC_B} §5 п.3: ТЗ 104, xlsx 11 строка 4, счёт №51`,
    docTitle: "ПРИЛОЖЕНИЕ 104 (МН17 бобр + ткань).docx",
    extraPending: "Бобр в цене 16 980 — лотов сырья нет, ТЗ создано без списаний (PLANNED).",
  });

  // --- 152–168 из ТЗ-приложений 2026
  for (let tz = 152; tz <= 168; tz++) {
    const cand = (tzDocs.get(tz) ?? []).find(({ item }) => /ТЗ-приложение/i.test(item.docType ?? "") && !isDraft(item));
    if (!cand) { pend(`ТЗ ${tz}`, "ТЗ-приложение в выгрузке не найдено.", "Завести ТЗ вручную.", SRC_C); continue; }
    const { item, w } = cand;
    let size: string | null = w.sizes ?? null;
    if (size && /^\d+(,\d+)+$/.test(size)) size = size.split(",").join(" "); // формат ТЗ 119–151: через пробел
    const lot: { lot: string; qty: number }[] = (w.rawMaterials ?? []).map((r: Json) => ({ lot: String(r.lot), qty: Number(r.qty) }));
    const lin = w.lining?.fabric;
    createOrder({
      tz, model: String(w.model), qty: Number(w.quantity), color: w.color ?? null, size, materialDescription: w.item ?? null,
      lining: w.lining?.composition && w.lining.composition !== "-" ? String(w.lining.composition) : null,
      price: Number(w.workPricePerUnit), date: item.date ? dmy(String(item.date)) : null, lots: lot,
      source: `${SRC_C} §5/§7: «${item.title}» (ТЗ ${tz}, партия ${batchOfTz(tz)})`, docTitle: String(item.title),
      liningNote: lin ? `Подкладка по ТЗ: ${lin.name}, ${lin.meters} м (по ${lin.priceExVat} без НДС, итого ${lin.totalInclVat} с НДС) — не списана.` : null,
      extraPending: w.contractor_skins_per_unit ? `Сырьё подрядчика ${w.contractor_skins_per_unit} ₽/ед × ${w.quantity} (шкуры, лотов нет) — не списано; у ТЗ 121 оно заведено лотом «лиса».` : null,
    });
  }

  // =========================================================== (4) комиссия 4%
  const setComm = (o: OrderRec, u: Usage, v: boolean, src: string) => {
    if (u.commission4 === v) return;
    push({ kind: "update", cat: "Комиссия 4%", model: "ProductionMaterialUsage", id: u.id, label: `${orderLabel(o)} / ${u.matName}${u.lotNumber ? " лот " + u.lotNumber : ""} / commission4`, source: src, changes: [{ field: "commission4", before: u.commission4, after: v }] });
    u.commission4 = v;
  };
  for (const o of orders) {
    const tz = o.tz ? Number(o.tz) : NaN;
    if (Number.isNaN(tz)) continue;
    // партия 6: версий «+4%» нет, НДС 20% — комиссия не применяется
    if (tz >= 59 && tz <= 69) for (const u of o.usages) setComm(o, u, false, `${SRC_B} §2: партия 6 — версии «+4%» нет`);
    // свакара фиксированной ценой 13 250/13 470 (продаёт Веллмех): без наценки на шкуры, на подкладку — да
    if ([55, 56, 57, 58, 61, 79, 90].includes(tz)) {
      const src = tz <= 58 ? `${SRC_A} §4: ТЗ 55–58 — «4% только на подкладку, свакара по 13 250 без наценки»` : `${SRC_B} §2: ТЗ 61/79/90 — шкуры фондю продаёт Веллмех, 4% на шкуры нет`;
      for (const u of o.usages) if (u.unit === "PIECE") setComm(o, u, false, src);
    }
  }
  pend("Комиссия 4% у ТЗ 113+", "Подтверждено документом (цена ТЗ = база × 1,04 ровно): лоты 2026 (Сага 03-26, РП0426.x, СП0526.x) — ТЗ 122, 128, 130, 136, 139, 142, 144, 147, 151 → commission4 = true (так и стоит по умолчанию, не меняем). У более старых лотов (15022, 1301, 500748, 518505/09, 513010, 613003, 514038, 160045, 15316, 1330/1316/33/31/1351 и др.) цена ТЗ = база × 1,0573 (4% + ~1,66%, природа не подтверждена).", "Оставить commission4 = true (по умолчанию) или решить, как учитывать +1,66%.", `${SRC_C} §4`);
  pend("Комиссия 4%: не подтверждено документами", "ТЗ 121/158 (М029, сырьё подрядчика «лиса» по 16 000), ТЗ 117 (кейп), ТЗ 49–54 (партия 5, кроме свакары по 13 250), ТЗ 19–23 (УПД МФВМ) — commission4 оставлен по умолчанию (true). Баз. unitCost/totalCost списаний не менялись.", "Подтвердить построчно.", `${SRC_A} §4; ${SRC_C} §4`);

  // =========================================================== подкладка у существующих ТЗ → pending (остаток пулов = 0)
  {
    const linPools = lots.filter((l) => l.unit === "M");
    const left = (n: string) => linPools.filter((l) => nl(l.matName).includes(nl(n))).reduce((s, l) => s.add(l.rem), D(0));
    const items: [number, string][] = [
      [23, "№24, 1,6 м × 2 140 = 3 424"], [35, "№41, 8,8 м = 18 832"], [80, "№2, 8,4 м = 17 976"],
      [81, "5 м = 10 700"], [82, "3,6 м = 7 704"], [84, "1,8 м = 3 852"], [85, "2,5 м = 5 350"],
    ];
    const lines: string[] = [];
    for (const [tz, txt] of items) {
      const lin = (tzDocs.get(tz) ?? []).map(({ w }) => w.lining).find(Boolean);
      lines.push(`ТЗ ${tz}: ${txt}${lin ? ` (в JSON: ${JSON.stringify(lin)})` : ""}`);
    }
    const stock = linPools.map((l) => `${l.matName}: ${l.rem} м`).join("; ");
    pend("Подкладка у ТЗ 23, 35, 80–82, 84, 85 не списана", `Документы подтверждают расход (${lines.join(" | ")}). Но остаток всех подкладочных тканей на складе = 0 (${stock}) — consumeFromLot выбросил бы «Недостаточно сырья», выдумывать приход нельзя.`, "А) оприходовать подкладку (закупка/корректировка) и затем добавить списания в карточках ТЗ; Б) оставить как есть.", `${SRC_A} §6 (ТЗ 23, 35); ${SRC_B} §5 п.9 (ТЗ 80–85)`);
    void left;
  }

  // =========================================================== (5) оплаты
  await plannedPayments(clientIdVal);

  // =========================================================== (7) документы
  await plannedDocuments(clientIdVal, batchId);

  // =========================================================== pending: прочее
  staticPending();
}

// ---------------------------------------------------------------- ТЗ 88
async function split88(batch8: string, clientIdVal: string, mgl03: string, mgl01: string, mgl02: string) {
  const src = `${SRC_B} §5 п.4 + §2: ТЗ 88 (оба файла), xlsx 8 строки 5–8; арифметика «стоимость продукции за ед.» сходится до копейки`;
  const existing88 = orders.filter((o) => o.tz === "88");
  if (existing88.length > 0) return; // уже сделано
  const o96 = orders.find((o) => o.number === "П-2026-0096" && !o.tz);
  if (!o96) return;
  const find = (lot: string, q: number) => o96.usages.find((u) => u.lotNumber && nl(u.lotNumber).startsWith(nl(lot)) && eq(u.quantity, q));
  const u4016 = find("4016", 16), u5017 = find("5017", 16), u514 = find("514038", 8), u505 = find("505055", 10);
  if (o96.usages.length !== 4 || !u4016 || !u5017 || !u514 || !u505 || o96.status !== "COMPLETED") {
    pend("ТЗ 88: разнос П-2026-0096 не сделан", "Состав списаний П-2026-0096 отличается от ожидаемого (4016×16, 5017×16, 514038×8, 505055×10).", "Разнести вручную на 4 позиции: MGL01 ×8 (4016×16 + 5017×8), MGL03 ×8 (5017×8), MGL02 браун ×8 (514038×8), MGL02 пастель ×10 (505055×10).", src);
    return;
  }
  const mvs = await prisma.stockMovement.findMany({ where: { productionOrderId: o96.id, type: "PRODUCTION_OUT" } });
  const mvOf = (u: Usage) => mvs.find((m) => m.lotId === u.lotId && m.quantity.eq(u.quantity));
  const m4016 = mvOf(u4016), m5017 = mvOf(u5017), m514 = mvOf(u514);
  if (!m4016 || !m5017 || !m514) {
    pend("ТЗ 88: разнос П-2026-0096 не сделан", "Не нашлись движения склада PRODUCTION_OUT под списания.", "Разнести вручную.", src);
    return;
  }
  const pfx = `П-${NOW.getFullYear()}-`;
  let max = 0;
  for (const o of orders) if (o.number.startsWith(pfx)) max = Math.max(max, Number(o.number.slice(pfx.length)) || 0);
  const next = () => `${pfx}${String(++max).padStart(4, "0")}`;
  const contract = CONTRACT;

  // П-2026-0096 → ТЗ 88, позиция MGL02 пастель ×10
  setOrder(o96, "ТЗ 88", "workOrderNumber" as never, "88", src, `П-2026-0096 (ТЗ 88)`);
  o96.tz = "88";
  setOrder(o96, "ТЗ 88", "size", "6 6 6 6 7 7 7 7 8 8", `${src}: MGL02 пастель — размеры 6/7/8 = 4/4/2`, `ТЗ 88 (${o96.number})`);
  if (!o96.color) setOrder(o96, "ТЗ 88", "color", "пастель", src, `ТЗ 88 (${o96.number})`);
  if (!o96.batchId) setOrder(o96, "Партия ТЗ", "batchId", batch8, `${SRC_B}: ТЗ 88 → партия 8`, `ТЗ 88 (${o96.number})`);
  if (!o96.clientId) setOrder(o96, "Заказчик/договор", "clientId", clientIdVal, src, `ТЗ 88 (${o96.number})`);
  if (!o96.contractNumber) setOrder(o96, "Заказчик/договор", "contractNumber", contract, src, `ТЗ 88 (${o96.number})`);

  const mk = (model: string, modelName: string, qty: number, price: number, color: string | null, note: string): OrderRec => {
    const id = newId();
    const number = next();
    const data = {
      id, organizationId: orgId, number, productModelId: model, rawWarehouseId: o96.finishedWarehouseId, finishedWarehouseId: o96.finishedWarehouseId,
      status: "IN_PROGRESS", plannedQuantity: D(qty), color, size: "6 6 6 7 7 7 8 8", clientId: clientIdVal, contractNumber: contract,
      workOrderNumber: "88", clientWorkPricePerUnit: D(price), batchId: batch8,
      notes: `ТЗ №88, позиция ${note}: выделено из П-2026-0096 (apply-drive-production-corrections).`,
    };
    push({ kind: "create", cat: "ТЗ 88", model: "ProductionOrder", id, label: `ТЗ 88 (${number}) ${modelName} ×${qty} — ${note}`, source: src, data });
    const rec: OrderRec = {
      id, number, tz: "88", modelId: model, modelName, status: "IN_PROGRESS", plannedQuantity: D(qty), producedQuantity: D(0), color,
      size: "6 6 6 7 7 7 8 8", lining: null, clientId: clientIdVal, contractNumber: contract, workOrderDate: null,
      clientWorkPricePerUnit: D(price), batchId: batch8, materialCost: null, expenseCost: null, totalCost: null, unitCost: null,
      finishedWarehouseId: o96.finishedWarehouseId, usages: [], isNew: true,
    };
    orders.push(rec);
    return rec;
  };
  const oMGL01 = mk(mgl01, "MGL01", 8, 7320, null, "MGL01 ×8 (работа 7 320)");
  const oMGL03 = mk(mgl03, "MGL03", 8, 6610, null, "MGL03 ×8 (работа 6 610)");
  const oBrown = mk(mgl02, "MGL02", 8, 6100, "браун", "MGL02 браун ×8 (работа 6 100)");

  const moveUsage = (u: Usage, to: OrderRec, mv: { id: string }, label: string) => {
    push({ kind: "update", cat: "ТЗ 88", model: "ProductionMaterialUsage", id: u.id, changes: [{ field: "productionOrderId", before: o96.id, after: to.id }], label, source: src });
    push({ kind: "update", cat: "ТЗ 88", model: "StockMovement", id: mv.id, changes: [{ field: "productionOrderId", before: o96.id, after: to.id }], label: label + " (движение склада)", source: src });
    o96.usages = o96.usages.filter((x) => x.id !== u.id);
    to.usages.push(u);
  };
  moveUsage(u4016, oMGL01, m4016, `Расход лот 4016 ×16: ${o96.number} → ТЗ 88 MGL01`);
  moveUsage(u514, oBrown, m514, `Расход лот 514038 ×8: ${o96.number} → ТЗ 88 MGL02 браун`);
  // лот 5017 ×16 → по 8 на MGL01 и MGL03
  {
    const half = r3(u5017.quantity.div(2));
    const halfCost = r2(u5017.totalCost.div(2));
    push({ kind: "update", cat: "ТЗ 88", model: "ProductionMaterialUsage", id: u5017.id, label: `Расход лот 5017 ×16 → ×8, ${o96.number} → ТЗ 88 MGL01`, source: src,
      changes: [{ field: "productionOrderId", before: o96.id, after: oMGL01.id }, { field: "quantity", before: u5017.quantity, after: half }, { field: "totalCost", before: u5017.totalCost, after: halfCost }] });
    push({ kind: "update", cat: "ТЗ 88", model: "StockMovement", id: m5017.id, label: `Движение склада лот 5017 ×16 → ×8, → ТЗ 88 MGL01`, source: src,
      changes: [{ field: "productionOrderId", before: o96.id, after: oMGL01.id }, { field: "quantity", before: m5017.quantity, after: half }, { field: "totalCost", before: m5017.totalCost, after: halfCost }] });
    const uid = newId();
    push({ kind: "create", cat: "ТЗ 88", model: "ProductionMaterialUsage", id: uid, label: `Расход лот 5017 ×8 → ТЗ 88 MGL03`, source: src,
      data: { id: uid, productionOrderId: oMGL03.id, rawMaterialId: u5017.rawMaterialId, lotId: u5017.lotId, quantity: half, unitCost: u5017.unitCost, totalCost: halfCost, date: u5017.date, commission4: u5017.commission4 } });
    const mid = newId();
    push({ kind: "create", cat: "ТЗ 88", model: "StockMovement", id: mid, label: `Движение склада лот 5017 ×8 → ТЗ 88 MGL03`, source: src,
      data: { id: mid, organizationId: orgId, warehouseId: m5017.warehouseId, rawMaterialId: m5017.rawMaterialId, lotId: m5017.lotId, type: "PRODUCTION_OUT", quantity: half, unitCost: m5017.unitCost, totalCost: halfCost, productionOrderId: oMGL03.id, date: m5017.date } });
    o96.usages = o96.usages.filter((x) => x.id !== u5017.id);
    oMGL01.usages.push({ ...u5017, quantity: half, totalCost: halfCost });
    oMGL03.usages.push({ ...u5017, id: uid, quantity: half, totalCost: halfCost });
  }
  // снимок стоимости П-2026-0096 (COMPLETED) — как syncCompletedOrderCost
  {
    const mat = o96.usages.reduce((s, u) => s.add(u.totalCost), D(0));
    const exp = o96.expenseCost ?? D(0);
    const total = mat.add(exp);
    const unit = r2(total.div(o96.producedQuantity));
    const delta = total.sub(o96.totalCost ?? D(0));
    const lab = `ТЗ 88 (${o96.number})`;
    setOrder(o96, "ТЗ 88", "materialCost", mat, `${src}: пересчёт после разноса`, lab);
    setOrder(o96, "ТЗ 88", "totalCost", total, `${src}: пересчёт после разноса`, lab);
    setOrder(o96, "ТЗ 88", "unitCost", unit, `${src}: пересчёт после разноса`, lab);
    if (!delta.isZero()) {
      const stock = await prisma.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: o96.finishedWarehouseId, productModelId: o96.modelId } } });
      if (stock) {
        const newVal = stock.quantity.mul(stock.avgUnitCost).add(delta);
        const newAvg = stock.quantity.isZero() ? stock.avgUnitCost : r2(newVal.div(stock.quantity));
        push({ kind: "update", cat: "ТЗ 88", model: "FinishedGoodsStock", id: stock.id, label: `Остаток готовой продукции MGL02 / avgUnitCost`, source: src, changes: [{ field: "avgUnitCost", before: stock.avgUnitCost, after: newAvg }] });
        const id = newId();
        push({ kind: "create", cat: "ТЗ 88", model: "FinishedGoodsMovement", id, label: `Движение ГП: корректировка себестоимости ${o96.number}`, source: src,
          data: { id, organizationId: orgId, warehouseId: o96.finishedWarehouseId, productModelId: o96.modelId, type: delta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: D(0), unitCost: r2(delta.abs().div(o96.producedQuantity)), totalCost: r2(delta.abs()), productionOrderId: o96.id, date: NOW, notes: "Корректировка себестоимости после разноса ТЗ 88 по позициям (apply-drive-production-corrections)" } });
      }
    }
  }
  pend("ТЗ 88: позиции MGL01/MGL03/MGL02 браун — статус", "Три выделенные позиции созданы со списаниями (расход перенесён из П-2026-0096, стоимость П-2026-0096 пересчитана, остаток MGL02 скорректирован). Статус IN_PROGRESS, выпуск не оприходован: по документам варежки отгружены в партии 8, но даты прихода нет.", "Завершить ТЗ в карточке (оприходует 8+8+8 шт. по дате завершения).", src);
  pend("ТЗ 88: цена работы позиций", "В ТЗ-документе цена работы не указана; 7 320 / 6 610 / 6 100 взяты из xlsx партии 8 (строки 5–8) по отчёту prod2025b.", "Подтвердить по расчёту партии 8 (счёта по партии 8 в Drive нет).", src);
}

// ---------------------------------------------------------------- оплаты
type PayPlan = { key: string; amount: string; paidAt: string; type: "ADVANCE" | "PARTIAL"; docRef: string; tzFrom?: number; tzTo?: number; batch?: number; notes: string; source: string };
const PAYMENTS: PayPlan[] = [
  { key: "110", amount: "21627900", paidAt: "2025-08-04", type: "ADVANCE", docRef: "Счёт №110 от 21.07.2025", notes: "Аванс 70% за пошив (все ТЗ предварительного расчёта 190725/130825). Оплачен 04.08.2025 по письму 26.08.2025; баланс 040226: «авг. 2025».", source: `${SRC_A} §5 + баланс 040226` },
  { key: "147", amount: "1866490", paidAt: "2025-10-02", type: "PARTIAL", docRef: "Счёт №147 от 22.09.2025", tzFrom: 1, tzTo: 18, batch: 1, notes: "Доплата за пошив, партия 1 (41 ед.). Дата оплаты — баланс 040226.", source: `${SRC_A} §5 + ${SRC_B}: баланс 040226` },
  { key: "170", amount: "1208570", paidAt: "2025-10-15", type: "PARTIAL", docRef: "Счёт №170 от 30.09.2025", tzFrom: 19, tzTo: 23, batch: 2, notes: "Доплата за пошив, партия 2 (23 ед.). Дата оплаты — баланс 040226.", source: `${SRC_A} §5 + баланс 040226` },
  { key: "181", amount: "2081360", paidAt: "2025-10-22", type: "PARTIAL", docRef: "Счёт №181 от 17.10.2025", tzFrom: 24, tzTo: 36, batch: 3, notes: "Доплата за пошив, партия 3 (34 ед.). Дата оплаты — баланс 040226.", source: `${SRC_A} §5 + баланс 040226` },
  { key: "203", amount: "1759800", paidAt: "2025-11-20", type: "PARTIAL", docRef: "Счёт №203 от 14.11.2025", tzFrom: 37, tzTo: 48, batch: 4, notes: "Доплата за пошив, партия 4 (30 ед.). Дата оплаты — баланс 040226.", source: `${SRC_A} §5 + баланс 040226` },
  { key: "209", amount: "1766870", paidAt: "2025-11-27", type: "ADVANCE", docRef: "Счёт №209 от 19.11.2025", notes: "Аванс 70% за пошив аксессуаров (70% × 2 524 100). Согласован 25.11.2025, оплата 27.11.2025 — баланс 040226.", source: `${SRC_A} §5 + баланс 040226` },
  { key: "235", amount: "5669120", paidAt: "2025-12-22", type: "PARTIAL", docRef: "Счёт №235 от 04.12.2025", tzFrom: 49, tzTo: 58, batch: 5, notes: "Доплата за пошив, партия 5 (25 ед.) + шкуры свакары подрядчика 4 584 500. Дата оплаты — баланс 040226.", source: `${SRC_A} §5 + баланс 040226` },
  { key: "239", amount: "946870", paidAt: "2025-12-26", type: "PARTIAL", docRef: "Счёт №239 от 18.12.2025", tzFrom: 59, tzTo: 69, batch: 6, notes: "Доплата за пошив, партия 6 (37 ед.). «Оплачено» 26.12.2025 — баланс 040226.", source: `${SRC_B} §3 + баланс 040226` },
  { key: "1", amount: "2075122.54", paidAt: "2026-01-21", type: "PARTIAL", docRef: "Счёт №1 от 15.01.2026", tzFrom: 70, tzTo: 83, batch: 7, notes: "Доплата за пошив, партия 7 (50 ед.). «Оплачено» 21.01.2026 — баланс 040226. (Письмо: 2 081 387,54 — расходится со счётом.)", source: `${SRC_B} §3 + баланс 040226` },
  { key: "141", amount: "11860870", paidAt: "2026-07-06", type: "ADVANCE", docRef: "Счёт №141 от 15.05.2026", notes: "Аванс 70% за 82 изделия «в работе» (первая часть). Согласован 03.07, оплачен 06.07.2026.", source: `${SRC_C} §6` },
  { key: "143", amount: "3230780", paidAt: "2026-07-06", type: "ADVANCE", docRef: "Счёт №143 от 15.05.2026", notes: "Аванс 70% за пошив аксессуаров (70% × 4 615 400, 245 шт.). Согласован 03.07, оплачен 06.07.2026.", source: `${SRC_C} §6` },
];
const paymentIdByKey = new Map<string, string>();
const paymentBatchByKey = new Map<string, number>();

async function plannedPayments(clientIdVal: string) {
  const existing = await prisma.productionPayment.findMany({ where: { organizationId: orgId } });
  for (const p of PAYMENTS) {
    const ex = existing.find((e) => e.docRef === p.docRef || (e.amount.eq(p.amount) && e.paidAt.getTime() === iso(p.paidAt).getTime()));
    if (ex) { paymentIdByKey.set(p.key, ex.id); if (p.batch) paymentBatchByKey.set(p.key, p.batch); continue; }
    const id = newId();
    paymentIdByKey.set(p.key, id);
    if (p.batch) paymentBatchByKey.set(p.key, p.batch);
    push({ kind: "create", cat: "Оплаты", model: "ProductionPayment", id, label: `Оплата ${p.docRef}: ${p.amount} ₽ от ${p.paidAt} (${p.type})`, source: p.source,
      data: { id, organizationId: orgId, clientId: clientIdVal, amount: D(p.amount), paymentType: p.type, method: "BANK_TRANSFER", status: "COMPLETED", paidAt: iso(p.paidAt), notes: p.notes, docRef: p.docRef, confirmed: true } });
    if (p.tzFrom != null && p.tzTo != null) {
      const rows = orders.filter((o) => o.tz && Number(o.tz) >= p.tzFrom! && Number(o.tz) <= p.tzTo!);
      for (const o of rows) {
        const lid = newId();
        push({ kind: "create", cat: "Оплаты", model: "ProductionPaymentOrder", id: lid, label: `Оплата ${p.docRef} → ${orderLabel(o)}`, source: p.source, data: { id: lid, productionPaymentId: id, productionOrderId: o.id } });
      }
    }
  }
  // контроль сальдо баланса 04.02.2026: отгрузки 39 429 329,93 − оплаты 39 002 102,54 = 427 227,39 (партия 9, счёт №7)
  const upTo = PAYMENTS.filter((p) => p.paidAt <= "2026-02-04").reduce((s, p) => s.add(p.amount), D(0));
  const saldo = D("39429329.93").sub(upTo);
  console.log(`\nКонтроль сальдо на 04.02.2026: оплаты в плане ${upTo.toFixed(2)}; отгрузки по балансу 39 429 329,93; сальдо ${saldo.toFixed(2)} (ожидается 427 227,39) — ${saldo.eq("427227.39") ? "СХОДИТСЯ" : "НЕ СХОДИТСЯ"}`);
  if (!saldo.eq("427227.39")) throw new Error("Сальдо партии 9 не сходится с балансом 04.02.2026 — проверьте PAYMENTS");
}

// ---------------------------------------------------------------- документы Drive
const BASE = "мех/Производство меховых изделий — копия/";
async function plannedDocuments(clientIdVal: string, batchId: Map<number, string>) {
  const manifest: Json[] = JSON.parse(readFileSync(join(INV, "drive-manifest.json"), "utf-8"));
  const files = manifest.filter((f) => String(f.path ?? "").startsWith(BASE.slice(0, -1)) && !String(f.mimeType).includes("folder"));
  const existing = await prisma.driveDocument.findMany({ where: { organizationId: orgId }, select: { driveFileId: true, productionOrderId: true, productionBatchId: true, productionPaymentId: true, clientId: true } });
  const have = new Set<string>();
  for (const e of existing) {
    for (const t of [["o", e.productionOrderId], ["b", e.productionBatchId], ["p", e.productionPaymentId], ["c", e.clientId]] as const) if (t[1]) have.add(`${e.driveFileId}|${t[0]}:${t[1]}`);
  }
  const seen = new Set<string>();
  const stats: Record<string, number> = {};
  const MON = Object.keys(MONTHS).join("|");
  const parseDate = (title: string): Date | null => {
    let m = new RegExp(`от\\s+(\\d{1,2})\\s+(${MON})\\s+(\\d{4})`, "i").exec(title);
    if (m) return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()] - 1, +m[1]));
    m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(title);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return null;
  };
  for (const f of files) {
    const title: string = f.title;
    if (title.startsWith("~$")) continue; // lock-файлы Excel
    const j = jsonById.get(f.id);
    if (j && (/дубл/i.test(String(j.docType ?? "")) || j.duplicateOf)) continue;
    const rel = String(f.path).slice(BASE.length) || title;
    const sz = f.size != null ? Number(f.size) : null;
    const nTitle = title.toLowerCase().replace(/\s*\(\d+\)\s*(?=\.[a-z]+$)/, "").replace(/^копия\s+/, "").replace(/\s+/g, " ");

    // --- тип
    let docType: string = "OTHER";
    if (/^ПРИЛОЖЕНИЕ/i.test(title)) docType = "TZ_APPENDIX";
    else if (rel.includes("договоры/") && !/image|\.jpe?g$/i.test(title)) docType = "CONTRACT";
    else if (/^УПД|МФВМ/i.test(title)) docType = "UPD";
    else if (/^Сч[её]т/i.test(title)) docType = "PAYMENT_INVOICE";
    else if (/баланс/i.test(title)) docType = "BALANCE";
    else if (/расч[её]т/i.test(title)) docType = "CALC_SHEET";
    else if (/ЖГУ|МГУ/.test(title)) docType = "SPECIFICATION";
    else if (/\.msg$/i.test(title)) docType = "APPROVAL_EMAIL";

    // --- цели привязки
    const targets: { k: "o" | "b" | "p" | "c"; id: string; label: string }[] = [];
    const folderBatchM = /поставка\s*(\d+)/i.exec(rel);
    let batchNo: number | null = folderBatchM ? +folderBatchM[1] : null;
    if (batchNo == null && j && Number.isInteger(j.batch)) batchNo = j.batch;
    let tzNo: number | null = null;
    if (docType === "TZ_APPENDIX") {
      const fromJson = (j?.workOrders ?? []).map((w: Json) => w.tzNumber).filter((x: unknown) => typeof x === "number");
      tzNo = fromJson.length ? fromJson[0] : (/ПРИЛОЖЕНИЕ\s*(\d+)/i.exec(title) ? +(/ПРИЛОЖЕНИЕ\s*(\d+)/i.exec(title)![1]) : null);
      if (tzNo == null) { docType = "OTHER"; }
    }
    const invNo = /Сч[её]т(?:\s+на\s+оплату)?\s*(?:№\s*)?(\d+)/i.exec(title)?.[1] ?? null;
    const addBatch = (n: number | null) => { if (n != null && batchId.has(n)) targets.push({ k: "b", id: batchId.get(n)!, label: `партия ${n}` }); };
    const addPay = (key: string) => { const id = paymentIdByKey.get(key); if (id) targets.push({ k: "p", id, label: `оплата ${key}` }); };

    if (docType === "TZ_APPENDIX" && tzNo != null) {
      const rows = tzRows(tzNo);
      if (rows.length) for (const o of rows) targets.push({ k: "o", id: o.id, label: orderLabel(o) });
      else addBatch(batchOfTz(tzNo));
    } else {
      const mf = /МФВМ[_\s]*0*(\d+)/i.exec(title);
      if (mf && +mf[1] >= 19 && +mf[1] <= 23) {
        addBatch(2);
        for (const o of tzRows(+mf[1])) targets.push({ k: "o", id: o.id, label: orderLabel(o) });
      } else if (/УПД/i.test(title) && /№\s*170/.test(title)) addBatch(1);
      else if (/УПД/i.test(title) && /№\s*171/.test(title)) addBatch(2);
      else addBatch(batchNo);
      if (docType === "PAYMENT_INVOICE" && invNo && paymentIdByKey.has(invNo)) addPay(invNo);
      else if (rel.startsWith("2025/предоплата за пошив 70")) addPay("110");
      else if (rel.startsWith("2025/аксессуары/") && (docType === "APPROVAL_EMAIL")) addPay("209");
      else if (rel.startsWith("2026/оплаты/первая часть") || rel.startsWith("2026/поставки/аксессуары")) { if (docType !== "PAYMENT_INVOICE") { addPay("141"); addPay("143"); } }
      else if (batchNo != null && ["CALC_SHEET", "APPROVAL_EMAIL"].includes(docType)) {
        for (const [key, b] of paymentBatchByKey) if (b === batchNo) addPay(key);
      }
    }
    if (targets.length === 0 || docType === "CONTRACT" || docType === "BALANCE") {
      if (!targets.length || docType === "CONTRACT" || docType === "BALANCE") targets.push({ k: "c", id: clientIdVal, label: "заказчик" });
    }
    const docDate = parseDate(title);
    const docNumber = docType === "TZ_APPENDIX" ? String(tzNo) : invNo ?? (/МФВМ[_\s]*(\d+)/i.exec(title) ? "МФВМ/" + /МФВМ[_\s]*0*(\d+)/i.exec(title)![1] : /УПД[^№]*№\s*(\d+)/i.exec(title)?.[1] ?? null);
    const notes = j && isDraft(j) ? "Черновик ТЗ без итогов (корень папки «поставки»)" : (j?.docType && docType === "TZ_APPENDIX" && /верси/i.test(String(j.docType)) ? String(j.docType).replace(/^.*?верси[яи]:?\s*/i, "версия: ") : null);

    for (const t of targets) {
      const key = `${nTitle}|${sz}|${t.k}:${t.id}`;
      if (seen.has(key)) continue; // дубль файла (копия в другой папке) на ту же сущность
      seen.add(key);
      if (have.has(`${f.id}|${t.k}:${t.id}`)) continue;
      const id = newId();
      const data: Record<string, unknown> = {
        id, organizationId: orgId, driveFileId: f.id, title, docType, mimeType: f.mimeType ?? null, sizeBytes: sz != null && sz < 2_147_483_647 ? sz : null,
        drivePath: f.path, viewUrl: f.viewUrl ?? null, docDate, docNumber, year: docDate ? docDate.getUTCFullYear() : null, notes,
      };
      if (t.k === "o") data.productionOrderId = t.id;
      if (t.k === "b") data.productionBatchId = t.id;
      if (t.k === "p") data.productionPaymentId = t.id;
      if (t.k === "c") data.clientId = t.id;
      push({ kind: "create", cat: "Документы", model: "DriveDocument", id, label: `[${docType}] «${title}» → ${t.label}`, source: `drive-manifest: ${rel}`, data });
      stats[`${docType} → ${t.k === "o" ? "ТЗ" : t.k === "b" ? "партия" : t.k === "p" ? "оплата" : "заказчик"}`] = (stats[`${docType} → ${t.k === "o" ? "ТЗ" : t.k === "b" ? "партия" : t.k === "p" ? "оплата" : "заказчик"}`] ?? 0) + 1;
    }
  }
  console.log("\nДокументы Drive к созданию (по типу → куда):");
  for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
  pend("Документы Drive: не прикреплены к ТЗ/платежам", "Файлы без однозначной привязки (общие договоры, каталоги, планы, рысь, капсула CR01, ЖГУ/МГУ, счета №193/247/251/259/261/145/121/207/237/257/265/275 без заведённой оплаты) привязаны к заказчику «Меркури Мода» или к партии по папке. Счёт №209 и письма — к оплате.", "При необходимости перепривязать в карточках.", "drive-manifest.json");
  pend("Документы Drive: дубли и lock-файлы пропущены", "Пропущены: ~$-файлы Excel; файлы, помеченные в отчётах как ДУБЛЬ; копии одного файла (название+размер) в другой папке на ту же сущность. Не прочитаны отчётами: МФВМ000028/029 (.xls), WhatsApp/jpg.", "—", `${SRC_A} §9; ${SRC_B} §8; ${SRC_C} §11`);
}

// ---------------------------------------------------------------- прочее в pending
function staticPending() {
  pend("workOrderDate ТЗ 1–112, 113–115, 118: шаблонные даты", "В ТЗ 1–96 в шапке стоит 16.05.2025 (дата договора, не дата ТЗ); в ТЗ 97–115 везде «12.01.2026» (в ТЗ 135 в базе эта дата оказалась скопированной с ТЗ 113 — ошибочно); ТЗ 118 — 17.03.2026 при счёте и поставке в июле (подозрительно, вероятно 17.06).", "Не ставить даты (оставлено пустым) / принять 12.01.2026 для 97–115 / принять 17.06.2026 для 118.", `${SRC_A} §7; ${SRC_B} §5 п.10; ${SRC_C} §5.6`);
  pend("Аванс 21 627 900 vs 22 553 100 (+925 200)", "По «Расчет по оплатам.xlsx» «Оплачено аванс 04.08.25» по партиям 1–8 = 22 553 100 (1–5: 18 557 000; 6–8: 3 996 100), по счёту №110 и письму оплачено 21 627 900. Разнесение по ТЗ велось от баз первоначальных ТЗ (М012 93 000 вместо 83 000, М019 120 000 вместо 110 000). Аванс заведён как ADVANCE на заказчика без привязки к ТЗ.", "Привязать аванс к ТЗ партий 1–8 и решить, на какие ТЗ/партии отнести лишние 925 200.", `${SRC_A} §5, §7`);
  pend("Оплаты без подтверждённой даты фактической оплаты (не заведены)", "Партия 8 (400 625,59; счёта и письма нет); партия 9 (счёт №7, 427 227,39 — только согласование 09.02.2026; сальдо баланса 04.02.2026 = 427 227,39 сохранено); партия 10 (303 372, согласовано 19.02), 11 (347 895, 27.02), 12 (счёт №65 1 183 135 — 10.03; счёт №63 217 350 — 17.04), 13 (183 400, 17.04), партии 14 (№121 158 600), 17 (№207 71 400), 18 (№237 3 397 795), 19 (№257 2 126 255), 20 (№265 1 892 430), 21 (№275 442 980); авансы №247 (2 272 060), №251 (8 290 940), №259 (1 008 000), №261 (805 000); кейп №145 (248 000); капсула №193 (660 000, ТЗ нет). Есть только даты согласования, не оплаты.", "Внести платежи после подтверждения даты (можно с confirmed = false).", `${SRC_B} §7; ${SRC_C} §6`);
  pend("Аванс 166 600 по ТЗ 118 (06.07.2026)", "«оплачен вместе с авансом по аксессуарам» — входит в счёт №143 (3 230 780), отдельным платежом не заводился во избежание двойного счёта.", "Подтвердить, что 166 600 ⊂ №143.", `${SRC_C} §2, §6`);
  pend("Счёт №265 занижен на 115 110", "Расчёт партии 20 (старая версия в Drive): ТЗ 152 М002А по 18 000 вместо 386 500 (30% недостаёт 110 550) и МН03 по 7 600 вместо 9 500 (4 560); верная доплата 2 007 540 при счёте 1 892 430.", "Выставить доплату/скорректировать счёт.", `${SRC_C} §6`);
  pend("Расхождения сумм: партия 7 и 9", "Партия 7: письмо 2 081 387,54 против счёта/xlsx 2 075 122,54 (Δ 6 265; заведено по счёту/балансу). Партия 9: xlsx к доплате 858 427 (с шкурами 431 040), счёт и письмо 427 227,39.", "Трактовка на подтверждение.", `${SRC_B} §8`);
  pend("ТЗ 46 и ТЗ 52: лот/цена", "ТЗ 46: в ТЗ лот 1450 (9 шк. @16 544,12 = 148 897,08), в БД лот 1457 @15 953,16 (Δ −5 318,44). ТЗ 52: в ТЗ лот 1498 12 шк. @11 579,80, в БД 1498-1 @18 366,51 (Δ +81 440,52).", "Какой лот/цена верны?", `${SRC_A} §6, §7`);
  pend("Партия 5: ТЗ 56 и 58 — «облако» и «фондю» перепутаны", "В xlsx ТЗ 56 = «фондю», ТЗ 58 = «облако»; в ТЗ-документах наоборот (БД — по документам).", "Подтвердить.", `${SRC_A} §7`);
  pend("Размеры: ТЗ 96, 98, 21", "ТЗ 96: «58.58» (опечатка вместо «58, 58»). ТЗ 98: БД хранит уникальные размеры без кратности («57,58,59,60,61,62» при 9 шт.). ТЗ 21: М004 размер 48 (без 4%) против 46 (+4%).", "Исправить на «58, 58» и т.д. после подтверждения.", `${SRC_B} §5 п.15; ${SRC_A} §6`);
  pend("ТЗ 100: 5 или 6 пар", "+4% версия — 5 пар, базовая — 6 пар (6 шкур 5017); xlsx и БД — 5.", "Оставлено 5.", `${SRC_B} §5 п.11`);
  pend("ТЗ 117 (инд. кейп) и ТЗ 116, партии 15 и 16", "ТЗ 117 — индивидуальный заказ вне партий (счёт №145, ТЗ от 18.05.2026), батч не присвоен. ТЗ 116 нет ни в Drive, ни в БД (номер П-2026-0116 принадлежит ТЗ 110). Партии 15 и 16 созданы пустыми: документов и ТЗ по ним в Drive нет.", "Привязать ТЗ 117 к партии (какой?) или оставить без партии; уточнить, что такое партии 15/16.", `${SRC_C} §1, §11`);
  pend("Год партии 8", "Нет счёта и письма; расчёт выслан 27.01.2026, в балансе «отгрузка партии 8» датирована 29.12.2025 (вероятная опечатка). Установлен 2026.", "2025 или 2026.", `${SRC_B} §8`);
  pend("Политика НДС лотов 20%/22%", "У всех лотов в БД vatRate = 22,00, в ТЗ партии 6 — НДС 20%; лоты общие с более поздними ТЗ.", "Решить, менять ли vatRate лотов.", `${SRC_B} §5 п.14`);
  pend("Отражать ли «комиссию 4%» в себестоимости отдельным расходом", "Комиссия 4% ≈ 2,72 млн ₽ по партиям 1–5 (+ далее). Флаг commission4 проставлен; unitCost/totalCost списаний (база без 4%) не менялись, 4% считается отдельно в src/lib/commission4.ts.", "Хранить отдельно (как сейчас) или заводить ProductionExpense.", `${SRC_A} §7; ${SRC_C} §4`);
  pend("Не входящее в состав работ, но подтверждено документами", "Розница по каталогу FW25: ТЗ 45 → 1 985 000, ТЗ 51 → 14 250 000, ТЗ 55 → 1 395 000, ТЗ 58 → 2 450 000; endDate по партиям (22.09.2025/10.10.2025/14.11.2025/04.12.2025); подкладка ТЗ 122/126/131 по расходу; поправка названия лота 3751-2.", "Скажите — добавлю отдельным проходом.", `${SRC_A} §7`);
}

// ---------------------------------------------------------------- вывод плана
function printPlan() {
  const lines: string[] = [];
  const byCat = new Map<string, Op[]>();
  for (const op of ops) byCat.set(op.cat, [...(byCat.get(op.cat) ?? []), op]);
  const order = [...byCat.keys()];
  for (const cat of order) {
    const list = byCat.get(cat)!;
    lines.push(`\n=== ${cat} (${list.length}) ===`);
    for (const op of list) {
      if (op.kind === "update") {
        for (const c of op.changes) lines.push(`${op.label.includes(c.field) ? op.label : op.label + " / " + c.field}: «${fmt(c.before)}» → «${fmt(c.after)}»   [${op.source}]`);
      } else {
        lines.push(`СОЗДАТЬ ${op.model}: ${op.label}   [${op.source}]`);
      }
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
  writeFileSync(PLAN_PATH, lines.join("\n") + "\n");

  // сводка
  const cats = new Map<string, { upd: number; cre: number }>();
  for (const op of ops) {
    const c = cats.get(op.cat) ?? { upd: 0, cre: 0 };
    if (op.kind === "update") c.upd += op.changes.length;
    else c.cre++;
    cats.set(op.cat, c);
  }
  // в консоль: всё, кроме длинных списков документов/списаний/связей оплат
  const SHORT = new Set(["Документы", "Списание сырья"]);
  let skipCat = false;
  for (const l of lines) {
    if (l.startsWith("\n=== ")) { const name = l.slice(5, l.indexOf(" (")); skipCat = SHORT.has(name); console.log(l); if (skipCat) console.log("  … полный список в docs-inventory/corrections-plan-production.txt"); continue; }
    if (!skipCat) console.log(l);
  }
  console.log("\n=== СВОДКА ===");
  for (const [c, v] of cats) console.log(`  ${c}: изменений полей ${v.upd}, создаваемых записей ${v.cre}`);
  console.log(`  Всего операций: ${ops.length}; pending-решений: ${pending.length}`);

  // pending-файл
  const md: string[] = ["# Спорное по производству — требуется решение владельца", "", `Сформировано скриптом apply-drive-production-corrections (${NOW.toISOString().slice(0, 10)}). Ничего из этого в базе не менялось.`, ""];
  for (const p of pending) md.push(`## ${p.id}. ${p.title}`, "", `**Что:** ${p.what}`, "", `**Варианты:** ${p.variants}`, "", `**Источники:** ${p.sources}`, "");
  writeFileSync(PENDING_PATH, md.join("\n"));
  console.log(`\nPending записан: ${PENDING_PATH}\nПолный план: ${PLAN_PATH}`);

  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала бэкап!)."); return; }
  if (ops.length === 0) { console.log("Нечего применять — всё уже сделано."); return; }

  // --- запись
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
          // подряд идущие создания одной модели — одним createMany
          const batch = [op];
          while (i + batch.length < ops.length) {
            const nx = ops[i + batch.length];
            if (nx.kind === "create" && nx.model === op.model) batch.push(nx);
            else break;
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
  try { require("fs").unlinkSync(JOURNAL_PATH + ".planned"); } catch { /* */ }
  console.log(`\nГОТОВО: применено операций ${ops.length}, журнал ${JOURNAL_PATH} (+${journalNew.length} записей). Откат: --rollback ${JOURNAL_PATH}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
