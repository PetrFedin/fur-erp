// Поступления товара и продажи (выгрузка «поступления и продажи»): разбор строк файла и ключи. Чистые функции без БД.

export type SalesLineKindT = "RECEIPT" | "SALE";

/** Кириллица, похожая на латиницу (в базе встречается «М029», «МН11»): приводим к латинице. */
const CYR: Record<string, string> = { "М": "M", "Н": "H", "А": "A", "В": "B", "С": "C", "Е": "E", "К": "K", "Р": "P", "Т": "T", "Х": "X", "О": "O" };

/** Нормализованный код: верхний регистр, кириллица-двойник → латиница, без пробелов и дефисов. «MH-07» → «MH07», «М029» → «M029». */
export function normCode(s: string): string {
  return s.toUpperCase().replace(/[А-ЯЁ]/g, (c) => CYR[c] ?? c).replace(/[\s\-_]+/g, "");
}

/** Код модели из начала артикула файла: «M001A/SABLE…» → M001A, «MSC-02 WILD SABLE SIL 3» → MSC02, «MH-07 SABLE» → MH07. Нет похожего кода — null. */
export function modelCodeOfArticle(article: string): string | null {
  const m = /^\s*([A-ZА-Я]{1,4}[\s-]?\d{1,3}[A-ZА-Я]?)(?=$|[\s/])/i.exec(article);
  return m ? normCode(m[1]) : null;
}

/** «20.09.2025 (Суббота)» → «2025-09-20». */
export function isoOfFileDay(s: string): string | null {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export type RawSheetRow = (string | number | null)[];
export type ParsedLine = {
  sourceKey: string; kind: SalesLineKindT; orderNo: string; season: string; article: string; fabric: string | null; colorId: string | null;
  modelCode: string | null; level2: string | null; level3: string | null; level4: string | null; level5: string | null; iso: string; pcs: number | null;
  retailEur: number | null; retailEurExVat: number | null; retailRub: number | null; retailRubExVat: number | null;
  discountEur: number | null; discountEurExVat: number | null; discountRub: number | null; discountRubExVat: number | null;
};

const s = (v: unknown) => (v == null || v === "" ? null : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Строка листа → запись. Колонки по шапке: 0 заказ, 1 сезон, 2 Article, 3 Fabric, 4 OrderColorID, 8–11 Level 02–05, 14 День, 15 штуки, 16–23 суммы (продажи). */
export function parseSheetRow(kind: SalesLineKindT, r: RawSheetRow): ParsedLine | null {
  if (!r[0] || r[0] === "Общий итог") return null;
  const iso = isoOfFileDay(String(r[14] ?? ""));
  if (!iso) return null;
  const article = String(r[2]);
  const sale = kind === "SALE";
  return {
    sourceKey: [kind, r[0], article, r[4] ?? "", iso].join("|"), kind, orderNo: String(r[0]), season: String(r[1]), article, fabric: s(r[3]), colorId: s(r[4]),
    modelCode: modelCodeOfArticle(article), level2: s(r[8]), level3: s(r[9]), level4: s(r[10]), level5: s(r[11]), iso, pcs: n(r[15]),
    retailEur: sale ? n(r[16]) : null, retailEurExVat: sale ? n(r[17]) : null, retailRub: sale ? n(r[18]) : null, retailRubExVat: sale ? n(r[19]) : null,
    discountEur: sale ? n(r[20]) : null, discountEurExVat: sale ? n(r[21]) : null, discountRub: sale ? n(r[22]) : null, discountRubExVat: sale ? n(r[23]) : null,
  };
}

/** Категория строки: по Level 02 файла («Одежда» / «Аксессуары»), иначе «прочее» (нет категории). */
export type CatClass = "clothes" | "acc" | "other";
export const CAT_LABEL: Record<CatClass | "all", string> = { all: "Всё", clothes: "Одежда", acc: "Аксессуары", other: "Прочее" };
export function classOfLevel2(level2: string | null | undefined): CatClass {
  const v = (level2 ?? "").trim().toLowerCase();
  return v === "одежда" ? "clothes" : v === "аксессуары" ? "acc" : "other";
}
/** Группа категории модели в системе (CategoryRef.group: «Одежда» / «Аксессуары») → класс. */
export const classOfGroup = classOfLevel2;

/** Строка для агрегатов (из БД или файла). */
export type SalesAggLine = { kind: SalesLineKindT; iso: string; pcs: number; retailRub: number; retailRubExVat: number; discountRub: number; cls: CatClass; season: string; article: string };

/**
 * Строки продаж «только скидка» (заказ 155627 в «поступления и продажи 2.xlsx»: 18 строк, штуки и розница пусты: у 12 есть скидка 2 450 163,87 ₽ с НДС, у 6 — нули).
 * Что установлено по документам (20.10.2026):
 *  • в выгрузке «Sales Retail» — чистая выручка ПОСЛЕ скидки, «Discount» — уже вычтенная скидка (справочно); у этих строк выручки и штук нет, значит денег они не несут;
 *  • заказ 155627 есть только в «поступления и продажи 2.xlsx»: в первой версии файла (243 строки продаж) его нет, в «отчёте по товарам» (фильтр заказов 147621, 157488, 157525, 158123) он исключён;
 *    поступлений по нему нет (старый заказ), итоги штук и выручки в обеих версиях файла одинаковы (232 шт., 353 888 049 ₽).
 * Правило: в «Получено» и «Продано» такие строки НЕ входят (в них нет ни штук, ни розницы: вклад 0 при любом выборе); их скидка остаётся в сумме «Скидки» (Σ скидки = «Общий итог» файла 23 039 416,28),
 * но к конкретным продажам её привязать нельзя. Что это — отмена скидки, корректировка цены или подарок — документы не говорят однозначно (< 95 %), поэтому в «Скидку, % от розницы» их
 * включать или нет — решение после ответа автора выгрузки (см. отчёт). Функция лишь опознаёт такие строки (для тестов и пометки в интерфейсе).
 */
export function isDiscountOnlyLine(l: { kind: SalesLineKindT; pcs: number | null | undefined; retailRub: number | null | undefined; discountRub?: number | null }): boolean {
  return l.kind === "SALE" && !l.pcs && !l.retailRub;
}

/** Вариант артикула (часть после кода модели): «M001A/SABLE WILD SILVER 4-5» → «SABLE WILD SILVER 4-5»; как у фото артикулов. */
export function variantOfArticle(article: string): string {
  return article.replace(/^\s*[A-Za-zА-Яа-я]{1,4}[\s-]?\d{1,3}[A-Za-zА-Яа-я]?(?=$|[\s/])/, "").replace(/^[\s/]+/, "").trim();
}

/** Тип меха по названию ткани: первое слово («SABLE WILD…» → SABLE), «ARCTIC/ARTIC FOX» → ARCTIC FOX, «SILVER FOX», «WILD SABLE» → SABLE. */
export function furTypeOfFabric(fabric: string | null | undefined): string {
  const f = (fabric ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!f) return "Не указан";
  if (/^ART?CTIC FOX/.test(f)) return "ARCTIC FOX";
  if (/^SILVER FOX/.test(f)) return "SILVER FOX";
  if (/^WILD SABLE/.test(f)) return "SABLE";
  return f.split(/[\s+/]/)[0];
}

/** Цвет из выгрузки без хвоста-кода и с общими написаниями («CLOUD 239264» → CLOUD, LAVANDER → LAVENDER, BLACKGLAMA → BLACK GLAMA). */
export function colorOfLine(c: string | null | undefined): string {
  const v = (c ?? "").toUpperCase().replace(/\s+\d+$/, "").trim();
  if (!v) return "Не указан";
  return v === "LAVANDER" ? "LAVENDER" : v === "BLACKGLAMA" ? "BLACK GLAMA" : v;
}
