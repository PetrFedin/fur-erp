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
  // Как в нашем справочнике видов меха: песец, чернобурка и лиса — «Лиса» (изделия из «ARCTIC FOX» сшиты из нашей лисы, песца в сырье нет); каракуль, каракульча и бродтейл — свакара.
  if (/^AR(C)?TIC/.test(f)) return "FOX";
  if (/^(SILVER FOX|FOX)\b/.test(f)) return "FOX";
  if (/^(KARAKUL|KARAKULCHA|BROADTAIL|SWAKARA)\b/.test(f)) return "SWAKARA";
  if (/^WILD SABLE/.test(f)) return "SABLE";
  return f.split(/[\s+/]/)[0];
}

/** Цвет из выгрузки без хвоста-кода и с общими написаниями («CLOUD 239264» → CLOUD, LAVANDER → LAVENDER, BLACKGLAMA → BLACK GLAMA). */
export function colorOfLine(c: string | null | undefined): string {
  const v = (c ?? "").toUpperCase().replace(/\s+\d+$/, "").trim();
  if (!v) return "Не указан";
  return v === "LAVANDER" ? "LAVENDER" : v === "BLACKGLAMA" ? "BLACK GLAMA" : v;
}

/**
 * Сезон строки по дате (правило владельца): SS — с февраля по июль («SS 2026»), FW — с августа по январь («FW 25/26»: август 2025 – январь 2026).
 * Сезон из файла выгрузки не используется: он расходится с датами движения.
 */
export function seasonOfDate(iso: string): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  if (m >= 2 && m <= 7) return `SS ${y}`;
  const fy = m >= 8 ? y : y - 1;
  return `FW ${String(fy).slice(2)}/${String(fy + 1).slice(2)}`;
}

/**
 * Сезоны строк выгрузки: приход — по своей дате (seasonOfDate); продажа и возврат относятся к сезону партии, из которой
 * продали (FIFO: сначала расходуется самый старый приход артикула и цвета), чтобы продано, остаток и sell-through
 * сезона считались по одной коллекции и остаток сезона не уходил в минус. Продажа, которая охватывает два прихода,
 * делится на две строки (штуки и суммы — пропорционально). Отрицательный приход уменьшает самую раннюю партию с остатком.
 * Нет прихода — сезон по дате самой строки.
 */
/** Сезон прихода: сезон товара из выгрузки («FW 25/26», «SS 2026», «FW 26/27»), если он указан; иначе по дате прихода. */
const seasonOfLine = (l: { iso: string; season: string }) => (/^(FW|SS)\s?\d/i.test((l.season ?? "").trim()) ? l.season.trim().replace(/^(FW|SS)(\d)/i, "$1 $2") : seasonOfDate(l.iso));

export function assignSeasons<T extends { id?: string; kind: string; iso: string; article: string; colorId: string | null; pcs: number; season: string }>(lines: T[]): T[] {
  const keyOf = (l: T) => l.article + "|" + (l.colorId ?? "");
  const groups = new Map<string, T[]>();
  for (const l of lines) { const k = keyOf(l); const g = groups.get(k); if (g) g.push(l); else groups.set(k, [l]); }
  const out = new Map<T, T[]>();
  for (const g of groups.values()) {
    const sorted = [...g].sort((x, y) => (x.iso < y.iso ? -1 : x.iso > y.iso ? 1 : (x.kind === "RECEIPT" ? 0 : 1) - (y.kind === "RECEIPT" ? 0 : 1)));
    const firstRec = sorted.find((l) => l.kind === "RECEIPT" && l.pcs > 0);
    const queue: { season: string; left: number }[] = [];
    let lastSeason = firstRec ? seasonOfLine(firstRec) : null;
    for (const l of sorted) {
      if (l.kind === "RECEIPT" && l.pcs > 0) {
        const season = seasonOfLine(l);
        queue.push({ season, left: l.pcs }); lastSeason = season;
        out.set(l, [{ ...l, season }]);
        continue;
      }
      if (l.kind === "RECEIPT") {
        // Отрицательный приход (корректировка): уменьшает самую раннюю партию, где ещё есть что снять.
        let need = -l.pcs;
        const q = queue.find((x) => x.left > 0);
        const season = q?.season ?? (firstRec ? seasonOfLine(firstRec) : seasonOfDate(l.iso));
        for (const x of queue) { if (need <= 0) break; const t = Math.min(x.left, need); x.left -= t; need -= t; }
        out.set(l, [{ ...l, season }]);
        continue;
      }
      if (l.pcs <= 0) { out.set(l, [{ ...l, season: queue.find((x) => x.left > 0)?.season ?? lastSeason ?? seasonOfDate(l.iso) }]); continue; }
      // Продажа: списываем с самых старых партий; хвост сверх остатка уходит в сезон последней партии.
      const parts: { season: string; pcs: number }[] = [];
      let need = l.pcs;
      for (const x of queue) {
        if (need <= 0) break;
        if (x.left <= 0) continue;
        const t = Math.min(x.left, need);
        x.left -= t; need -= t;
        const last = parts[parts.length - 1];
        if (last && last.season === x.season) last.pcs += t; else parts.push({ season: x.season, pcs: t });
      }
      if (need > 0) {
        const season = lastSeason ?? seasonOfDate(l.iso);
        const last = parts[parts.length - 1];
        if (last && last.season === season) last.pcs += need; else parts.push({ season, pcs: need });
      }
      if (parts.length === 1) { out.set(l, [{ ...l, season: parts[0].season }]); continue; }
      out.set(l, parts.map((pt, i) => {
        const k = pt.pcs / l.pcs;
        const c: Record<string, unknown> = { ...l, season: pt.season, pcs: pt.pcs };
        for (const [f, v] of Object.entries(l)) if (/^(retail|discount)/.test(f) && typeof v === "number") c[f] = v * k;
        if (typeof l.id === "string") c.id = `${l.id}#${i + 1}`;
        return c as T;
      }));
    }
  }
  return lines.flatMap((l) => out.get(l) ?? [l]);
}

/** Первый день сезона: SS YYYY → 1 февраля, FW YY/YY+1 → 1 августа первого года. */
export function seasonStartIso(season: string): string | null {
  const ss = /^SS\s+(\d{4})$/.exec(season.trim());
  if (ss) return `${ss[1]}-02-01`;
  const fw = /^FW\s+(\d{2})\/(\d{2})$/.exec(season.trim());
  return fw ? `20${fw[1]}-08-01` : null;
}

/** Последний день сезона: SS YYYY → 31 июля, FW YY/YY+1 → 31 января второго года. */
export function seasonEndIso(season: string): string | null {
  const ss = /^SS\s+(\d{4})$/.exec(season.trim());
  if (ss) return `${ss[1]}-07-31`;
  const fw = /^FW\s+(\d{2})\/(\d{2})$/.exec(season.trim());
  return fw ? `20${fw[2]}-01-31` : null;
}
