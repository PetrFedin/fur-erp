/**
 * Всё присланное Веллмехом раньше — в его кабинет, как записи «Входящих» со статусом «Принято» и ссылкой на УЖЕ СУЩЕСТВУЮЩИЕ
 * наши закупки и ТЗ. Новых закупок, ТЗ, лотов и списаний скрипт не создаёт; сверка остаётся как была.
 *
 *  1. Расчёты аукционов: берутся присланные Excel-файлы (письма: ~/Downloads/MEH_PST_EXTRACT/_INDEX/attachments — и *.xlsx, и вложения без расширения,
 *     все листы книги; файл СП 09-26 из ~/Downloads). Лист может содержать несколько таблиц («план» и «факт») — каждая разбирается отдельно.
 *     По названию аукциона выбирается формат (calc-presets.json; у аукциона бывает несколько раскладок — берётся совпавшая), лоты вставляются
 *     по заголовкам файла, формулы формата пересчитывают всё. Запись создаётся ТОЛЬКО если:
 *       • каждый счёт файла нашёл нашу закупку (по номеру счёта; если в файле счетов нет или это номера счетов аукциона, как у SAGA, — по названию
 *         аукциона и лотам; для «факта» без счёта берётся номер из «Счёта на оплату № N» в том же письме), лоты и количества совпали
 *         (если в расчёте шкур больше, чем в УПД и закупке — образцы, — сверяется «цена в УПД»);
 *       • себестоимость каждой шкуры совпала с нашей закупкой (costPlan.unitCostInclVat или себестоимость лота) в допуске ±0,05 ₽ (--tol);
 *       • итог по счёту совпал в допуске: не менее ±1,00 ₽ (--tol-inv) или 0,005 ₽ × число шкур в счёте (--tol-round) — цена шкуры в нашей закупке
 *         округлена до копейки, и сумма таких округлений по лотам не расхождение. Допуск не прячет разницу формул: расхождения в рублях на шкуру
 *         (курс, НДС, пошлина, доля транспорта, комиссия) в допуск не попадают.
 *     «Ручные ячейки» (значение в файле вписано числом, не формулой, либо формат не имеет вводной из файла) не блокируют: в листе стоят числа файла
 *     Веллмеха, они помечаются как «значение из файла»; блокирует только расхождение итоговой себестоимости с закупкой.
 *     Не создаются: предварительные расчёты (план, до покупки, с другим курсом/НДС/без части статей), более ранние версии одного аукциона
 *     (из версий берётся совпавшая окончательная, на одну закупку — одна запись), расчёты без закупки и расчёты в валюте без рублей.
 *     Причины каждого отказа печатаются в отчёте (строка «ПРИЧИНА» — разбор по самим файлам, см. KNOWN_CAUSES) и в сводной таблице.
 *  2. ТЗ: присланные Word «ПРИЛОЖЕНИЕ N» разбираются, по данным собирается Word заново (src/lib/tz-docx-vendor.ts) и сверяется с оригиналом
 *     по тексту и вёрстке. Запись создаётся только при нуле расхождений и если номер ТЗ есть у нас (ProductionOrder.workOrderNumber)
 *     с тем же числом позиций и изделий. Остальные ТЗ перечисляются отдельно, ничего не подгоняется.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/import-wellmekh-history.ts              # пробный прогон (БД не меняется)
 *   ... --apply            # создать записи; на боевой базе нужен ещё --live (скрипт сам делает scripts/backup.sh)
 *   ... --rollback --apply # удалить созданные записи по журналу, вернуть изменённые
 *   ... --report <файл>    # сохранить отчёт пробного прогона в файл
 *   ... --tol 0.05 --tol-inv 1 --tol-round 0.005   # допуски: на шкуру, ₽; на счёт, ₽ (минимум); на счёт на каждую шкуру, ₽ (см. выше)
 *   ... --only <часть пути>  # только файлы, в пути которых есть строка; --debug — ручные ячейки и блоки файлов
 * Журнал: docs-inventory/corrections-journal-wellmekh-history-2026-10-15.json
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import JSZip from "jszip";
import { docxBlocks, layoutDiff, payloadFromDocx, textDiff } from "./lib/tz-docx-import";
import { buildTzDocx } from "../src/lib/tz-docx-vendor";
import { applySheetTable, findHeaderRow, headerScore } from "../src/lib/sheet-paste";
import { getPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { calcAll, type CalcPayload } from "../src/lib/supplier-calc";
import { parseXlsxSheets } from "../src/lib/table-file";
import { tzTotals, type TzPayload } from "../src/lib/tz-vendor";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : ""; // только файлы, в пути которых есть эта строка (отладка)
const DEBUG = process.argv.includes("--debug"); // показать ручные ячейки и отличие формулы формата от файла
const REPORT = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : "";
/** Журнал отката: на боевой базе общий файл, на копиях свой (имя базы в названии), чтобы откат копии не задел записи и файлы боевой базы. */
const dbNameOf = (/\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?");
const JOURNAL = join(__dirname, "..", "docs-inventory", `corrections-journal-wellmekh-history-2026-10-15${dbNameOf === "fur_erp" ? "" : `-${dbNameOf}`}.json`);
const MAIL = join(homedir(), "Downloads", "MEH_PST_EXTRACT", "_INDEX");
const DOWNLOADS = join(homedir(), "Downloads");
const SUPPLIER_EMAIL = "wellmekh@demo.local";

const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Название аукциона в файле → формат расчёта. */
const FORMATS: [RegExp, string | string[]][] = [
  [/СОЮЗПУШНИНА 09-26/i, "sp_0926"], [/СОЮЗПУШНИНА 05-26/i, "sp_2026"], [/Русьпушнина 04-26/i, "rp_2026"],
  [/СОЮЗПУШНИНА 12-25/i, "sp_rp_2025"], [/Русьпушнина\+Союзпушнина 05-25/i, "sp_rp_2025"],
  [/SAGA 03-26/i, ["saga_03_26_final", "saga_03_26"]], [/SAGA 03-25/i, "saga_03_25"], [/SAGA 06-25/i, "saga_06_25"], [/FH 06-26/i, "fh_lynx_2026"], [/ALE 05-26|AME 05-26/i, "ame_05_26"],
];

type Journal = { created: string[]; tzUpdated: { id: string; before: { status: string; createdEntityType: string | null; createdEntityId: string | null; decidedAt: string | null; decidedById: string | null; sentAt: string | null } }[]; files: string[] };

function walk(dir: string, ext: RegExp, acc: string[] = [], depth = 0): string[] {
  if (depth > 5 || !existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, ext, acc, depth + 1); } else if (ext.test(e.name) && !e.name.startsWith("~$")) acc.push(p);
  }
  return acc;
}
/** Дата и тема письма по номеру папки вложения (index.tsv: дата, тема, номер eml). */
function mailInfos(): Map<string, { date: Date; subject: string }> {
  const m = new Map<string, { date: Date; subject: string }>();
  const f = join(MAIL, "index.tsv");
  if (!existsSync(f)) return m;
  for (const line of readFileSync(f, "utf8").split("\n").slice(1)) { const c = line.split("\t"); if (c[0] && c[6]) m.set(c[6].trim(), { date: new Date(c[0]), subject: c[3] ?? "" }); }
  return m;
}
const emlOf = (p: string) => /attachments\/(\d+)\//.exec(p)?.[1] ?? "";


// ───────── разбор расчётных файлов Веллмеха

/** Допуск на шкуру, ₽: округление частей в нашей закупке (цена молотка, сборы, НДС округляются по отдельности) даёт до 5 копеек. */
const TOL = process.argv.includes("--tol") ? Number(process.argv[process.argv.indexOf("--tol") + 1]) : 0.05;
/** Допуск на счёт, ₽: сумма таких округлений по лотам счёта — не менее 1 ₽, а для больших счетов 0,005 ₽ × число шкур (цена шкуры у нас округлена до копейки: ±0,005 ₽ у каждой). */
const TOL_INV = process.argv.includes("--tol-inv") ? Number(process.argv[process.argv.indexOf("--tol-inv") + 1]) : 1.0;
const TOL_ROUND = process.argv.includes("--tol-round") ? Number(process.argv[process.argv.indexOf("--tol-round") + 1]) : 0.005;
const tolInvFor = (qty: number) => Math.max(TOL_INV, TOL_ROUND * qty);

/** Формат файла, у которого в разных письмах бывают разные настройки: пробуем базовые параметры и варианты, берём тот, где меньше ручных ячеек. */
const VARIANTS: Record<string, Record<string, string>[]> = {
  // в «расчёте закупки» FH 06-26 колонка «Комиссия РМ 4,5%» пуста (комиссию агента платят отдельно по факту), в таблице расчётов LYNX она заполнена
  fh_lynx_2026: [{ рм_проц: "0" }],
};
/** Заголовки столбцов, которые в файле названы длинно и по общим правилам вставки не узнаются: заголовок → название нашего столбца/параметра. */
const HEADER_ALIASES: Record<string, [RegExp, string][]> = {
  fh_lynx_2026: [[/^курс\+комиссия агента/i, "курс"]],
  // в файле «$» (цена за единицу в долларах) стоит без названия, «цена за ед. в руб» — в столбце V: сначала занимаем S, иначе оба названия узнаются как S
  saga_03_26: [[/^\s*\$\s*$/, "Цена за ед. $"], [/^расчетный курс цб/i, "курс_руб"], [/^предварительная цена\s?за ед/i, "Цена за ед. ₽"], [/^предварительная сумма закупки/i, "Сумма закупки ₽"]],
  saga_06_25: [[/^курс \+3,5% агента/i, "Курс"], [/^там\.сбор\+TAX 5%\+НДС 20%\+усл\.перевозчика/i, "Там.сбор+TAX 5%+НДС 20%+услуги перевозчика"]],
  ame_05_26: [[/^\s*\$\s*рубль\s*$/i, "Цена за ед. ₽"], [/^цена \$$/i, "Итого ₽"], [/^доставка tai/i, "Доставка выделка-МСК (авиа)"]],
};

/** Причины расхождений, разобранные по самим файлам (путь файла содержит ключ; пересчитано по формулам файла против нашей закупки). */
const KNOWN_CAUSES: [string, string][] = [
  ["182/расчет закупки", "FH 06-26, «расчёт закупки» от 09.06.2026 (лист «предварительный расчет ММ»): столбец «Комиссия РМ 4,5%» в файле пуст — комиссию агента платят отдельно «по факту затрат» (аванс 3), а в нашей закупке она входит в себестоимость (4,5% от молотка × курс 76,1625, напр. 5 826,40 ₽ на шкуру при молотке $1700). Остальные статьи формат воспроизводит до копейки (контрольная строка с рм_проц = 0 добавлена в формат fh_lynx_2026)."],
  ["325/расчет закупки СП 12-25", "СП 12-25, предварительный расчёт (лист «предварит.расчет себ-сти ЦУМ»): НДС на товар 22% против 20% у нас (+480,18 ₽ на шкуру), выделка+покраска (950+500)×1,22 = 1 769 против 1 740 (+29,00), перевозка 50 ₽ на шкуру, которой в закупке нет (+50,00): всего +559,18 ₽ на шкуру; итоговый расчёт того же дня (файл без расширения в письме 323) совпал с закупкой."],
  ["220/закупка РП 04-2026", "РП 04-26, ранняя версия от 04.05.2026: столбцы «выделка», «транспорт на выделку и обратно» и «брокерский %» в файле пусты (выделка 1 159 + транспорт 18,87 + брокерский 4,5% от молотка = 2 218,4 ₽ на шкуру, около −6,8%); в версии от 10.07.2026 они заполнены, и она совпала с закупкой."],
  ["208/закупка СП 05-2026", "СП 05-26, ранняя версия от 22.05.2026: столбцы «выделка», «транспорт на выделку и обратно» и «брокерский %» в файле пусты (около −6,5%); в версии от 10.07.2026 они заполнены, и она совпала с закупкой."],
  ["228/Закупка ММ SAGA 03-26", "SAGA 03-26, версия от 06.04.2026 («предварительный расчет»): в рубли пересчитано по предварительному курсу ЦБ на 06.04.2026 + 1,5% (79,7293 × 1,015 = 80,9252, подпись в файле «пока что предварительная»); итоговый файл от 12.08.2026 считает по курсу оплаты 76,0861 × 1,015 и курсу ГТД 78,0308, он совпал с закупкой до копейки."],
  ["229/Закупка ММ SAGA 03-26", "SAGA 03-26, версия от 01.04.2026: расчёт только в долларах, рублёвой себестоимости ещё нет (курс на дату платежа не был известен)."],
  ["231/предварительный расчет", "SAGA 03-26, предварительный расчёт от 25.03.2026 (до покупки): без номеров счетов и фактических лотов, это план."],
  ["232/предварительный расчет", "SAGA 03-26, предварительный расчёт от 25.03.2026 (до покупки): без номеров счетов и фактических лотов, это план."],
  ["233/FW26 предварительный", "SAGA 03-26, предварительный расчёт от 25.03.2026 (до покупки): без номеров счетов и фактических лотов, это план."],
  ["209/предварительный расчет на мех ALE", "ALE 05-26, план покупки норки махагон от 22.05.2026 (400 шт. по $105, «исходим из стандартных лотов»): до торгов, без лотов; фактическая закупка — AME 05.26 (счёт 253, 371 шт. по $72), она совпала с блоком «факт» файла от 09.09.2026. Счёт № 153 в письме — счёт аванса, закупки с таким номером у нас нет."],
  ["199/предварительный расчет на мех ALE", "AME 05-26, «предварительный расчет» от 29.05.2026 (376 шт. по $72, курс 74,36): до фактических затрат, без лотов; окончательные числа — блок «факт» файла от 09.09.2026 (он совпал с закупкой). Счёт № 167 в письме — счёт аванса, закупки с таким номером у нас нет."],
  ["382/фин расчет SAGA 03-25", "SAGA 03-25, ранние версии (13.03.2025 и 13.05.2025): расчёт только в долларах и евро, без таможни, доставки и рублей; рублёвый расчёт с таможней — файл «расчет себестоимости SAGA 03-25» (письмо от 15.09.2025), он совпал с закупкой."],
  ["388/фин расчет SAGA 03-25", "SAGA 03-25, ранние версии (13.03.2025 и 13.05.2025): расчёт только в долларах и евро, без таможни, доставки и рублей; рублёвый расчёт с таможней — файл «расчет себестоимости SAGA 03-25» (письмо от 15.09.2025), он совпал с закупкой."],
];

const normS = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "");
/** Номер лота у нас и в файле: сначала точно, потом без суффикса «-1» (разбитый лот), потом по хвостовым цифрам («3017-4» = «4»). */
const lotLevels: ((a: string, b: string) => boolean)[] = [
  (a, b) => a === b,
  (a, b) => a.replace(/-\d+$/, "") === b.replace(/-\d+$/, ""),
  (a, b) => { const ta = /(\d+)$/.exec(a)?.[1], tb = /(\d+)$/.exec(b)?.[1]; return !!ta && ta === tb; },
];
function findItem<T extends { lotNumber: string | null; quantity: unknown }>(items: T[], used: Set<number>, lot: string | null | undefined, qty: number): number {
  for (const eq of lotLevels) {
    const k = items.findIndex((it, j) => !used.has(j) && eq(normS(it.lotNumber), normS(lot)) && Number(it.quantity) === qty);
    if (k >= 0) return k;
  }
  return -1;
}

const SKIP_EXT = /\.(pdf|rtf|docx?|xls|png|jpe?g|gif|eml|txt|html?|csv|zip|msg|ics|tiff?|bmp|heic|webp|pptx?|mp4|mov|json|xml)$/i;
/** Все файлы, которые могут быть книгами Excel: *.xlsx и безымянные (в письмах вложения нередко сохранены без расширения). Настоящий xlsx проверяется позже по содержимому. */
function listWorkbooks(dir: string, acc: string[] = [], depth = 0): string[] {
  if (depth > 5 || !existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) listWorkbooks(p, acc, depth + 1); }
    else if (!e.name.startsWith("~$") && (/\.xlsx$/i.test(e.name) || !SKIP_EXT.test(e.name))) acc.push(p);
  }
  return acc;
}
/** Книга Excel, в которой вообще есть расчёт аукциона (заголовки «invoice» и «quantity»): чужие большие отчёты не разбираем. */
async function isCalcWorkbook(buf: Buffer): Promise<boolean> {
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return false;
  try {
    const zip = await JSZip.loadAsync(buf);
    if (!zip.file("xl/workbook.xml")) return false;
    const ss = await zip.file("xl/sharedStrings.xml")?.async("string");
    return !!ss && /invoice/i.test(ss) && /quantity/i.test(ss);
  } catch { return false; }
}

const QTY_H = /^(quantity|кол|количество|шт)(\s|$|\.)/;
const normH = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
const isHeaderRow = (row: string[]) => headerScore(row) >= 3 && row.map(normH).some((x) => /^(invoice|счет|номер счета)(\s|$)/.test(x)) && row.map(normH).some((x) => /^(lot|лот)/.test(x)) && row.map(normH).some((x) => QTY_H.test(x));

/** Лист может содержать несколько таблиц подряд («план» и «факт» в одном файле): режем на блоки, а в блоке отсекаем хвост (итоги, свод по цветам). */
function splitBlocks(table: string[][]): { title: string; label: string; table: string[][] }[] {
  const heads: number[] = [];
  table.forEach((r, i) => { if (isHeaderRow(r)) heads.push(i); });
  return heads.map((h, k) => {
    const qi = table[h].map(normH).findIndex((x) => QTY_H.test(x));
    const from = k === 0 ? 0 : h - 1;
    const end = heads[k + 1] ?? table.length;
    const data: string[][] = [];
    for (let i = h + 1; i < end; i++) {
      const q = (table[i][qi] ?? "").trim();
      if (/[A-Za-zА-Яа-яЁё]{3,}/.test(q)) break; // «колво», «общ. Стоимость», «Итого» в столбце количества — таблица закончилась
      if (!/^[\d\s.,]+$/.test(q)) continue; // строка без количества (оплаты, даты под таблицей) — не лот
      data.push(table[i]);
    }
    // строка итогов без лота и счёта: количество равно сумме остальных — это не лот
    const num = (r: string[]) => Number((r[qi] ?? "").replace(/\s/g, "").replace(",", "."));
    const lotI = table[h].map(normH).findIndex((x) => /^(lot|лот)(\s|$)/.test(x));
    for (let k = data.length - 1; k >= 0; k--) {
      const others = data.filter((_, j) => j !== k);
      if (!(data[k][lotI] ?? "").trim() && others.length > 0 && Math.abs(num(data[k]) - others.reduce((a, r) => a + (num(r) || 0), 0)) < 1e-6) data.splice(k, 1);
    }
    const above = table.slice(from, h);
    const title = above.map((r) => r.filter(Boolean).join(" ")).join(" / ").replace(/\s+/g, " ").trim();
    const label = /(^|[\s/])(план|факт)(?=[\s/]|$)/i.exec(title)?.[2]?.toLowerCase() ?? "";
    return { title, label, table: [...above, table[h], ...data] };
  });
}

export type PurchaseRow = { id: string; number: string; invoiceNumber: string | null; auction: { name: string } | null; auctionSession: string | null; status: string; items: { lotNumber: string | null; quantity: unknown; costPlan: unknown; lot: { unitCost: unknown } | null }[] };
type InvRes = { inv: string; purchase: string | null; fileTotal: number; ourTotal: number; maxHide: number };
type CalcFind = {
  file: string; md5: string; blockNo: number; label: string; title: string; auctionKey: string; preset: string; payload: CalcPayload;
  status: "MATCH" | "NO"; category: string; reasons: string[]; purchaseIds: string[]; sent: Date | null; totals: string; valueFromFile: string;
  invoices: InvRes[]; fileTotalAll: number; invoiceFromMail: string;
};
const noteOf = (f: { md5: string; blockNo: number }) => `история:${f.md5}${f.blockNo > 0 ? `:${f.blockNo}` : ""}`;

function applyBest(presetId: string, table: string[][]) {
  const pr = getPreset(presetId)!;
  const hi = findHeaderRow(table);
  const aliases = HEADER_ALIASES[presetId] ?? [];
  const tb = table.map((r, i) => (i === hi ? r.map((c) => aliases.find(([re]) => re.test((c ?? "").trim()))?.[1] ?? c) : r));
  let best: { r: ReturnType<typeof applySheetTable>; v: Record<string, string> } | null = null;
  for (const v of [{}, ...(VARIANTS[presetId] ?? [])] as Record<string, string>[]) {
    const base = payloadFromPreset(pr);
    base.params = (base.params ?? []).map((q) => (q.name in v ? { ...q, value: v[q.name] } : q));
    const r = applySheetTable(base, tb);
    if (!best || ("error" in best.r && !("error" in r)) || (!("error" in best.r) && !("error" in r) && r.manualCells < best.r.manualCells)) best = { r, v };
  }
  return best!;
}

const rubUnit = (it: PurchaseRow["items"][number]) => {
  const cp = it.costPlan as { unitCostInclVat?: string } | null;
  return cp?.unitCostInclVat != null ? Number(cp.unitCostInclVat) : it.lot?.unitCost != null ? Number(it.lot.unitCost) : NaN;
};

function evaluateBlock(o: { f: string; md5: string; blockNo: number; label: string; title: string; presetId: string; table: string[][]; siblingInvoices: string[]; mail: { date: Date; subject: string } | undefined; purchases: PurchaseRow[] }): CalcFind {
  const { f, md5, title, presetId, table, purchases } = o;
  const auctionKey = (/(\S+\s?\d{1,2}-\d{2,4})/.exec(title)?.[1] ?? title).toLowerCase().replace(/\s+/g, "");
  const base: CalcFind = { file: f, md5, blockNo: o.blockNo, label: o.label, title, auctionKey, preset: presetId, payload: payloadFromPreset(getPreset(presetId)!), status: "NO", category: "differs", reasons: [], purchaseIds: [], sent: o.mail?.date ?? null, totals: "", valueFromFile: "", invoices: [], fileTotalAll: 0, invoiceFromMail: "" };
  const { r, v } = applyBest(presetId, table);
  if ("error" in r) return { ...base, reasons: [r.error] };
  const reasons: string[] = [];
  const pay = r.payload;
  const t = calcAll(pay);
  const sh = t.sheet;
  const unitAt0 = (i: number) => sh.cells[sh.unitCol]?.[i]?.v ?? NaN;
  const titleOf = new Map((pay.customColumns ?? []).map((c) => [c.id, c.title.replace(/ \(в файле [A-Z]+\)/, "")]));
  // ручные ячейки: «Цена для УПД» вносится руками всегда; значение себестоимости, вписанное числом вместо формулы, допустимо («значение из файла»),
  // если оно совпало с нашей закупкой в допуске — это проверяется ниже по каждой шкуре и по счёту. Остальные ручные столбцы — формат не воспроизводит файл.
  // Ячейка, где формула формата даёт то же число с точностью до копейки (в файле константа округлена до 4 знаков), ручной не считается.
  const noOv = calcAll({ ...pay, overrides: {} }).sheet;
  const rowIdx = new Map(pay.rows.map((rw, i) => [rw._id, i]));
  const manualByCol = new Map<string, number>();
  for (const [rid, ov] of Object.entries(pay.overrides ?? {})) for (const [cid, val] of Object.entries(ov)) {
    if (/упд/i.test(titleOf.get(cid) ?? "")) continue;
    const fv = noOv.cells[cid]?.[rowIdx.get(rid) ?? -1]?.v;
    if (fv != null && Number.isFinite(fv) && Math.abs(fv - Number(val)) <= 0.005) continue;
    manualByCol.set(cid, (manualByCol.get(cid) ?? 0) + 1);
    if (DEBUG && (manualByCol.get(cid) ?? 0) <= 2) console.log(`   [ручная] ${titleOf.get(cid)} лот ${pay.rows[rowIdx.get(rid) ?? 0]?.lot}: файл ${val}, формула формата ${fv == null ? "—" : fv.toFixed(4)}`);
  }
  // Все ручные ячейки — «значения из файла»: в листе стоят числа файла Веллмеха (промежуточные столбцы — вводные, которых нет в файле отдельными столбцами,
  // например долларовая цена выделки, из которой файл сразу считает рубли). Главная проверка ниже: себестоимость каждой шкуры и итог счёта равны закупке в допуске.
  const valueFromFile = [...manualByCol].map(([cid, n]) => `${titleOf.get(cid)} — ${n} яч.${cid === sh.unitCol ? " (себестоимость)" : ""}`).join("; ");
  const bad = r.checks.filter((c) => !c.ok && !/упд/i.test(c.title));
  if (bad.length) reasons.push(`итоги не совпали с файлом: ${bad.map((c) => `${c.title.replace(/ \(в файле [A-Z]+\)/, "")} (файл ${money(c.file)}, у нас ${money(c.ours)})`).join("; ")}`);
  if (!sh.unitCol) reasons.push("в формате не выбран столбец себестоимости");
  else if (pay.rows.every((_, i) => !sh.used[i] || !(unitAt0(i) > 0))) reasons.push("в файле нет рублёвой себестоимости шкуры (расчёт только в валюте, без пересчёта в рубли)");
  const unitAt = (i: number) => sh.cells[sh.unitCol]?.[i]?.v ?? NaN;

  // «кол-во / цена в УПД» в файле: если число шкур в расчёте больше (образцы), а в УПД и закупке — столько же, сверяем с УПД
  const hdrRow = findHeaderRow(table);
  const hh = (table[hdrRow] ?? []).map(normH);
  const qi = hh.findIndex((x) => QTY_H.test(x));
  const lotI = hh.findIndex((x) => /^(lot|лот)(\s|$)/.test(x));
  const updQtyI = hh.findIndex((x, i) => i !== qi && x === "кол во");
  const updPriceI = hh.findIndex((x) => /^цена в упд/.test(x));
  const num = (s: string | undefined) => { const x = Number((s ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(x) ? x : NaN; };
  const updRows: { q: number; p: number }[] = [];
  if (updQtyI >= 0 && updPriceI >= 0) for (const row of table.slice(hdrRow + 1)) if ((row[lotI] ?? "").trim()) updRows.push({ q: num(row[updQtyI]), p: num(row[updPriceI]) });
  const upd = updRows.length === pay.rows.length ? updRows : null;

  // по счетам
  let invoiceFromMail = "";
  const byInv = new Map<string, number[]>();
  const sibling = o.siblingInvoices.length === 1 ? o.siblingInvoices[0] : "";
  const noInvoiceAtAll = pay.rows.every((rw, i) => !sh.used[i] || !rw.invoice);
  pay.rows.forEach((row, i) => {
    if (!sh.used[i]) return;
    let inv = row.invoice || "";
    if (!inv && noInvoiceAtAll && sibling) { inv = sibling; invoiceFromMail = sibling; }
    (byInv.get(inv) ?? byInv.set(inv, []).get(inv)!).push(i);
  });
  const purchaseIds: string[] = [];
  const invoices: InvRes[] = [];
  const notes: string[] = [];
  let fileTotalAll = 0;
  const compare = (label: string, idxs: number[], ps: PurchaseRow[], fileSum: number) => {
    const items = ps.flatMap((pp) => pp.items);
    const pnum = ps.map((pp) => pp.number).join(", ");
    purchaseIds.push(...ps.map((pp) => pp.id));
    if (items.length !== idxs.length) { reasons.push(`${label} (${pnum}): лотов в файле ${idxs.length}, в закупке ${items.length}`); invoices.push({ inv: label, purchase: pnum, fileTotal: fileSum, ourTotal: 0, maxHide: 0 }); return; }
    const used = new Set<number>();
    let ours = 0, theirs = 0, maxHide = 0, ok = true, hides = 0;
    for (const i of idxs) {
      const row = pay.rows[i];
      let k = findItem(items, used, row.lot, t.qtys[i]);
      let q = t.qtys[i], u = unitAt(i), viaUpd = false;
      if (k < 0 && upd && Number.isFinite(upd[i].q)) {
        k = findItem(items, used, row.lot, upd[i].q);
        if (k >= 0) { q = upd[i].q; u = upd[i].p; viaUpd = true; if (!notes.length) notes.push(`в расчёте ${t.qtys[i]} шт., в УПД и закупке ${q} шт. (образцы); сверено с «ценой в УПД»`); }
      }
      if (k < 0) { reasons.push(`${label}: лот ${row.lot} (${t.qtys[i]} шт.) не найден в закупке ${pnum}`); ok = false; continue; }
      used.add(k);
      const unitOurs = rubUnit(items[k]);
      const d = Math.abs(unitOurs - u);
      if (!(d <= TOL + 1e-9)) { ok = false; reasons.push(`${label}, лот ${row.lot}: себестоимость шкуры в файле ${Number.isFinite(u) ? money(u) : "—"}, у нас ${Number.isFinite(unitOurs) ? money(unitOurs) : "—"}`); }
      else maxHide = Math.max(maxHide, d);
      hides += q;
      if (Number.isFinite(unitOurs)) { ours += unitOurs * q; theirs += viaUpd ? (unitAt(i) || 0) * t.qtys[i] : u * q; }
    }
    invoices.push({ inv: label, purchase: pnum, fileTotal: theirs, ourTotal: ours, maxHide });
    if (ok && !(Math.abs(ours - theirs) <= tolInvFor(hides) + 1e-9)) reasons.push(`${label}: итог файла ${money(theirs)}, у нас ${money(ours)} (разница ${money(theirs - ours)} ₽ больше допуска ${tolInvFor(hides).toFixed(2)} ₽)`);
  };
  // если ни один счёт файла не нашёл закупку по номеру, но у нас есть закупки с тем же названием аукциона (SAGA: в файле номера счетов аукциона, у нас — наш счёт), сверяем весь файл с ними по лотам
  const aKey = (x: string) => normS(x).replace(/[.\-_/]/g, "");
  const fileAuc = aKey(/([\p{L}]+\s?\d{1,2}[-.]\d{2,4})/u.exec(title)?.[1] ?? "");
  const hitByNumber = [...byInv.keys()].some((inv) => inv && purchases.some((pp) => normS(pp.invoiceNumber) === normS(inv)));
  const aucPurchases = fileAuc ? purchases.filter((pp) => aKey(pp.auction?.name ?? "") === fileAuc) : [];
  const noInvoiceRows = byInv.size === 1 && byInv.has("") && !sibling; // в файле вовсе нет номеров счетов (таблица LYNX): сверяем по аукциону и лотам
  if (!hitByNumber && (!byInv.has("") || noInvoiceRows) && aucPurchases.length > 0) {
    const all = [...byInv.values()].flat();
    const fileSum = all.reduce((s, i) => s + (unitAt(i) || 0) * t.qtys[i], 0);
    fileTotalAll += fileSum;
    notes.push(`${noInvoiceRows ? "в файле нет номеров счетов" : `номера счетов аукциона в файле (${[...byInv.keys()].join(", ")}) не совпадают с номером счёта в закупке (${aucPurchases.map((pp) => pp.invoiceNumber).join(", ")})`}; сверено по аукциону «${aucPurchases[0].auction?.name}» и лотам`);
    compare(`аукцион ${aucPurchases[0].auction?.name}`, all, aucPurchases, fileSum);
  } else {
    for (const [inv, idxs] of byInv) {
      const fileSum = idxs.reduce((s, i) => s + (unitAt(i) || 0) * t.qtys[i], 0);
      fileTotalAll += fileSum;
      if (!inv) { reasons.push("в файле есть лоты без номера счёта"); continue; }
      const cand = purchases.filter((pp) => normS(pp.invoiceNumber) === normS(inv));
      if (cand.length !== 1) {
        const byAuc = fileAuc ? purchases.filter((pp) => aKey(pp.auction?.name ?? "") === fileAuc) : [];
        reasons.push(`счёт ${inv}: закупок с таким номером у нас ${cand.length}${cand.length ? ` (${cand.map((c) => c.number).join(", ")})` : ""}${byAuc.length ? `; по этому аукциону есть закупки ${byAuc.map((pp) => `${pp.number} (счёт ${pp.invoiceNumber})`).join(", ")}` : ""}`);
        invoices.push({ inv, purchase: null, fileTotal: fileSum, ourTotal: 0, maxHide: 0 });
        continue;
      }
      compare(`счёт ${inv}`, idxs, cand, fileSum);
    }
  }
  const ft = invoices.reduce((s, x) => s + x.fileTotal, 0), ot = invoices.reduce((s, x) => s + x.ourTotal, 0);
  const prelim = /предварит|(^|\s)план(\s|$)/i.test(`${title} ${basename(f)} ${o.mail?.subject ?? ""}`);
  let category = "differs";
  if (reasons.some((x) => /без номера счёта/.test(x)) && !invoices.length) category = "no-invoice";
  else if (reasons.some((x) => /закупок с таким номером/.test(x))) category = "no-purchase";
  const diffPct = ot ? (ft - ot) / ot : NaN;
  if (reasons.length && prelim && Number.isFinite(diffPct) && Math.abs(diffPct) * 100 > 0.005) {
    category = "prelim";
    reasons.unshift(`предварительный расчёт, отличается от закупки на ${(diffPct >= 0 ? "+" : "−") + Math.abs(diffPct * 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}% (файл ${money(ft)}, закупка ${money(ot)})`);
  }
  const ok = reasons.length === 0 && purchaseIds.length > 0;
  const cause = KNOWN_CAUSES.find(([k]) => f.includes(k))?.[1];
  if (!ok && cause) reasons.unshift(`ПРИЧИНА: ${cause}`);
  return { ...base, payload: pay, status: ok ? "MATCH" : "NO", category: ok ? "match" : category, reasons: [...new Set(reasons)], purchaseIds, totals: `лотов ${r.added}, шкур ${t.qty}, итого ${money(fileTotalAll || t.totalRub)} ₽`, valueFromFile, invoices, fileTotalAll, invoiceFromMail, ...(notes.length ? { totals: `лотов ${r.added}, шкур ${t.qty}, итого ${money(fileTotalAll || t.totalRub)} ₽ · ${notes[0]}` } : {}), ...(Object.keys(v).length ? {} : {}) };
}

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:wellmekh-history");
  const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
  say(`База: ${dbName}${APPLY ? " · ЗАПИСЬ" : " · пробный прогон (ничего не меняется)"}`);
  if (APPLY && dbName === "fur_erp" && !LIVE) throw new Error("Это боевая база fur_erp: сначала проверьте на копии; на боевой — только с явным --live после согласия владельца");

  const user = await prisma.user.findFirstOrThrow({ where: { email: SUPPLIER_EMAIL, role: "SUPPLIER" }, select: { id: true, organizationId: true, supplierId: true } });
  const orgId = user.organizationId, supplierId = user.supplierId!;
  const owner = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId, role: "OWNER", isActive: true }, select: { id: true } });

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
    say(`Откат: удалить записей ${j.created.length}, вернуть ТЗ ${j.tzUpdated.length}`);
    if (!APPLY) return say("пробный откат — добавьте --apply");
    const { removeStoredFiles } = await import("../src/lib/fitting-files");
    for (const id of j.created) await prisma.supplierInbox.deleteMany({ where: { id, organizationId: orgId } });
    for (const t of j.tzUpdated) await prisma.supplierInbox.update({ where: { id: t.id }, data: { status: t.before.status as never, createdEntityType: t.before.createdEntityType, createdEntityId: t.before.createdEntityId, decidedAt: t.before.decidedAt ? new Date(t.before.decidedAt) : null, decidedById: t.before.decidedById, sentAt: t.before.sentAt ? new Date(t.before.sentAt) : null } });
    await removeStoredFiles(j.files);
    return say("откат выполнен");
  }

  // ───────── наши закупки Веллмеха
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: orgId, supplierId },
    select: { id: true, number: true, invoiceNumber: true, auction: { select: { name: true } }, auctionSession: true, status: true, items: { select: { lotNumber: true, quantity: true, costPlan: true, lot: { select: { unitCost: true } } } } },
  });
  const mails = mailInfos();
  const already = new Set((await prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId, note: { startsWith: "история:" } }, select: { note: true } })).map((x) => x.note));

  // ───────── 1. расчёты
  say("\n══════════ РАСЧЁТЫ АУКЦИОНОВ ══════════");
  say(`Допуски: на шкуру ±${TOL.toFixed(2)} ₽ (округление частей в нашей закупке); на счёт ±${TOL_INV.toFixed(2)} ₽ или ${TOL_ROUND} ₽ × число шкур в счёте, что больше (сумма округлений цен шкур до копейки); больше — расхождение. Ручные ячейки «значение из файла» допустимы, если равны закупке в этих допусках.`);
  const files = [...listWorkbooks(join(MAIL, "attachments")), join(DOWNLOADS, "расчет закупки СП 09-26.xlsx")].filter((f) => existsSync(f) && (!ONLY || f.includes(ONLY)));
  const seen = new Set<string>();
  const finds: CalcFind[] = [];
  for (const f of files) {
    const buf = readFileSync(f);
    const md5 = createHash("md5").update(buf).digest("hex");
    if (seen.has(md5)) continue;
    seen.add(md5);
    if (!(await isCalcWorkbook(buf))) continue;
    let sheets: string[][][];
    const t0 = Date.now();
    if (DEBUG) console.log(`   [читаю] ${f.replace(homedir(), "~").slice(-60)} ${buf.length} байт`);
    try { sheets = await parseXlsxSheets(buf, 1_500_000); } catch { continue; }
    if (DEBUG) console.log(`   [файл] ${f.replace(homedir(), "~").slice(-60)} листов ${sheets.length}, ${Date.now() - t0} мс`);
    const eml = emlOf(f);
    const mi = mails.get(eml);
    const siblingInvoices = [...new Set(existsSync(dirname(f)) ? readdirSync(dirname(f)).map((n) => /Счет на оплату\s*№\s*(\d+)/i.exec(n)?.[1]).filter((x): x is string => !!x) : [])];
    let blockNo = 0;
    for (const table of sheets) {
      for (const blk of splitBlocks(table)) {
        const bi = blockNo++;
        const fm = FORMATS.find(([re]) => re.test(blk.title));
        if (!fm) continue;
        if (DEBUG) console.log(`   [блок] ${f.replace(homedir(), "~").slice(-70)} #${bi} «${blk.title.slice(0, 40)}» строк ${blk.table.length}`);
        // у одного аукциона бывает несколько раскладок файла (предварительная и итоговая): берём ту, что совпала, иначе ту, где меньше причин
        const cands = (Array.isArray(fm[1]) ? fm[1] : [fm[1]]).map((presetId) => evaluateBlock({ f, md5, blockNo: bi, label: blk.label, title: blk.title, presetId, table: blk.table, siblingInvoices, mail: mi, purchases }));
        const find = cands.find((c) => c.status === "MATCH") ?? cands.slice().sort((a, b) => a.reasons.length - b.reasons.length)[0];
        finds.push(find);
      }
    }
  }

  // версии одного аукциона: окончательная — та, что совпала с нашей закупкой; остальные версии не создаём
  const keyOf = (f: CalcFind) => f.purchaseIds.slice().sort().join("|");
  const byKey = new Map<string, CalcFind[]>();
  for (const f of finds) if (f.status === "MATCH") (byKey.get(keyOf(f)) ?? byKey.set(keyOf(f), []).get(keyOf(f))!).push(f);
  for (const list of byKey.values()) {
    list.sort((a, b) => (b.sent?.getTime() ?? 0) - (a.sent?.getTime() ?? 0));
    for (const old of list.slice(1)) { old.status = "NO"; old.category = "superseded"; old.reasons = [`та же закупка уже есть в более свежей версии файла (письмо от ${list[0].sent ? list[0].sent.toLocaleDateString("ru-RU") : "—"}); дубль не создаём`]; }
  }
  for (const f of finds) {
    if (f.status === "MATCH") continue;
    const same = finds.find((g) => g.status === "MATCH" && g.auctionKey === f.auctionKey && g !== f);
    if (same) { f.category = f.category === "superseded" ? f.category : "earlier-version"; f.reasons.unshift(`более ранняя версия расчёта (письмо ${f.sent ? f.sent.toLocaleDateString("ru-RU") : "—"}); окончательная версия — ${same.file === f.file ? `блок «${same.label || "факт"}» этого же файла` : `файл от ${same.sent ? same.sent.toLocaleDateString("ru-RU") : "—"}`}, она совпала с закупкой`); }
  }

  const fmtPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
  for (const f of finds) {
    say(`\n${f.status === "MATCH" ? "✔ СОВПАЛО" : "✘ не создаём"}  ${f.title.slice(0, 60)}${f.label ? ` [${f.label}]` : ""}  [формат ${f.preset}]  ${f.totals}`);
    say(`   файл: ${f.file.replace(homedir(), "~")}${f.sent ? ` · письмо от ${f.sent.toLocaleDateString("ru-RU")}` : ""}`);
    if (f.valueFromFile) say(`   значения из файла (ручные ячейки, равны закупке в допуске): ${f.valueFromFile}`);
    if (f.status === "MATCH") say(`   закупки: ${f.purchaseIds.map((id) => purchases.find((p) => p.id === id)!.number).join(", ")}${already.has(noteOf(f)) ? " · уже заведено ранее" : ""}`);
    else for (const x of f.reasons.slice(0, 8)) say(`   · ${x}`);
    if (f.status !== "MATCH" && f.reasons.length > 8) say(`   · …ещё причин: ${f.reasons.length - 8}`);
    if (f.invoices.length) for (const iv of f.invoices) say(`   ${iv.inv}${iv.purchase ? ` → ${iv.purchase}` : " → закупки нет"}: файл ${money(iv.fileTotal)}, закупка ${money(iv.ourTotal)}, разница ${iv.ourTotal ? money(iv.fileTotal - iv.ourTotal) : "—"} ₽${iv.ourTotal ? ` (${fmtPct((iv.fileTotal - iv.ourTotal) / iv.ourTotal)})` : ""}, макс. на шкуру ${iv.maxHide.toFixed(3)}`);
  }
  const noFile = [...new Set(purchases.map((p) => p.auction?.name ?? p.auctionSession ?? "").filter(Boolean))].filter((a) => !finds.some((f) => f.status === "MATCH" && f.purchaseIds.some((id) => purchases.find((p) => p.id === id)?.auction?.name === a)));
  say(`\nАукционы с закупками, для которых расчёта-файла среди писем нет (или он не совпал): ${noFile.join("; ") || "—"}`);

  say("\n══════════ СВОДКА ПО РАСЧЁТАМ ══════════");
  say("аукцион (файл, письмо) | итог файла | итог закупки | расхождение | решение");
  for (const f of finds) {
    const ft = f.invoices.reduce((s, x) => s + x.fileTotal, 0), ot = f.invoices.reduce((s, x) => s + x.ourTotal, 0);
    const matched = f.invoices.some((x) => x.purchase);
    say(`${f.title.slice(0, 40)}${f.label ? ` [${f.label}]` : ""} (${basename(f.file).replace(/__[0-9a-f]{12}.*$/, "").slice(0, 32)}, ${f.sent ? f.sent.toLocaleDateString("ru-RU") : "—"}) | ${matched ? money(ft) : f.fileTotalAll ? money(f.fileTotalAll) : "—"} | ${matched ? money(ot) : "—"} | ${matched && ot ? `${money(ft - ot)} (${fmtPct((ft - ot) / ot)})` : "—"} | ${f.status === "MATCH" ? "СОЗДАН" : "нет"}: ${f.status === "MATCH" ? `совпал с закупкой${f.valueFromFile ? " (часть значений из файла)" : ""}` : f.reasons.slice(0, 2).join(" · ").slice(0, 700)}`);
  }

  // ───────── 2. ТЗ
  say("\n══════════ ТЗ (Word) ══════════");
  const docx = [...walk(DOWNLOADS, /\.docx$/i).filter((f) => !f.includes("/MEH_PST_EXTRACT/") && /ПРИЛОЖЕНИЕ|Приложение/.test(basename(f))), ...walk(join(MAIL, "attachments"), /\.docx$/i), ...walk(join(__dirname, "..", "uploads"), /\.docx$/i)];
  const seenDoc = new Set<string>();
  type TzFind = { file: string; md5: string; p: TzPayload; td: number; ld: number; positions: string[]; reason: string };
  const tzs: TzFind[] = [];
  for (const f of docx) {
    const buf = readFileSync(f);
    const md5 = createHash("md5").update(buf).digest("hex");
    if (seenDoc.has(md5)) continue;
    seenDoc.add(md5);
    let blocks; try { blocks = await docxBlocks(buf); } catch { continue; }
    const first = (blocks.find((b) => b[0] === "P") as ["P", string] | undefined)?.[1] ?? "";
    if (!/приложение\s*№\s*\d+/i.test(first)) continue;
    let p: TzPayload;
    try { p = await payloadFromDocx(buf); } catch { say(`\n✘ ${basename(f).slice(0, 60)}: другой вид документа — разобрать не удалось (не создаём)`); continue; }
    const gen = await buildTzDocx(p);
    const td = textDiff(blocks, await docxBlocks(gen)).length, ld = (await layoutDiff(buf, gen)).length;
    const pos = await prisma.productionOrder.findMany({ where: { organizationId: orgId, workOrderNumber: p.number }, select: { id: true, plannedQuantity: true } });
    let reason = "";
    if (td || ld) reason = `Word, собранный по данным, не совпал с оригиналом: текст ${td}, вёрстка ${ld} расхождений`;
    else if (pos.length === 0) reason = `ТЗ № ${p.number} нет у нас`;
    else if (pos.length !== p.items.length || pos.reduce((a, x) => a + Number(x.plannedQuantity), 0) !== tzTotals(p).qty) reason = `позиций у нас ${pos.length}, в ТЗ ${p.items.length}; изделий у нас ${pos.reduce((a, x) => a + Number(x.plannedQuantity), 0)}, в ТЗ ${tzTotals(p).qty}`;
    tzs.push({ file: f, md5, p, td, ld, positions: pos.map((x) => x.id), reason });
  }
  tzs.sort((a, b) => Number(a.p.number) - Number(b.p.number) || Number(!!a.reason) - Number(!!b.reason));
  // один и тот же ТЗ мог прийти несколько раз (письмо, Диск): оставляем одну запись на номер, точную — в приоритете
  for (let i = tzs.length - 1; i > 0; i--) if (tzs[i].p.number === tzs[i - 1].p.number && tzs[i].p.date === tzs[i - 1].p.date) tzs.splice(i, 1);
  for (const t of tzs) say(`${t.reason ? "✘ не создаём" : "✔ ТОЧНО   "}  ТЗ № ${t.p.number} от ${t.p.date}: изделий ${tzTotals(t.p).qty}${t.reason ? ` — ${t.reason}` : ` — у нас позиций ${t.positions.length}`}  [${basename(t.file).slice(0, 48)}]`);

  // ───────── запись
  const toCalc = finds.filter((f) => f.status === "MATCH" && !already.has(noteOf(f)));
  const toTz = tzs.filter((t) => !t.reason);
  say(`\nИтого к созданию: расчётов ${toCalc.length}, ТЗ ${toTz.length}${REPORT ? "" : ""}`);
  if (REPORT) writeFileSync(REPORT, out.join("\n"));
  if (!APPLY) return say("пробный прогон: БД не тронута (--apply запишет; на боевой нужен ещё --live после согласия владельца)");
  if (LIVE) execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });

  const { readDocumentFiles, writeDocumentFiles } = await import("../src/lib/purchase-files");
  const journal: Journal = existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal) : { created: [], tzUpdated: [], files: [] };
  for (const f of toCalc) {
    const p = f.payload;
    p.stage = "FINAL";
    const t = calcAll(p);
    const inv = [...new Set(p.rows.map((r) => r.invoice).filter(Boolean))];
    p.header.invoice = inv.join(", ") || f.invoiceFromMail;
    p.header.auction = p.header.auction || f.title.replace(/\(.*$/, "").replace(/^(план|факт)\s+/i, "").trim();
    const row = await prisma.supplierInbox.create({
      data: {
        organizationId: orgId, supplierId, createdById: user.id, kind: "AUCTION_CALC", status: "ACCEPTED", title: `${p.header.auction} · счёт ${p.header.invoice}`.slice(0, 160),
        payload: { ...p, totals: { qty: t.qty, totalRub: Math.round(t.totalRub * 100) / 100 } } as never,
        note: noteOf(f), sentAt: f.sent ?? new Date(), decidedAt: f.sent ?? new Date(), decidedById: owner.id,
        createdEntityType: "Purchase", createdEntityId: f.purchaseIds.join(","),
      },
    });
    journal.created.push(row.id);
    const read = await readDocumentFiles([new File([new Uint8Array(readFileSync(f.file))], basename(f.file).replace(/__[0-9a-f]{12}/, "").replace(/(?<!\.xlsx)$/, ".xlsx"), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })]);
    if (!("error" in read)) {
      const stored = await writeDocumentFiles(orgId, `supplier-inbox/${row.id}`, read.files);
      await prisma.supplierInboxFile.createMany({ data: stored.map((d) => ({ inboxId: row.id, storagePath: d.storagePath, originalName: d.originalName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, kind: "OTHER" as never })) });
      journal.files.push(...stored.map((d) => d.storagePath));
    }
    say(`создан расчёт ${row.id}: ${row.title}`);
  }
  for (const tz of toTz) {
    const title = `ТЗ № ${tz.p.number} от ${tz.p.date.split("-").reverse().join(".")}`;
    const ex = await prisma.supplierInbox.findFirst({ where: { organizationId: orgId, supplierId, kind: "TZ", title: { contains: `№ ${tz.p.number}` } } });
    const entity = { createdEntityType: "ProductionOrder", createdEntityId: tz.positions.join(",") };
    const sent = new Date(`${tz.p.date}T12:00:00Z`);
    if (ex) {
      if (ex.status === "ACCEPTED") { say(`ТЗ ${tz.p.number}: уже принято ранее — пропущено`); continue; }
      journal.tzUpdated.push({ id: ex.id, before: { status: ex.status, createdEntityType: ex.createdEntityType, createdEntityId: ex.createdEntityId, decidedAt: ex.decidedAt?.toISOString() ?? null, decidedById: ex.decidedById, sentAt: ex.sentAt?.toISOString() ?? null } });
      await prisma.supplierInbox.update({ where: { id: ex.id }, data: { status: "ACCEPTED", sentAt: ex.sentAt ?? sent, decidedAt: sent, decidedById: owner.id, ...entity } });
      say(`ТЗ ${tz.p.number}: существующий черновик ${ex.id} → «Принято», связан с нашими позициями (${tz.positions.length})`);
    } else {
      const row = await prisma.supplierInbox.create({ data: { organizationId: orgId, supplierId, createdById: user.id, kind: "TZ", status: "ACCEPTED", title, payload: { ...tz.p, totals: { qty: tzTotals(tz.p).qty } } as never, note: `история:${tz.md5}`, sentAt: sent, decidedAt: sent, decidedById: owner.id, ...entity } });
      journal.created.push(row.id);
      say(`создано ТЗ ${row.id}: ${title}`);
    }
  }
  mkdirSync(join(__dirname, "..", "docs-inventory"), { recursive: true });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  say(`журнал: ${JOURNAL}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
