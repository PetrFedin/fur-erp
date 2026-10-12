/**
 * Примечания простым языком: убирает из текстовых полей служебные пометки загрузки данных (метки вида [fix:P07],
 * ключи импорта bulk-import-…:row-N, имена скриптов, названия полей базы, пути к файлам) и переписывает записи
 * человеческими формулировками. Смысл (номера документов, суммы, даты, кто что подтвердил, нерешённые вопросы) сохраняется.
 *
 * Признаки, которые код раньше читал из текста меток, переносятся в отдельные поля (миграция 20261012230000):
 *   Purchase.isContractorRaw   — «сырьё подрядчика» (была метка [fix-structure:note]);
 *   Purchase.listLabel         — короткая подпись в списке «Закупки без аукциона» (fix-drive:fox-209, master-0 / «шкуры подрядчика»);
 *   ProductionOrder.batchNotRequired — «ТЗ без партии по документам» (была метка [письма backup 2026-10-08, ТЗ 116/117]).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/rewrite-notes-plain.ts             # пробный прогон: ничего не пишет, пишет отчёт
 *   node --env-file=.env node_modules/.bin/tsx scripts/rewrite-notes-plain.ts --apply     # запись в одной транзакции (+ журнал)
 *   node --env-file=.env node_modules/.bin/tsx scripts/rewrite-notes-plain.ts --rollback [--apply]   # вернуть старые тексты из журнала
 *
 * Отчёт «было → стало»: docs-inventory/notes-rewrite-2026-10-12.md. Журнал для отката: docs-inventory/corrections-journal-notes-plain.json.
 * Запись идёт «сырым» SQL: updatedAt и подтверждения записей не трогаются (это правка только текста).
 * Перед записью проверяется, что слова, от которых зависят «Внимание», «Оплаты» и сверка (шкуры, «приблизительно», лоскут/бобр/подрядчик
 * и т. п.), после переписывания встречаются ровно там же, где и раньше; иначе скрипт останавливается.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const ROOT = join(__dirname, "..");
const JOURNAL = join(ROOT, "docs-inventory", "corrections-journal-notes-plain.json");
const REPORT = join(ROOT, "docs-inventory", "notes-rewrite-2026-10-12.md");

// ---------------------------------------------------------------------------------------------------------------------
// Какие поля переписываем. label — подпись записи в отчёте (SQL-выражение).
type Target = { table: string; col: string; label: string };
const TARGETS: Target[] = [
  { table: "Purchase", col: "notes", label: `"number"` },
  { table: "PurchaseItem", col: "notes", label: `'позиция закупки ' || coalesce("lotNumber", id)` },
  { table: "Payment", col: "notes", label: `'платёж ' || to_char("paidAt",'DD.MM.YYYY') || ' · ' || "amount"::text || coalesce(' · ' || "docRef", '')` },
  { table: "PaymentAllocation", col: "note", label: `'разнесение ' || "amount"::text` },
  { table: "ProductionOrder", col: "notes", label: `'ТЗ ' || coalesce("workOrderNumber", "number")` },
  { table: "ProductionBatch", col: "notes", label: `'партия ' || "number"::text` },
  { table: "ProductionPayment", col: "notes", label: `'оплата производства ' || to_char("paidAt",'DD.MM.YYYY') || ' · ' || "amount"::text || coalesce(' · ' || "docRef", '')` },
  { table: "DriveDocument", col: "notes", label: `"title"` },
  { table: "FinishedGoodsMovement", col: "notes", label: `'движение готовой продукции ' || to_char("date",'DD.MM.YYYY')` },
  { table: "StockMovement", col: "notes", label: `'движение склада ' || to_char("date",'DD.MM.YYYY') || ' · ' || "type"::text` },
  { table: "RawMaterialLot", col: "notes", label: `'лот ' || coalesce("lotNumber", id)` },
  { table: "ProductModel", col: "description", label: `"name"` },
  { table: "FurRef", col: "note", label: `"name"` },
  { table: "ColorRef", col: "note", label: `"name"` },
  { table: "CategoryRef", col: "note", label: `"name"` },
];

// ---------------------------------------------------------------------------------------------------------------------
// Правила переписывания.
const ru = (iso: string) => iso.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3.$2.$1");
const DRIVE_FILE = /Drive:?\s*«?мех»?\s*\/\s*доп материал\s*\/\s*акт сверки\s*\/\s*баланс всех оплат мех\.xlsx/g;

type Ctx = { table: string };
type Rule = [RegExp, string | ((m: RegExpMatchArray, ctx: Ctx) => string)];

/** Правила для начала строки (метки-префиксы). Срабатывает первое подошедшее. */
const HEAD_RULES: Rule[] = [
  // ключи импорта
  [/^(?:bulk-import-registry-\d{4}-\d{2}:\S+|import-sp0926:\S+)\s*/, ""],
  // «Основание: [fix:AP-110-b2] …» у документов Drive
  // даты выпуска ТЗ
  [
    /^\[даты из документов [^\]]*\]\s*endDate (\d{2}\.\d{2}\.\d{4}) был датой импорта, а не фактом — убран \(дата выпуска не подтверждена, ждёт ручной проверки(?:; кандидат (\d{4}-\d{2}-\d{2}))?\)\./,
    (m) => `Дата выпуска из реестра (${m[1]}) была датой импорта, а не фактом — убрана. Дата выпуска не подтверждена, ждёт ручной проверки${m[2] ? `; по документам вероятна ${ru(m[2])}` : ""}.`,
  ],
  [/^\[даты из документов [^\]]*\]\s*endDate (\d{4}-\d{2}-\d{2})\s*\((партия \d+)\):\s*/, (m) => `Дата выпуска ${ru(m[1])} (${m[2]}) определена по документам: `],
  [/^\[дата выпуска по документам и датам файлов Drive [^\]]*\]\s*endDate (\d{4}-\d{2}-\d{2})\s*\((партия \d+)\):\s*/, (m) => `Дата выпуска ${ru(m[1])} (${m[2]}) определена по документам и датам файлов Drive: `],
  // проверка данных
  [/^\[data-check [^\]]*\]\s*цвет «—» → «([^»]*)»:\s*/, (m) => `Цвет не был указан; принят «${m[1]}»: `],
  [/^\[data-check [^\]]*\]\s*цвет «([^»]*)» → «([^»]*)»:\s*/, (m) => `Цвет «${m[1]}» заменён на «${m[2]}»: `],
  [/^\[data-check [^\]]*\]\s*размер «([^»]*)» → «([^»]*)»:\s*/, (m) => `Размер «${m[1]}» исправлен на «${m[2]}»: `],
  [/^\[data-check [^\]]*\]\s*составной цвет разнесён в справочник \(ProductionOrderColor\):\s*/, "Составной цвет разнесён по отдельным цветам изделия: "],
  [/^\[сверка [^\]]*\]\s*размер: расчёт\/приложение\s*/, "Размеры по расчёту/приложению "],
  [/^\[сверка [^\]]*\]\s*выпуск:\s*/, "Выпуск по документам: "],
  [/^\[завершено по документам [^\]]*\]\s*сдано заказчику:\s*/, "Завершено по документам — сдано заказчику: "],
  // письма / акт сверки / оплаты
  [/^\[письма backup [^\]]*\]\s*/, "По переписке: "],
  [/^\[акт-сверки [^\]]*\]\s*Сверено с актом: акт сверки\s*/, "Сверено с актом сверки "],
  [/^\[разнесение СП\/РП 05\.25, [^\]]*\]\s*/, "Разнесение между СП 05.25 и РП 05.25. "],
  [/^\[оплата 2026 по указанию владельца 08\.10\.2026\]\s*/, "Оплата 2026 по указанию владельца (08.10.2026): "],
  [/^\[оплата счёта (№\d+), решение владельца (\d{2}\.\d{2}\.\d{4})\]\s*/, (m) => `Оплата счёта ${m[1]} — решение владельца от ${m[2]}. `],
  [/^\[разбивка платежа: шкуры подрядчика [^\]]*\]\s*/, "Разбивка платежа на работу и шкуры подрядчика. "],
  [/^\[шкуры подрядчика\]\s*/, ""],
  // склад
  [/^\[open-items:moved ([^→\]]+)→([^\]]+)\]\s*$/, (m) => `Списание перенесено с лота ${m[1].trim()} на лот ${m[2].trim()}.`],
  [/^\[open-items:raw TZ(\d+) ([^\]]+)\]\s*/, (m) => `ТЗ ${m[1]}, лот ${m[2]}: `],
  [/^\[drive-lining TZ(\d+)\]\s*/, (m) => `ТЗ ${m[1]}: `],
  // НДС в позициях
  [/^\[fix-vat\] НДС 22% → 20% по документу:\s*/, "НДС изменён с 22% на 20% по документу: "],
  // цены модели
  [/^\[цены:реестр-2026-10\]\s*/, "Цены по реестру (октябрь 2026): "],
  // остальные метки с именем «технического» вида в начале строки
  [/^\[(?:fix|fix-structure|drive-draft|docs|scope|open-items|registry-corrections|mail-beaver|data-decisions[\w-]*)[^\]]*\]\s*/, ""],
];

/** Подстановки внутри строки (применяются все по порядку). */
const BODY_RULES: Rule[] = [
  // скрипты, привязки
  [/\s*Привязка скриптом link-drive-docs-quality \(проверка пробелов \/documents; сумма закупки сверена с расчётом\)/, " Привязка проверена по документам: сумма закупки сверена с расчётом."],
  [/\s*Привязка скриптом link-[\w-]+(?: \([^)]*\))?\.?/, ""],
  [/, apply-drive-purchase-structure\b/, ""],
  [/\s*Создано скриптом [\w-]+\.?/, ""],
  [/\s*\(apply-drive-production-corrections\)/, ""],
  [/;\s*apply-drive-production-corrections\)/, ")"],
  [/\s*\(fix-lining-prices\.ts\)/, ""],
  [/\s*\(scripts\/consolidate-lining-lots\.ts\)/, ""],
  [/\s*\(см\. docs-inventory\/color-unification\.md\)/, ""],
  [/\s*Подробно: docs-inventory\/[\w.\/-]+\.?/, ""],
  [/\s*\(\[data-decisions-\d [^\]]*\]\)/, ""],
  [/\s*\[data-decisions-\d [^\]]*\]/, ""],
  [/Из правил src\/lib\/product-category\.ts/, "По правилам определения категории"],
  // закупки: спорное по структуре
  [
    /Не удалена \(правило «не удалять без доказательств»\); см\. pending-decisions-purchase-structure\.md п\.2\./,
    "Запись сохранена (не удаляется без доказательств). Открытый вопрос владельцу: считать эти шкуры закупкой или частью доплаты партии 18 — иначе возможен двойной учёт.",
  ],
  [
    /Не удалена; возможен двойной учёт с оплатой партии 5 — см\. pending-decisions-purchase-structure\.md п\.2\./,
    "Запись сохранена. Открытый вопрос владельцу: считать эти шкуры закупкой или частью доплаты партии 5 — иначе возможен двойной учёт с оплатой партии 5.",
  ],
  [
    /Не удалена — см\. pending-decisions-purchase-structure\.md п\.2\./,
    "Запись сохранена. Открытый вопрос владельцу: считать эти шкуры закупкой или частью доплаты партии 6 — иначе возможен двойной учёт.",
  ],
  [/Возвращена в DRAFT:/, "Возвращена в статус «Черновик»:"],
  [/Стоимость лотов сохранена в costPlan позиций\./, "Стоимость лотов сохранена как плановая стоимость позиций закупки."],
  [/\(expectedDate = конец срока\)/, "(ожидаемая дата поставки — конец срока)"],
  [/\(p2026a §(\d+\.\d+), §(\d+\.\d+\.\d+)\)/, "(по разбору закупок 2026 года, п. $1 и $2)"],
  [/блок «план»\/колонка quantity/, "блок «план», колонка «количество»"],
  [/статус IN_PROGRESS/, "статус «В работе»"],
  [/доказанного allocation/, "доказанного разнесения"],
  [/\bдокументам Drive: /, "документам Drive: "],
  [/(?<![А-Яа-яё])в БД(?![А-Яа-яё])/g, "в базе"],
  [/ в PST /, " в архиве почты "],
  [/Payment 3 =/, "Платёж 3 ="],
  [/против текущего ledger/, "против текущего учёта"],
  [/\(≤151\)/, "(реестр охватывает ТЗ до 151)"],
  [/\(Drive:? мех \/ доп материал \/ акт сверки \/ баланс всех оплат мех\.xlsx\)/g, "(файл «баланс всех оплат мех.xlsx», папка «мех» на Drive)"],
  [DRIVE_FILE, "файл «баланс всех оплат мех.xlsx», папка «мех» на Drive"],
  [/\s*Привязка по отчёту p20\d\d[ab]\b\.?/g, ""],
  [/Основание платежа [A-Z]\d{2} \((\d{4}-\d{2}-\d{2}), ([^)]*?) ₽\)/, (m) => `Основание платежа от ${ru(m[1])} на ${m[2].replace(/\./, ",")} ₽`],
  [/Основание [A-Z]\d{2} \((\d{4}-\d{2}-\d{2}), ([^)]*?) ₽\)/, (m) => `Основание платежа от ${ru(m[1])} на ${m[2]} ₽`],
  [/Основание: [A-Z]\d{2}, (\d{4}-\d{2}-\d{2}), ([\d\s,]+) ₽/, (m) => `Основание платежа от ${ru(m[1])} на ${m[2]} ₽`],
  [/Outlook PST/g, "архив почты Outlook"],
  [/ПРОВЕРИТЬ:/, "Нужно проверить:"],
  [/\. в реестре оттенок/, ". В реестре оттенок"],
  [/\)\. версии приложения расходятся/, "). Версии приложения расходятся"],
  [/^Авто: по набору ТЗ платежа, пропорционально работе$/, "Разнесено автоматически по набору ТЗ платежа, пропорционально работе."],
  [/(Размеры по расчёту\/приложению «[^»]*»): размеры /, "$1: "],
  // fix-drive:… в начале текста закупки
  [/^fix-drive:[\w-]+ — создана/, "Создана"],
];

/** Метки [fix:…] посреди текста — убрать. Для документов Drive «Основание: [fix:AP-110-b2] сумма» превращаем в понятную фразу. */
function stripFixTags(line: string, table: string): string {
  if (table === "DriveDocument") {
    line = line.replace(/\[fix:AP-(110|209)-b(\d)\]/g, (_m, a, b) => `часть аванса по счёту №${a} на партию ${b} —`);
  }
  return line.replace(/\s*\[fix:[^\]]*\]/g, "");
}

/** Один JSON «finance-evidence» → понятный текст. */
function financeEvidence(json: string): string | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const money = (n: unknown) => `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n))} ₽`.replace(/ /g, " ");
    const state: Record<string, string> = { UNPAID: "не оплачен", PAID: "оплачен", PARTIAL: "оплачен частично" };
    let t = `Счёт №${o.invoiceNo} от ${ru(String(o.invoiceDate))} на ${money(o.invoiceAmount)} — ${state[String(o.state)] ?? String(o.state).toLowerCase()} (оплачено ${money(o.paid)}, остаток ${money(o.remaining)}).`;
    if (o.source) {
      const src = String(o.source).replace(/\.$/, "");
      const mo = /^Outlook ([\d–.]+):\s*([\s\S]*)$/.exec(src);
      t += mo ? ` Источник — переписка Outlook, ${mo[1]}: ${mo[2]}.` : ` Источник (на ${ru(String(o.sourceDate))}): ${src}.`;
    }
    if (o.note) t += ` ${String(o.note).replace(/allocation/g, "разнесения")}`;
    return t;
  } catch {
    return null;
  }
}

/** Где начинается новая «запись» внутри строки: метки, перед которыми склеился предыдущий текст. */
const MID_SPLIT = /([.)»])\s+(?=\[(?:письма backup|даты из документов|data-check|сверка|акт-сверки|завершено по документам)[^\]]*\])/g;

export function rewriteNote(text: string, table: string): string | null {
  // 1) ключ импорта import-fw26-… (с переносами внутри) занимает строку и «хвост» из пары строк — убираем целиком
  const rawLines = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (/^import-fw26-2026-09:/.test(l)) {
      while (i + 1 < rawLines.length && /^(?:от «|к Договору)/.test(rawLines[i + 1])) i++;
      continue;
    }
    lines.push(l.replace(MID_SPLIT, "$1\n"));
  }
  const out: string[] = [];
  let touched = lines.length !== rawLines.length || lines.join("\n") !== rawLines.join("\n");
  for (const chunk of lines.join("\n").split("\n")) {
    let l = chunk.trim();
    if (!l) continue;
    // finance-evidence: JSON
    const fe = /^\[finance-evidence\]\s*(\{.*\})\s*$/.exec(l);
    if (fe) {
      const t = financeEvidence(fe[1]);
      touched = true;
      if (t) out.push(t);
      else out.push(l);
      continue;
    }
    const orig = l;
    for (const [re, rep] of HEAD_RULES) {
      const m = re.exec(l);
      if (m) {
        const r = typeof rep === "string" ? rep : rep(m, { table });
        l = r + l.slice(m[0].length);
        break;
      }
    }
    l = stripFixTags(l, table);
    for (const [re, rep] of BODY_RULES) {
      if (typeof rep === "string") l = l.replace(re, rep);
      else l = l.replace(re, (...a) => rep(a as unknown as RegExpMatchArray, { table }));
    }
    // остаточные технические метки в квадратных скобках (латиница с двоеточием/дефисом или с датой)
    l = l.replace(/\s*\[(?:[a-z][\w]*[:\-][^\]]*|[^\]]*\b20\d\d-\d\d-\d\d\b[^\]]*)\]/gi, "");
    if (l !== orig) {
      touched = true;
      l = ru(l).replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/([^.])\.\.(?!\.)/g, "$1.").trim();
      if (/^[а-яё]/.test(l)) l = l[0].toUpperCase() + l.slice(1);
    }
    if (l && l !== ".") out.push(l);
    else touched = true;
  }
  // если есть строка «дата выпуска определена по документам», прежнее «не подтверждена» уже неверно
  const determined = out.some((l) => /^Дата выпуска \d{2}\.\d{2}\.\d{4} \(партия \d+\) определена по документам/.test(l));
  const dedup: string[] = [];
  for (let l of out) {
    if (determined) l = l.replace(/ Дата выпуска не подтверждена, ждёт ручной проверки(?:; по документам вероятна [\d.]+)?\./, "");
    if (!dedup.includes(l)) dedup.push(l);
  }
  const res = dedup.join("\n").trim();
  if (!touched) return text;
  return res || null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Слова, от которых зависит код (поиск по тексту примечаний). После переписывания должны совпадать «до» и «после».
const NON_STOCK_RE = /лоскут|бобр|фонди|подрядчик|давальч|сырь[её]\s+(заказчик|клиент|подрядчик)|тут нет продаж/i;
const APPROX_RE = /дата по (письму|fin|расч[её]ту)|приблизительн|гипотез/i;
/** Копия contractorHidesFromNotes (src/lib/batch-stats.ts): сумма «шкур подрядчика» из примечания платежа производства. */
const hidesAmount = (s: string): string => {
  const m = /шкур[а-яё]*[^\d.;]{0,40}?(\d[\d\s\u00a0]*\d)/i.exec(s);
  if (!m) return "-";
  const n = m[1].replace(/[\s\u00a0]/g, "");
  return /^\d+$/.test(n) ? n : "-";
};
const DEPENDENCIES: { name: string; tables: string[]; test: (s: string) => boolean | string }[] = [
  { name: "сумма «шкур подрядчика» из примечания (объяснение переплаты в партии)", tables: ["ProductionPayment"], test: hidesAmount },
  { name: "«шкур» в примечании платежа (Оплаты, разнесение, долг)", tables: ["Payment", "ProductionPayment"], test: (s) => /шкур/i.test(s) },
  { name: "«шкуры подрядчика» (подпись в списке закупок / объяснение переплаты)", tables: ["Payment", "ProductionPayment", "Purchase"], test: (s) => /шкуры подрядчика/i.test(s) },
  { name: "сырьё не со склада (Внимание, Подтверждение)", tables: ["ProductionOrder"], test: (s) => NON_STOCK_RE.test(s) },
  { name: "дата по письму/расчёту/приблизительно (Подтверждение)", tables: ["Payment", "ProductionPayment"], test: (s) => APPROX_RE.test(s) },
  { name: "«Предложено, ждёт подтверждения» (справочники цветов и категорий)", tables: ["ColorRef", "CategoryRef"], test: (s) => /^\s*Предложено/.test(s) },
  { name: "«Код цвета: …» (мастер объединения цветов)", tables: ["ProductionOrder"], test: (s) => /Код цвета: \d+/.test(s) },
];

/** Что не должно остаться в тексте после переписывания. */
const RESIDUAL =
  /\[[a-zA-Z0-9_:.\- ]+\]|expectedDate|costPlan|endDate|startDate|скрипт|\b(?:apply|fix|import|bulk|create|link)-[a-z0-9-]+|\.ts\b|\.md\b|row-\d+|pending-decisions|drive-draft|open-items|письма backup|data-check|mail-beaver|\bDRAFT\b|IN_PROGRESS|ProductionOrderColor|\ballocation\b|docs-inventory|\[[^\]]*20\d\d-\d\d-\d\d[^\]]*\]/;

// ---------------------------------------------------------------------------------------------------------------------
type Row = { id: string; txt: string; label: string };
type Change = { table: string; col: string; id: string; label: string; before: string; after: string | null };
type FlagChange = { table: string; col: string; id: string; label: string; value: boolean | string };

async function readAll(t: Target): Promise<Row[]> {
  return prisma.$queryRawUnsafe<Row[]>(`select id, "${t.col}" as txt, (${t.label}) as label from "${t.table}" where "${t.col}" is not null and "${t.col}" <> '' order by id`);
}

const numbersOf = (s: string) => {
  const t = ru(s.replace(/\[[^\]]*\]/g, " ").replace(/(?:bulk-import|import)[\w-]*:\S+/g, " "));
  const out = new Set<string>();
  const rest = t.replace(/\d{2}\.\d{2}\.\d{4}/g, (d) => (out.add(d), " "));
  for (const m of rest.match(/\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) ?? []) {
    const n = m.replace(/ /g, "").replace(/,/g, ".").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    if (n.replace(/\D/g, "").length >= 3) out.add(n);
  }
  return out;
};

async function plan() {
  const changes: Change[] = [];
  const flags: FlagChange[] = [];
  const counts: Record<string, { rows: number; changed: number; cleared: number }> = {};
  const problems: string[] = [];
  for (const t of TARGETS) {
    const rows = await readAll(t);
    const key = `${t.table}.${t.col}`;
    counts[key] = { rows: rows.length, changed: 0, cleared: 0 };
    for (const r of rows) {
      const after = rewriteNote(r.txt, t.table);
      if (after === r.txt) continue;
      changes.push({ table: t.table, col: t.col, id: r.id, label: r.label, before: r.txt, after });
      counts[key].changed++;
      if (after === null) counts[key].cleared++;
      for (const d of DEPENDENCIES) {
        if (!d.tables.includes(t.table)) continue;
        const a = String(d.test(r.txt)), b = String(d.test(after ?? ""));
        // у одного платежа старый разбор читал из метки «… подрядчика 2026-10-04» год 2026 вместо суммы: после переписывания читается верная сумма
        if (d.name.startsWith("сумма") && /^20\d\d$/.test(a)) continue;
        if (a !== b) problems.push(`${key} ${r.label}: зависимость «${d.name}» изменилась ${a} → ${b}`);
      }
      if (after && RESIDUAL.test(after)) problems.push(`${key} ${r.label}: остался технический текст: ${(RESIDUAL.exec(after) ?? [""])[0]}`);
    }
  }
  // признаки, которые код читал из текста
  const purchases = await readAll(TARGETS[0]);
  for (const r of purchases) {
    if (r.txt.includes("[fix-structure:note]")) flags.push({ table: "Purchase", col: "isContractorRaw", id: r.id, label: r.label, value: true });
    const label = /fix-drive:fox-209/.test(r.txt) ? "красная лиса, УПД №209" : /master-0|шкуры подрядчика/i.test(r.txt) ? "шкуры подрядчика" : null;
    if (label) flags.push({ table: "Purchase", col: "listLabel", id: r.id, label: r.label, value: label });
  }
  const orders = await readAll(TARGETS.find((x) => x.table === "ProductionOrder")!);
  for (const r of orders) if (r.txt.includes("[письма backup 2026-10-08, ТЗ 116/117]")) flags.push({ table: "ProductionOrder", col: "batchNotRequired", id: r.id, label: r.label, value: true });
  return { changes, flags, counts, problems };
}

function writeReport(p: Awaited<ReturnType<typeof plan>>, mode: string) {
  const L: string[] = [];
  L.push(`# Примечания простым языком — отчёт «было → стало»`, "", `Режим: ${mode}. Сформирован скриптом scripts/rewrite-notes-plain.ts. Откат: журнал corrections-journal-notes-plain.json (--rollback).`, "");
  L.push("## Объём", "", "| Поле | Записей с текстом | Будет изменено | Из них очищено полностью (служебный ключ) |", "|---|---:|---:|---:|");
  let tr = 0, tc = 0, tz = 0;
  for (const [k, v] of Object.entries(p.counts)) {
    L.push(`| ${k} | ${v.rows} | ${v.changed} | ${v.cleared} |`);
    tr += v.rows; tc += v.changed; tz += v.cleared;
  }
  L.push(`| **Итого** | ${tr} | ${tc} | ${tz} |`, "");
  L.push("## Признаки вместо меток в тексте", "");
  for (const f of p.flags) L.push(`- ${f.table}.${f.col} = ${JSON.stringify(f.value)} — ${f.label}`);
  L.push("", "## Проверка зависимостей", "", p.problems.length ? p.problems.map((x) => `- ПРОБЛЕМА: ${x}`).join("\n") : "Слова, от которых зависит код, остались ровно в тех же записях, технических остатков в тексте нет.", "");
  L.push("## Записи", "");
  let cur = "";
  for (const c of p.changes) {
    const k = `${c.table}.${c.col}`;
    if (k !== cur) { L.push(`### ${k}`, ""); cur = k; }
    L.push(`**${c.label}** (${c.id})`, "", "было:", "```", c.before, "```", "стало:", "```", c.after ?? "(пусто — служебная запись, очищено)", "```");
    if (c.after) {
      const lost = [...numbersOf(c.before)].filter((n) => !numbersOf(c.after!).has(n));
      if (lost.length) L.push(`числа, которых нет в новом тексте (служебные даты и номера отчётов не в счёт): ${lost.join(", ")}`);
    }
    L.push("");
  }
  writeFileSync(REPORT, L.join("\n"));
}

async function main() {
  if (ROLLBACK) return rollback();
  const p = await plan();
  writeReport(p, APPLY ? "ЗАПИСЬ" : "пробный прогон");
  console.log(`Записей к изменению: ${p.changes.length}; признаков: ${p.flags.length}; проблем: ${p.problems.length}`);
  for (const [k, v] of Object.entries(p.counts)) console.log(`  ${k}: с текстом ${v.rows}, меняется ${v.changed}, очищается ${v.cleared}`);
  if (p.problems.length) { for (const x of p.problems) console.log("  ✗ " + x); throw new Error("Есть проблемы — запись не выполняется"); }
  console.log(`Отчёт: ${REPORT}`);
  if (!APPLY) { console.log("Пробный прогон: в базу ничего не записано. Для записи — --apply"); return; }

  const journal = { time: new Date().toISOString(), changes: p.changes, flags: p.flags };
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // журнал пишем до записи
  await prisma.$transaction(
    async (tx) => {
      for (const f of p.flags) {
        const n = await tx.$executeRawUnsafe(`update "${f.table}" set "${f.col}" = $1 where id = $2`, f.value, f.id);
        if (n !== 1) throw new Error(`признак ${f.table}.${f.col} ${f.id}: обновлено ${n}`);
      }
      for (const c of p.changes) {
        const n = await tx.$executeRawUnsafe(`update "${c.table}" set "${c.col}" = $1 where id = $2 and "${c.col}" = $3`, c.after, c.id, c.before);
        if (n !== 1) throw new Error(`${c.table}.${c.col} ${c.id}: запись изменилась с момента чтения (обновлено ${n})`);
      }
      // доказательство: наборы с признаками совпадают с наборами по старым меткам
      const got = await tx.$queryRawUnsafe<{ id: string }[]>(`select id from "Purchase" where "isContractorRaw" = true order by id`);
      const want = p.flags.filter((f) => f.col === "isContractorRaw").map((f) => f.id).sort();
      if (JSON.stringify(got.map((x) => x.id)) !== JSON.stringify(want)) throw new Error("isContractorRaw: набор не совпал с набором по меткам");
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
  console.log(`Записано: ${p.changes.length} примечаний, ${p.flags.length} признаков. Журнал: ${JOURNAL}`);
}

async function rollback() {
  if (!existsSync(JOURNAL)) throw new Error("Нет журнала " + JOURNAL);
  const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { changes: Change[]; flags: FlagChange[] };
  console.log(`Откат: ${j.changes.length} примечаний и ${j.flags.length} признаков${APPLY ? "" : " (пробный прогон; для записи --apply)"}`);
  if (!APPLY) return;
  await prisma.$transaction(
    async (tx) => {
      for (const c of j.changes) {
        const n = await tx.$executeRawUnsafe(`update "${c.table}" set "${c.col}" = $1 where id = $2`, c.before, c.id);
        if (n !== 1) throw new Error(`${c.table} ${c.id}: нет записи`);
      }
      for (const f of j.flags) await tx.$executeRawUnsafe(`update "${f.table}" set "${f.col}" = null where id = $1`, f.id);
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
  console.log("Откат выполнен. Если код уже переведён на признаки, а не на метки, для старого кода нужны и тексты, и миграция откатывается отдельно.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
