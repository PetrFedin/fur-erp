/**
 * Справочник меха (FurRef): русское и английское названия + синонимы. Чистые функции — без базы,
 * поэтому годятся и для сервера, и для клиента, и для скриптов. Загрузка из базы — в fur-ref-server.ts.
 *
 *   canonicalFur(text)            → { name, nameEn } | null   (встроенный набор — как после засева)
 *   canonicalFur(text, index)     → то же, но по справочнику организации (buildFurIndex(refs))
 *
 * Текст может быть названием материала («Соболь», «Лиса красная»), описанием в ТЗ («шкура норки американский блек»),
 * английским написанием из инвойса («SABLE WILD SILVER 4-5», «Karakul Broadtail Grey»). Совпадение — по целым словам
 * названия, английского названия или синонима (регистр и «ё» не важны); из нескольких находок берётся самая ранняя
 * в тексте, при равенстве — самая длинная. Нет совпадения — null (мех не определён).
 */

export type FurRefLite = { id?: string; name: string; nameEn?: string | null; aliases: string[]; note?: string | null };
export type CanonicalFur = { name: string; nameEn: string | null };
export type FurIndex = { refs: FurRefLite[]; phrases: Array<{ phrase: string; ref: FurRefLite }> };

/** Встроенный набор (им засевается FurRef скриптом scripts/seed-fur-refs.ts). Английские названия — только общепринятые однозначные. */
export const SEED_FURS: ReadonlyArray<FurRefLite & { nameEn: string }> = [
  {
    name: "Соболь",
    nameEn: "Sable",
    aliases: ["соболя", "соболе", "соболи", "соболей", "соболиный", "соболиная", "соболиное", "соболиные", "соболиного", "sable"],
  },
  {
    name: "Норка",
    nameEn: "Mink",
    aliases: ["норки", "норку", "норке", "норкой", "норок", "mink", "american mink"],
  },
  {
    name: "Свакара",
    nameEn: "Karakul (Swakara)",
    aliases: ["каракуль (свакара)", "каракуль", "каракуля", "каракулю", "каракулем", "каракульча", "каракульчи", "каракульчу", "свакара", "свакары", "свакаре", "свакару", "swakara", "karakul", "karakulcha", "karakul broadtail", "broadtail"],
  },
  {
    name: "Лиса",
    nameEn: "Fox",
    aliases: ["лисы", "лису", "лисе", "лисой", "лиса красная", "лисица", "лисицы", "лисицу", "лисице", "лисицей", "лисиц", "лисья", "fox", "silver fox"],
  },
  { name: "Рысь", nameEn: "Lynx", aliases: ["рыси", "рысью", "lynx", "lynx cat"] },
  { name: "Бобр", nameEn: "Beaver", aliases: ["бобра", "бобры", "бобров", "бобру", "бобре", "бобровый", "beaver"] },
];

/** Нормализация: нижний регистр, «ё»→«е», всё кроме букв и цифр — пробел. */
export function furKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

function phrasesOf(ref: FurRefLite): string[] {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    const k = furKey(s);
    if (k) out.add(k);
  };
  add(ref.name);
  // «Каракуль (свакара)» → ещё «каракуль» и «свакара» по отдельности
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(ref.name);
  if (m) {
    add(m[1]);
    add(m[2]);
  }
  for (const part of (ref.nameEn ?? "").split(/[\/;,]+/)) {
    add(part);
    const mm = /^(.*?)\s*\((.*)\)\s*$/.exec(part);
    if (mm) {
      add(mm[1]);
      add(mm[2]);
    }
  }
  for (const a of ref.aliases) add(a);
  return Array.from(out);
}

export function buildFurIndex(refs: FurRefLite[]): FurIndex {
  const phrases: FurIndex["phrases"] = [];
  for (const ref of refs) for (const phrase of phrasesOf(ref)) phrases.push({ phrase, ref });
  return { refs, phrases };
}

const DEFAULT_INDEX = buildFurIndex(SEED_FURS.map((f) => ({ ...f })));

/** Справочник-запись (а не просто {name,nameEn}): удобно для счётчиков. */
export function matchFurRef(text: string | null | undefined, index: FurIndex = DEFAULT_INDEX): FurRefLite | null {
  const t = furKey(text);
  if (!t) return null;
  const padded = ` ${t} `;
  let best: { ref: FurRefLite; at: number; len: number } | null = null;
  for (const p of index.phrases) {
    const at = padded.indexOf(` ${p.phrase} `);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && p.phrase.length > best.len)) best = { ref: p.ref, at, len: p.phrase.length };
  }
  return best?.ref ?? null;
}

export function canonicalFur(text: string | null | undefined, index?: FurIndex): CanonicalFur | null {
  const r = matchFurRef(text, index);
  return r ? { name: r.name, nameEn: r.nameEn?.trim() || null } : null;
}

/**
 * Вид меха для аналитики: каноническое русское название или исходный текст, если справочник его не знает
 * (так подкладка и неизвестные материалы не пропадают из группировок).
 */
export function furKindLabel(text: string | null | undefined, index?: FurIndex): string {
  return canonicalFur(text, index)?.name ?? (text ?? "").trim();
}

/** Подсказка «Sable» для русского названия вида меха (по справочнику), либо null. */
export function furEnglish(name: string | null | undefined, index?: FurIndex): string | null {
  return canonicalFur(name, index)?.nameEn ?? null;
}
