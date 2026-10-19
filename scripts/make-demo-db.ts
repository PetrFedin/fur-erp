/**
 * Обезличенная демо-база для внешних тестировщиков. Работает ТОЛЬКО на копии базы с именем *_demo
 * (оригинал не читается и не меняется). Запуск обёрткой scripts/make-demo-db.sh — она создаёт копию и вызывает этот файл:
 *
 *   DATABASE_URL=postgresql://…/fur_erp_demo npx tsx scripts/make-demo-db.ts
 *
 * Что делается (подробности и ограничения — docs/DEPLOY.md, раздел «Демо-база»):
 *  • деньги: по умолчанию НАСТОЯЩИЕ (коэффициент 1, ничего не умножается). Если нужно скрыть масштаб, задайте целый коэффициент
 *    (DEMO_MONEY_SCALE=3…9 или --money-scale=N): тогда ВСЕ денежные суммы умножаются на него и сверки (Σ частей = итог) сохраняются;
 *    курсы валют, ставки НДС, проценты и количества не меняются никогда;
 *  • контрагенты: названия → «Поставщик №N»/«Заказчик №N» (Веллмех → «Веллмех-демо»), ИНН/адреса/телефоны/почты — вымышленные;
 *    старые названия вычищаются из всех текстовых и JSON-полей;
 *  • люди: «подтвердил/принял/ответственный» → «Демо»; пользователи пересоздаются (владелец, технолог, закупщик, бухгалтер,
 *    Веллмех-демо) со СЛУЧАЙНЫМИ паролями — они пишутся только в файл с правами 600 и в чат не печатаются;
 *  • тексты: заметки, комментарии, примечания, решения владельца (SystemState), чаты, письма, комментарии, журнал изменений — удаляются;
 *  • кабинет Веллмеха: ПРИНЯТЫЕ расчёты аукционов и ТЗ Веллмеха (SupplierInbox) сохраняются и согласуются с закупками/ТЗ заказчика:
 *    деньги в них при K>1 домножаются на тот же K (ставки, курсы, проценты, количества — нет), подписанты и реквизиты заменяются,
 *    вложения становятся заглушками; черновики, отклонённые и отправленные-непринятые удаляются; этапы сырья остаются (без заметок);
 *  • файлы и документы: внешних ссылок и путей нет (в БД их больше не хранится), имена заменяются на «Документ №N», все файлы указывают на одну заглушку PDF;
 *    фото примерок, вложения чата и входящие поставщика удаляются;
 *  • реквизиты счетов/договоров: номера договоров и ссылки заменяются; номера счетов и п/п (нужны для связей) сохраняются.
 * Не маскируется (осознанно): даты, количества, названия видов меха/материалов/аукционов, артикулы и названия изделий,
 * номера закупок/ТЗ/лотов, суммы (при коэффициенте 1) и пропорции цен.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCalcScale, scaleCalcPayload, scaleTzPayload } from "./demo-inbox-scale";
import type { CalcPayload } from "../src/lib/supplier-calc";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/\/[a-z0-9_]*_demo(\?|$)/i.test(dbUrl)) {
  console.error("Отказ: DATABASE_URL должен указывать на базу с именем *_demo (копию, а не боевую).");
  process.exit(2);
}
const prisma = new PrismaClient();
const x = (sql: string, ...p: unknown[]) => prisma.$executeRawUnsafe(sql, ...p);
const rows = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...p);
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

// Деньги: коэффициент один на всё, по умолчанию 1 (суммы настоящие). Источники: --money-scale=N, DEMO_MONEY_SCALE (или старое DEMO_SCALE).
// Коэффициент — целое число ≥ 1: тогда произведения «цена × количество» и суммы остаются точными до копейки, и сверки сходятся без расхождений округления.
const argScale = process.argv.find((a) => a.startsWith("--money-scale="))?.split("=")[1];
const K = Number(argScale ?? process.env.DEMO_MONEY_SCALE ?? process.env.DEMO_SCALE ?? 1);
if (!Number.isInteger(K) || K < 1 || K > 99) { console.error("Отказ: коэффициент денег должен быть целым 1…99 (по умолчанию 1)."); process.exit(2); }

const MONEY: Record<string, string[]> = {
  FinishedGoodsMovement: ["totalCost", "unitCost"],
  FinishedGoodsStock: ["avgUnitCost"],
  Invoice: ["amountInclVat"],
  Payment: ["amount"],
  PaymentAllocation: ["amount"],
  ProductModel: ["sellingPrice", "supplierWorkPrice"],
  ProductionExpense: ["amount"],
  ProductionMaterialUsage: ["totalCost", "unitCost"],
  ProductionOrder: ["clientWorkPricePerUnit", "expenseCost", "materialCost", "retailPrice", "totalCost", "unitCost"],
  ProductionPayment: ["amount"],
  PurchaseExpense: ["amount"],
  PurchaseItem: ["subtotal", "unitPrice"],
  RawMaterialLot: ["expenseCostExclVat", "expenseVatAmount", "materialCostExclVat", "materialVatAmount", "totalCost", "unitCost"],
  StockMovement: ["totalCost", "unitCost"],
};

/** Тексты, которые просто очищаются (NULL, а если колонка обязательная — пустая строка). */
const CLEAR: Record<string, string[]> = {
  Auction: ["note"], CalendarEvent: ["notes", "docNote"], CategoryRef: ["note"], ColorRef: ["note"], FurRef: ["note"],
  FurAttrRef: ["description"], Fitting: ["comment"], Invoice: ["note"], Payment: ["notes"], PaymentAllocation: ["note"],
  ProductModel: ["description"], ProductModelMaterial: ["notes"], ProductionBatch: ["notes", "verifyNote"], ProductionExpense: ["description"],
  ProductionOrder: ["notes", "verifyNote", "materialDescription"], ProductionPayment: ["notes"], ProductionPlan: ["notes"],
  Purchase: ["notes", "verifyNote"], PurchaseExpense: ["description"], PurchaseItem: ["notes"], RawMaterial: ["description"],
  RawMaterialLot: ["notes"], Shipment: ["notes"], ShipmentEvent: ["details", "docLinks"], ShipmentEventLine: ["comment"],
  ShipmentLine: ["comment"], ShipmentLineRework: ["note", "text"], StockMovement: ["notes"], SupplierContract: ["note"],
  SupplierRawStage: ["note"], SupplyPlanEntry: ["notes"], FinishedGoodsMovement: ["notes"], DriveDocument: ["notes"],
  Client: ["notes"], Supplier: ["notes"],
};
/** Имена людей → «Демо». */
const PEOPLE: Record<string, string[]> = {
  Payment: ["confirmedBy"], ProductionPayment: ["confirmedBy"], ProductionBatch: ["verifiedBy"], ProductionOrder: ["verifiedBy"],
  Purchase: ["verifiedBy"], Shipment: ["acceptedBy"], ShipmentEvent: ["responsibleName"], ShipmentLine: ["stageChangedBy"],
  BudgetScenario: ["createdBy", "updatedBy"],
};
/** Таблицы, которые очищаются целиком (переписка, журнал, вложения, обращения поставщика). */
const WIPE = [
  "AuditLog", "CommentReply", "Comment", "ChatMessageReaction", "ChannelDelivery", "ChatAttachment", "ChatMessage", "ChatRead", "ChatMember",
  "ChatThread", "ChannelBindCode", "ChannelLink", "FittingPhoto", "SupplierCalcTemplate",
  // Поступления и продажи (Cashflow, «Продажи») и прайс розницы — данные заказчика: в демо не входят, страница Cashflow там показывает «нет данных о продажах».
  "SalesReceiptLine",
];

/** Фамилии и имена людей, которые встречаются в свободных текстах (этапы отгрузок, примечания). */
const PERSON_NAMES = ["Василий", "Вельмакин", "Павлов", "Коношенко", "Желнин", "Киржнер", "Козлов", "Федин"];
const ORIGINAL_ALIASES = ["Веллмех", "Wellmekh", "Vellmex", "Wellmex", "Веллмекс", "Меркури", "Mercury"];

async function nullable(table: string, col: string) {
  const r = await rows<{ is_nullable: string }>(`select is_nullable from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, table, col);
  return r[0]?.is_nullable === "YES";
}
async function tableExists(t: string) {
  return (await rows(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, t)).length > 0;
}
async function setText(table: string, col: string, value: string | null) {
  if (!(await tableExists(table))) return;
  const nul = await nullable(table, col);
  if (value === null) await x(`update ${q(table)} set ${q(col)} = ${nul ? "NULL" : "''"}`);
  else await x(`update ${q(table)} set ${q(col)} = $1 where ${q(col)} is not null`, value);
}

const FICT = ["Альфа-Мех", "Бета-Трейд", "Гамма-Сырьё", "Дельта-Лайн", "Омега-Текстиль", "Сигма-Фурс", "Заря-Опт", "Вега-Групп", "Орион-Логистик", "Лира-Снаб"];

type Item = { label?: unknown; value?: unknown } & Record<string, unknown>;
const MONEY_KEYS = new Set(["materialVat", "expenseVat", "unitCostInclVat", "materialExclVat", "expenseExclVat"]);
/** Денежные значения внутри JSON расчёта лота/позиции: items[].value (кроме курсов и процентов брокера) и итоговые поля costPlan. */
function scaleJson(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const o = { ...(json as Record<string, unknown>) };
  if (Array.isArray(o.items)) {
    o.items = (o.items as Item[]).map((it) => {
      const label = String(it.label ?? "");
      const isRate = /курс/i.test(label) || /^брок\.? ?%|брокерская комиссия, ?%/i.test(label);
      return typeof it.value === "number" && !isRate ? { ...it, value: Math.round(it.value * K * 1e6) / 1e6 } : it;
    });
  }
  for (const k of Object.keys(o)) {
    if (MONEY_KEYS.has(k) && (typeof o[k] === "number" || typeof o[k] === "string") && Number.isFinite(Number(o[k]))) o[k] = typeof o[k] === "number" ? Math.round((o[k] as number) * K * 1e6) / 1e6 : String(Math.round(Number(o[k]) * K * 1e6) / 1e6);
    else if (k === "costBreakdown") o[k] = scaleJson(o[k]);
  }
  return o;
}

async function main() {
  const t0 = Date.now();
  const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}с] ${m}`);
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

  // 0. Исходные названия контрагентов — собираем до замены, чтобы потом вычистить из свободных полей.
  const sups = await rows<{ id: string; name: string }>(`select id, name from "Supplier" order by "createdAt", id`);
  const clis = await rows<{ id: string; name: string }>(`select id, name from "Client" order by "createdAt", id`);
  const originals = new Set<string>([...sups.map((s) => s.name), ...clis.map((c) => c.name), ...ORIGINAL_ALIASES]);
  const oldUsers = await rows<{ email: string; name: string }>(`select email, name from "User"`);

  // 1. Очистка таблиц целиком
  for (const t of WIPE) if (await tableExists(t)) await x(`delete from ${q(t)}`);
  await x(`delete from "SystemState" where key like 'owner-decision:%' or key like 'retail-prices:%'`);
  // Фото артикулов и ссылки «Товар в магазине» в обезличенную демо не входят (реальные карточки товаров; файлы в демо не копируются).
  await x(`delete from "SystemState" where key like 'article-photos:%' or key like 'article-shop-links:%'`);
  // PLU — внутренние коды заказчика: в демо пусто (свойства артикула «PLU…» убираются, остальные остаются).
  await x(`update "ProductModel" set "attributes" = nullif((select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof("attributes") = 'array' then "attributes" else '[]'::jsonb end) e where e->>'name' !~* '^PLU( |$)'), '[]'::jsonb) where "attributes" is not null`);
  // Входящие поставщика: оставляем только ПРИНЯТЫЕ расчёты аукционов и ТЗ (из них созданы закупки и ТЗ заказчика); остальное — черновики и переписка
  await x(`delete from "SupplierInbox" where not (status = 'ACCEPTED' and kind in ('AUCTION_CALC','TZ'))`);
  log("очищены переписка, журнал, вложения, обращения поставщика, решения владельца");

  // 1б. Логика приложения относит оплату к «шкурам подрядчика» по слову «шкур» в основании (docRef) ИЛИ в примечании (notes).
  // Примечания в демо стираются, поэтому метка переносится в основание платежа — иначе оплата перейдёт из «шкур» в «работу», и суммы разойдутся с основной системой.
  for (const t of ["Payment", "ProductionPayment"]) {
    await x(`update ${q(t)} set "docRef" = case when coalesce("docRef", '') = '' then 'шкуры подрядчика' else "docRef" || ' · шкуры подрядчика' end where "notes" ~* 'шкур' and coalesce("docRef", '') !~* 'шкур'`);
  }

  // 2. Деньги (при K=1 — не трогаем вообще: суммы настоящие)
  if (K !== 1) for (const [t, cols] of Object.entries(MONEY)) {
    for (const c of cols) await x(`update ${q(t)} set ${q(c)} = round((${q(c)} * ${K})::numeric, 2) where ${q(c)} is not null`);
  }
  if (K !== 1) for (const [t, c] of [["RawMaterialLot", "costBreakdown"], ["PurchaseItem", "costPlan"]] as const) {
    const r = await rows<{ id: string; v: unknown }>(`select id, ${q(c)} as v from ${q(t)} where ${q(c)} is not null and jsonb_typeof(${q(c)}) = 'object'`);
    for (const row of r) await x(`update ${q(t)} set ${q(c)} = $1::jsonb where id = $2`, JSON.stringify(scaleJson(row.v)), row.id);
  }
  await x(`update "BudgetScenario" set lines = '[]'::jsonb, params = '{}'::jsonb, comment = NULL`);
  log(K === 1 ? "деньги не умножались (коэффициент 1, суммы настоящие)" : "деньги домножены на скрытый коэффициент (в логе не печатается)");

  // 3. Контрагенты
  let si = 0;
  for (const s of sups) {
    const wm = /в[еэ]лл?м[еэ][хк]с?|w[eе]llm/i.test(s.name);
    const name = wm ? "Веллмех-демо" : `Поставщик №${++si} ${FICT[si % FICT.length]}`;
    await x(`update "Supplier" set name=$1, inn=$2, address='г. Москва, ул. Демонстрационная, д. 1', "contactName"='Контактное лицо', email=$3, phone='+7 000 000-00-00' where id=$4`,
      name, wm ? "7701000000" : String(7700000000 + sups.indexOf(s) * 13 + 1000013), `supplier${sups.indexOf(s) + 1}@demo.invalid`, s.id);
  }
  for (const [i, c] of clis.entries()) {
    await x(`update "Client" set name=$1, inn=$2, address='г. Москва, ул. Демонстрационная, д. 2', "contactName"='Контактное лицо', email=$3, phone='+7 000 000-00-01' where id=$4`,
      `Заказчик №${i + 1} ${FICT[(i + 3) % FICT.length]}`, String(7800000000 + i * 17 + 1000000), `client${i + 1}@demo.invalid`, c.id);
  }
  await x(`update "Warehouse" set address = NULL where address is not null`).catch(() => undefined);
  await x(`update "Organization" set name='THE FUR', slug='the-fur-demo' where id=$1`, org.id);
  await x(`update "SupplierContract" set number = 'Д-' || substr(id, length(id) - 3)`).catch(() => undefined);
  log(`контрагенты: ${sups.length} поставщиков, ${clis.length} заказчиков`);

  // 3б. Кабинет Веллмеха: принятые расчёты аукционов и ТЗ — те же лоты, счета и суммы (×K при K>1), что у заказчика
  {
    const inbox = await rows<{ id: string; kind: string; payload: unknown; createdEntityId: string | null }>(`select id, kind, payload, "createdEntityId" from "SupplierInbox"`);
    const dests = new Map<string, string>();
    const maskDest = (d: string) => dests.get(d) ?? dests.set(d, `Площадка №${dests.size + 1}`).get(d)!;
    const cl = (await rows<{ name: string }>(`select name from "Client" order by "createdAt", id limit 1`))[0]?.name ?? "Заказчик №1";
    const who = { customer: cl, customerPost: `Генеральный директор ${cl}`, contractorPost: "Генеральный директор Подрядчика", place: "Склад заказчика (демо)" };
    let nCalc = 0, nTz = 0;
    for (const r of inbox) {
      const payload = r.kind === "AUCTION_CALC"
        ? (() => {
            const orig = r.payload as CalcPayload;
            const scaled = scaleCalcPayload(orig, K, maskDest);
            const bad = checkCalcScale(orig, scaled, K);
            if (bad) throw new Error(`демо: расчёт ${r.id} не масштабируется линейно (${bad}) — дамп не создан`);
            nCalc++;
            return scaled;
          })()
        : (nTz++, scaleTzPayload(r.payload as Record<string, unknown>, K, who));
      await x(`update "SupplierInbox" set payload = $1::jsonb, note = NULL, "reviewNote" = NULL where id = $2`, JSON.stringify(payload), r.id);
    }
    // вложения: имена и файлы — заглушки (сами файлы в демо не переносятся)
    await x(`update "SupplierInboxFile" set "originalName" = 'Документ-' || substr(id, length(id) - 4) || '.pdf', "storagePath" = 'demo/stub.pdf', "mimeType" = 'application/pdf', "sizeBytes" = 1200`);
    log(`кабинет Веллмеха: расчётов аукционов ${nCalc}, ТЗ ${nTz} (коэффициент денег ${K === 1 ? "1" : "скрыт"}, линейность расчёта проверена)`);
  }

  // 4. Свободные тексты и люди
  for (const [t, cols] of Object.entries(CLEAR)) for (const c of cols) await setText(t, c, null);
  for (const [t, cols] of Object.entries(PEOPLE)) for (const c of cols) await setText(t, c, "Демо");
  // Имена пользователей внутри JSON состояния (например, shipment-zi: alloc.by) -> «Демо»
  for (const u of oldUsers) {
    const nm = (u.name ?? "").trim();
    if (nm.length >= 3) await x(`update "SystemState" set "value" = replace("value"::text, $1, '"Демо"')::jsonb where "value"::text like $2`, JSON.stringify(nm), `%${JSON.stringify(nm).replace(/[%_\\]/g, "\\$&")}%`);
  }
  await x(`update "ProductionOrder" set "contractNumber" = 'ДГ-ДЕМО' where "contractNumber" is not null`);
  log("заметки, примечания, имена людей очищены");

  // 5. Документы и файлы: одна заглушка
  const STUB = "demo/stub.pdf";
  await x(`update "DriveDocument" set title = 'Документ №' || substr(id, length(id) - 4), "drivePath" = NULL, "viewUrl" = NULL,
           "driveFileId" = CASE WHEN "driveFileId" LIKE 'local-%' OR "driveFileId" LIKE 'doc-%' THEN "driveFileId" ELSE 'doc-' || substr(md5("driveFileId"), 1, 24) END,
           "storedName" = CASE WHEN "storagePath" is not null THEN 'Документ-' || substr(id, length(id) - 4) || '.pdf' ELSE "storedName" END,
           "storagePath" = CASE WHEN "storagePath" is not null THEN '${STUB}' ELSE NULL END,
           "storedMime" = CASE WHEN "storagePath" is not null THEN 'application/pdf' ELSE "storedMime" END`);
  await x(`update "PurchaseDocument" set title = 'Документ №' || substr(id, length(id) - 4), "originalName" = 'Документ-' || substr(id, length(id) - 4) || '.pdf',
           "storagePath" = '${STUB}', "mimeType" = 'application/pdf', "sizeBytes" = 1200, batch = NULL`);
  log("документы заменены заглушками");

  // 6. Старые названия — вон из всех текстовых и JSON-полей
  const textCols = await rows<{ table_name: string; column_name: string; data_type: string }>(
    `select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name <> '_prisma_migrations'
       and data_type in ('text','character varying','jsonb') and column_name not in ('id','passwordHash','email') and column_name not like '%Id'`);
  const repl = [...originals].filter((n) => n.length >= 4).sort((a, b) => b.length - a.length);
  const sqlLit = (s: string) => `'${s.replace(/'/g, "''")}'`;
  for (const c of textCols) {
    for (const o of repl) {
      const target = /в[еэ]лл?м[еэ][хк]|w[eе]llm|vellm/i.test(o) ? "Веллмех-демо" : "Контрагент-демо";
      const col = q(c.column_name);
      if (c.data_type === "jsonb") await x(`update ${q(c.table_name)} set ${col} = replace(${col}::text, ${sqlLit(o)}, ${sqlLit(target)})::jsonb where ${col}::text like ${sqlLit("%" + o + "%")}`);
      else await x(`update ${q(c.table_name)} set ${col} = replace(${col}, ${sqlLit(o)}, ${sqlLit(target)}) where ${col} like ${sqlLit("%" + o + "%")}`);
    }
  }
  // Имена людей из переписки (в названиях этапов отгрузок и примечаниях) -> нейтральное слово
  for (const c of textCols) {
    for (const o of PERSON_NAMES) {
      const col = q(c.column_name);
      if (c.data_type === "jsonb") await x(`update ${q(c.table_name)} set ${col} = replace(${col}::text, ${sqlLit(o)}, 'Сотрудник')::jsonb where ${col}::text like ${sqlLit("%" + o + "%")}`);
      else await x(`update ${q(c.table_name)} set ${col} = replace(${col}, ${sqlLit(o)}, 'Сотрудник') where ${col} like ${sqlLit("%" + o + "%")}`);
    }
  }
  // Веллмех-демо не должен превращаться в «Веллмех-демо-демо» при повторных заменах
  for (const c of textCols) {
    if (c.data_type !== "jsonb") await x(`update ${q(c.table_name)} set ${q(c.column_name)} = replace(${q(c.column_name)}, 'Веллмех-демо-демо', 'Веллмех-демо') where ${q(c.column_name)} like '%демо-демо%'`);
    else await x(`update ${q(c.table_name)} set ${q(c.column_name)} = replace(${q(c.column_name)}::text, 'Веллмех-демо-демо', 'Веллмех-демо')::jsonb where ${q(c.column_name)}::text like '%демо-демо%'`);
  }
  // «MVST» → «THE FUR», упоминания Диска — вон (на случай, если в источнике что-то осталось)
  for (const c of textCols) {
    const col = q(c.column_name);
    const t = c.data_type === "jsonb" ? `${col}::text` : col;
    const wrap = (e: string) => (c.data_type === "jsonb" ? `(${e})::jsonb` : e);
    await x(`update ${q(c.table_name)} set ${col} = ${wrap(`regexp_replace(regexp_replace(replace(replace(${t}, 'MVST', 'THE FUR'), 'mvst', 'the fur'), ' ?\\(?Google Drive\\)?', '', 'g'), '\\yDrive\\y', 'документы', 'g')`)} where ${t} ~ '(MVST|mvst|\\yDrive\\y|Google)'`);
  }
  log("старые названия вычищены из текстов");

  // 7. Пользователи
  const pw = () => randomBytes(12).toString("base64url");
  const demoUsers = [
    { key: "owner", email: "owner@demo.local", name: "Демо Владелец", role: "OWNER" },
    { key: "technologist", email: "technologist@demo.local", name: "Демо Технолог", role: "TECHNOLOGIST" },
    { key: "purchaser", email: "purchaser@demo.local", name: "Демо Закупщик", role: "PURCHASER" },
    { key: "accountant", email: "accountant@demo.local", name: "Демо Бухгалтер", role: "ACCOUNTANT" },
    { key: "supplier", email: "wellmekh@demo.local", name: "Веллмех-демо (кабинет)", role: "SUPPLIER" },
  ] as const;
  const supplierId = (await rows<{ id: string }>(`select id from "Supplier" where name like 'Веллмех%' order by "createdAt" limit 1`))[0]?.id ?? sups[0]?.id ?? null;
  await x(`delete from "User"`);
  const creds: string[] = [];
  for (const u of demoUsers) {
    const password = pw();
    await prisma.user.create({
      data: { organizationId: org.id, email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(password, 12), supplierId: u.role === "SUPPLIER" ? supplierId : null },
    });
    creds.push(`${u.name} (${u.role})\n  email:  ${u.email}\n  пароль: ${password}`);
  }
  const dir = path.join(os.homedir(), "Backups", "fur-erp");
  mkdirSync(dir, { recursive: true });
  const file = process.env.DEMO_LOGINS_FILE || path.join(dir, "demo-logins.txt");
  writeFileSync(file, `Демо-логины THE FUR (создано ${new Date().toISOString()}). Файл личный, не пересылать.\nАдрес: см. docs/DEPLOY.md (после публикации).\nСлужебное: ${K === 1 ? "коэффициент денег 1 (суммы настоящие)" : `коэффициент денег ${K} (для проверки: RECON_TOL_SCALE=${K} npx tsx scripts/test-reconciliation.ts); внешним не сообщать`}.\n\n${creds.join("\n\n")}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  log(`пользователи пересозданы, логины записаны в ${file} (права 600)`);

  // 8. Контроль: ничего старого не осталось
  let leftovers = 0;
  const probes = [...repl, ...oldUsers.map((u) => u.email).filter(Boolean), ...oldUsers.map((u) => u.name).filter((n) => n && n.length >= 5)];
  const allText = await rows<{ table_name: string; column_name: string; data_type: string }>(
    `select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name <> '_prisma_migrations' and data_type in ('text','character varying','jsonb')`);
  for (const p of probes) {
    for (const c of allText) {
      // «Веллмех-демо» и служебное значение side=WELLMEKH — осознанные остатки, не утечка; демо-пользователи проверяются отдельно.
      if (c.table_name === "User" || (c.table_name === "ShipmentEvent" && c.column_name === "side")) continue;
      const col = `replace(${c.data_type === "jsonb" ? `${q(c.column_name)}::text` : q(c.column_name)}, 'Веллмех-демо', '')`;
      const n = Number((await rows<{ n: bigint }>(`select count(*) n from ${q(c.table_name)} where ${col} ilike $1`, `%${p}%`))[0].n);
      if (n > 0) { leftovers += n; console.log(`  осталось «${p.slice(0, 3)}…» в ${c.table_name}.${c.column_name}: ${n}`); }
    }
  }
  console.log(leftovers === 0 ? "Контроль: прежние названия, почты и имена в базе не найдены." : `ВНИМАНИЕ: найдено совпадений: ${leftovers} — проверьте вручную.`);
  const stubDir = path.resolve(process.env.DEMO_UPLOADS_DIR || path.join(os.homedir(), "Backups", "fur-erp", "demo", "uploads"));
  mkdirSync(path.join(stubDir, "demo"), { recursive: true });
  if (!existsSync(path.join(stubDir, STUB))) {
    writeFileSync(path.join(stubDir, STUB), Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 60 Td (DEMO document - stub) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n"));
  }
  console.log(`Заглушка документа: ${path.join(stubDir, STUB)}`);
  await prisma.$disconnect();
  process.exit(leftovers === 0 ? 0 : 3);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
