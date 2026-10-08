// Мастер «Загрузить ТЗ»: разбор файлов, вставленной таблицы и текста в черновики ТЗ. Чистые функции, без базы и без server-only
// (используются и сервером, и формой, и scripts/test-tz-import.ts). Ничего не пишут: результат — черновики для правки в таблице.

/** Черновик одного ТЗ: все поля — строки, как их видит и правит человек. */
export type TzDraft = {
  key: string;
  source: string;
  number: string;
  article: string;
  /** «Чёрный» или «Тёмно-синий ×2 (42, 46); Чёрный ×1 (42)». */
  colors: string;
  /** «44×2, 46×3» или «44, 46». */
  sizes: string;
  qty: string;
  batch: string;
  client: string;
  /** Цена работы за единицу, ₽. */
  price: string;
  /** Сумма расчёта из документа (для сверки со списаниями), ₽. */
  calcTotal: string;
  /** Материалы построчно: «лот количество [4%|без4]». */
  materials: string;
};

export const emptyDraft = (source = "вручную", key = ""): TzDraft => ({
  key: key || Math.random().toString(36).slice(2, 9),
  source,
  number: "",
  article: "",
  colors: "",
  sizes: "",
  qty: "",
  batch: "",
  client: "",
  price: "",
  calcTotal: "",
  materials: "",
});

/** Число из текста: пробелы (в т.ч. неразрывные) убираем, запятая -> точка; пусто/мусор -> NaN. */
export function toNum(s: string | null | undefined): number {
  const t = String(s ?? "").replace(/[\s  ]/g, "").replace("₽", "").replace(",", ".");
  return t !== "" && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

// ---------- размеры и цвета ----------

export type SizeQty = { size: string; qty: number };

/** «44×2, 46×3» -> [{44,2},{46,3}]; «44, 46» -> по одному; «единый» -> одна позиция «единый» (количество 1). */
export function parseSizeQty(text: string): SizeQty[] {
  const out: SizeQty[] = [];
  for (const part of text.split(/[;,]+/)) {
    const t = part.trim();
    if (!t) continue;
    const m = /^([\wА-Яа-яЁё.*]+?)\s*(?:[×xхХX:]|\s-\s)\s*(\d{1,5})$/.exec(t);
    if (m) out.push({ size: m[1], qty: Number(m[2]) });
    else out.push({ size: t, qty: 1 });
  }
  return out;
}

export function sizesTotal(text: string): number {
  return parseSizeQty(text).reduce((s, x) => s + x.qty, 0);
}

export type ColorQty = { name: string; qty: number | null; sizes: string | null };

/** «Тёмно-синий ×2 (42, 46); Чёрный ×1 (42)» -> три поля; один цвет без количества — просто название. */
export function parseColors(text: string): ColorQty[] {
  const out: ColorQty[] = [];
  for (const part of text.split(/;|\n/)) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(.*?)\s*(?:[×xхХX]\s*(\d{1,6}))?\s*(?:\(([^)]*)\))?$/.exec(t);
    const name = (m?.[1] ?? t).trim();
    if (!name) continue;
    out.push({ name, qty: m?.[2] ? Number(m[2]) : null, sizes: m?.[3]?.trim() || null });
  }
  return out;
}

// ---------- материалы ----------

export type MaterialLine = { line: number; lot: string; qty: number; c4: boolean | null };

/** «300687 12,5», «300687; 12,5; 4%», «лот 300687 — 12,5 без4». Ошибки — по строкам, ничего не угадываем. */
export function parseMaterialLines(text: string): { lines: MaterialLine[]; errors: string[] } {
  const lines: MaterialLine[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t) return;
    const n = i + 1;
    let c4: boolean | null = null;
    let rest = t;
    if (/(?:^|[\s;\t])(?:без\s*4\s*%?|0\s*%|нет4|-4)\s*$/i.test(rest)) {
      c4 = false;
      rest = rest.replace(/(?:без\s*4\s*%?|0\s*%|нет4|-4)\s*$/i, "");
    } else if (/(?:^|[\s;\t])(?:\+?4\s*%|с\s*4\s*%?|да4)\s*$/i.test(rest)) {
      c4 = true;
      rest = rest.replace(/(?:\+?4\s*%|с\s*4\s*%?|да4)\s*$/i, "");
    }
    rest = rest.replace(/^лот\s*№?\s*/i, "").replace(/[—–]/g, " ");
    const cells = rest.split(/[\t;]+|\s+/).map((c) => c.trim()).filter(Boolean);
    if (cells.length !== 2) {
      errors.push(`строка ${n}: ожидается «лот количество», получено «${t}»`);
      return;
    }
    const q = toNum(cells[1]);
    if (!Number.isFinite(q) || q <= 0) {
      errors.push(`строка ${n}: количество «${cells[1]}» — не положительное число`);
      return;
    }
    lines.push({ line: n, lot: cells[0], qty: q, c4 });
  });
  return { lines, errors };
}

// ---------- таблица (xlsx / вставка / csv) ----------

type Col = keyof Omit<TzDraft, "key" | "source" | "materials"> | "lot" | "matQty" | "c4";
const HEADERS: [Col, RegExp][] = [
  ["number", /^(?:№\s*тз|тз\s*№?|номер\s*тз|№|номер)$/i],
  ["article", /артикул|модель|изделие/i],
  ["colors", /^цвет/i],
  ["sizes", /^размер/i],
  ["qty", /^(?:кол-?во\s*(?:изделий|шт\.?)?|количество\s*(?:изделий|шт\.?)?|шт\.?)$/i],
  ["batch", /партия|поставка/i],
  ["client", /заказчик|давалец|клиент/i],
  ["price", /цена\s*работ|стоимость\s*работ|^работа/i],
  ["calcTotal", /сумма\s*расч|итого|^сумма$/i],
  ["lot", /^лот/i],
  ["matQty", /(?:расход|кол-?во)\s*(?:меха|сырья|материала)|^(?:мех|расход|списание)/i],
  ["c4", /4\s*%/],
];

function detectHeader(rows: string[][]): { at: number; map: Map<number, Col> } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map = new Map<number, Col>();
    rows[r].forEach((cell, c) => {
      const t = cell.trim();
      if (!t) return;
      for (const [col, re] of HEADERS) {
        if (re.test(t) && ![...map.values()].includes(col)) {
          map.set(c, col);
          break;
        }
      }
    });
    if (map.size >= 2 && ([...map.values()].includes("number") || [...map.values()].includes("article") || [...map.values()].includes("lot"))) return { at: r, map };
  }
  return null;
}

const yes = (s: string) => /^(?:да|yes|y|1|\+|true|с\s*4)/i.test(s.trim());
const no = (s: string) => /^(?:нет|no|n|0|-|false|без)/i.test(s.trim());

/** Строки таблицы -> черновики. Одна строка = один материал; № ТЗ пуст — строка продолжает предыдущее ТЗ. */
export function draftsFromTable(rows: string[][], source: string): TzDraft[] {
  const clean = rows.map((r) => r.map((c) => String(c ?? "").replace(/ /g, " ").trim())).filter((r) => r.some(Boolean));
  const h = detectHeader(clean);
  const out: TzDraft[] = [];
  if (!h) {
    // без заголовка: две колонки «лот количество» -> одно ТЗ без номера
    const lines = clean.filter((r) => r.length >= 2 && Number.isFinite(toNum(r[1]))).map((r) => `${r[0]}\t${r[1]}`);
    if (lines.length) out.push({ ...emptyDraft(source), materials: lines.join("\n") });
    return out;
  }
  let cur: TzDraft | null = null;
  for (const r of clean.slice(h.at + 1)) {
    const f: Partial<Record<Col, string>> = {};
    h.map.forEach((col, c) => {
      if (r[c]) f[col] = r[c];
    });
    const startsNew = (f.number && (!cur || f.number !== cur.number)) || !cur;
    if (startsNew) {
      cur = emptyDraft(source);
      out.push(cur);
    }
    const d = cur as TzDraft;
    for (const k of ["number", "article", "colors", "sizes", "qty", "batch", "client", "price", "calcTotal"] as const) {
      if (f[k] && !d[k]) d[k] = f[k]!;
    }
    if (f.lot && f.matQty) {
      const flag = f.c4 ? (yes(f.c4) ? " 4%" : no(f.c4) ? " без4" : "") : "";
      d.materials += `${d.materials ? "\n" : ""}${f.lot}\t${f.matQty}${flag}`;
    }
  }
  return out.filter((d) => d.number || d.article || d.materials);
}

// ---------- свободный текст (docx / pdf / вставка) ----------

const grab = (t: string, re: RegExp) => re.exec(t)?.[1]?.trim().replace(/\s+/g, " ") ?? "";

/** Текст одного ТЗ (в формате «Артикул: …», «Цвет: …», строки «лот … количество») -> черновик. */
export function draftFromTextBlock(block: string, source: string): TzDraft {
  const d = emptyDraft(source);
  d.number = grab(block, /(?:тз|тех\w*\s*задани\w*)\s*(?:№|N|no\.?)\s*([\w\-/]+)/i);
  d.article = grab(block, /(?:артикул|модель|изделие)\s*[:\-–]\s*([^\n;]+)/i);
  d.colors = grab(block, /цвет[а-я]*\s*[:\-–]\s*([^\n]+)/i);
  d.sizes = grab(block, /размер[а-я]*\s*[:\-–]\s*([^\n]+)/i);
  d.qty = grab(block, /(?:кол-?во|количество)(?:\s+изделий|\s+шт\.?)?\s*[:\-–]\s*(\d[\d\s]*)/i);
  d.batch = grab(block, /(?:партия|поставка)\s*(?:№)?\s*[:\-–]?\s*(\d+)/i);
  d.client = grab(block, /(?:заказчик|давалец)\s*[:\-–]\s*([^\n]+)/i);
  d.price = grab(block, /(?:цена\s+работ[ыа]?|стоимость\s+работ[ыа]?|работа)[^\d\n]{0,30}(\d[\d\s]*[.,]?\d*)/i);
  d.calcTotal = grab(block, /(?:итого|сумма\s+расч[её]та|всего)[^\d\n]{0,20}(\d[\d\s]*[.,]?\d*)/i);
  const mats: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s*лот\s*№?\s*([\w\-/]+)[^\d\n]{0,12}(\d+(?:[.,]\d+)?)\s*(.*)$/i.exec(line) ?? /^\s*(\d{4,})\s*[\t;—–-]+\s*(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(line);
    if (m) mats.push(`${m[1]}\t${m[2]}${/без\s*4|0\s*%/i.test(m[3]) ? " без4" : /4\s*%/.test(m[3]) ? " 4%" : ""}`);
  }
  d.materials = mats.join("\n");
  return d;
}

/** Любой извлечённый текст: таблица (табуляции/«;») с заголовком — как таблица; иначе блоки «ТЗ № …». */
export function draftsFromText(text: string, source: string): TzDraft[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const tabbed = lines.filter((l) => l.includes("\t") || (l.match(/;/g)?.length ?? 0) >= 2);
  if (lines.length > 1 && tabbed.length >= Math.max(2, lines.length * 0.6)) {
    const rows = lines.map((l) => (l.includes("\t") ? l.split("\t") : l.split(";")));
    const t = draftsFromTable(rows, source);
    if (t.length) return t;
  }
  const blocks = text.split(/(?=(?:^|\n)\s*(?:тз|тех\w*\s*задани\w*)\s*(?:№|N|no\.?)\s*[\w\-/]+)/i).filter((b) => b.trim());
  const withNumber = blocks.filter((b) => /(?:тз|тех\w*\s*задани\w*)\s*(?:№|N|no\.?)\s*[\w\-/]+/i.test(b));
  const src = withNumber.length ? withNumber : [text];
  return src.map((b) => draftFromTextBlock(b, source)).filter((d) => d.number || d.article || d.materials);
}

// ---------- сверка (чистая часть проверки) ----------

/** Находит повторы № ТЗ внутри набора черновиков: номер -> ключи. */
export function duplicateNumbers(drafts: Pick<TzDraft, "key" | "number">[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const d of drafts) {
    const n = d.number.trim().toLowerCase();
    if (!n) continue;
    m.set(n, [...(m.get(n) ?? []), d.key]);
  }
  for (const [k, v] of [...m]) if (v.length < 2) m.delete(k);
  return m;
}

/** Количество изделий ТЗ: явное число, иначе сумма по размерам, иначе по количеству цветов. */
export function draftQty(d: Pick<TzDraft, "qty" | "sizes" | "colors">): number {
  const q = toNum(d.qty);
  if (Number.isFinite(q) && q > 0) return q;
  const s = sizesTotal(d.sizes);
  if (s > 0) return s;
  const c = parseColors(d.colors).reduce((a, x) => a + (x.qty ?? 0), 0);
  return c > 0 ? c : NaN;
}
