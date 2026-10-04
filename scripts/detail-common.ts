/**
 * Общие помощники для scripts/fill-detail-*.ts и scripts/build-detail-audit.ts.
 * Только чтение файлов docs-inventory и нормализация; к базе не обращается.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const ROOT = join(__dirname, "..");
export const INV = join(ROOT, "docs-inventory");

export type ExtractDoc = {
  fileId: string;
  title: string;
  docType: string;
  date?: string | null;
  auction?: string | null;
  path?: string;
  duplicateOf?: unknown;
  lots?: Array<Record<string, unknown>> | null;
  payments?: Array<Record<string, unknown>> | null;
  relatedPurchase?: string | null;
  [k: string]: unknown;
};

/** Все документы закупок (p2025a/b, p2026a/b) из docs-inventory/extract. */
export function loadPurchaseExtracts(): ExtractDoc[] {
  const out: ExtractDoc[] = [];
  for (const f of ["p2025a", "p2025b", "p2026a", "p2026b"]) {
    const d = JSON.parse(readFileSync(join(INV, "extract", `${f}.json`), "utf-8"));
    const docs: ExtractDoc[] = Array.isArray(d) ? d : d.documents;
    out.push(...docs);
  }
  return out;
}

/** Нормализация по сессиям БД: какие Purchase.auctionSession относятся к документу извлечения. */
export function docSessions(doc: ExtractDoc): string[] {
  const t = `${doc.auction ?? ""} ${doc.path ?? ""}`.toLowerCase().replace(/ё/g, "е");
  const s = new Set<string>();
  if (/saga 03-25|saga 03-25\//.test(t) || (/saga/.test(t) && /03-25|спец\. ?№?2\b/.test(t))) s.add("SAGA 03-25");
  if (/saga 06-25|saga 06-2025/.test(t)) s.add("SAGA 06-25");
  if (/saga 03-26/.test(t)) s.add("SAGA 03-26");
  if (/ame 05-26/.test(t)) s.add("AME 05-26");
  if (/fh 06-26/.test(t)) s.add("FH 06-26");
  if (/кфх|дуденко/.test(t)) s.add("КФХ Дуденко Л. Н.");
  const sp = /сп\/рп 03\.25|сп 03\.25 \/ рп 03\.25/.test(t);
  if (sp || /сп 03\.25|союзпушнина \(?сп 03/.test(t)) s.add("СП 03.25");
  if (sp || /рп 03\.25/.test(t)) s.add("РП 03.25");
  const sp5 = /сп\/рп 05\.25|сп 05\.25 \/ рп 05\.25/.test(t);
  if (sp5 || /сп 05\.25/.test(t)) s.add("СП 05.25");
  if (sp5 || /рп 05\.25/.test(t)) s.add("РП 05.25");
  if (/сп 12[-.]25|союзпушнина сп 12/.test(t)) s.add("СП 12.25");
  const both26 = /рп 04-26 \+ сп 05-26|рп\/сп 04-05\.26|рп 04-26 \/ сп 05-26|русьпушнина \+ союзпушнина/.test(t);
  if (both26 || /рп 04-26|русьпушнина.*(24 аукцион|рп 04)/.test(t)) s.add("Закупка меха 04-26");
  if (both26 || /сп 05-26|союзпушнина 05-26/.test(t)) s.add("СОЮЗПУШНИНА 05-26");
  if (/сп 09-26/.test(t)) s.add("СП 09-26");
  if (/подкладка 07-2025|подкладка спец\. 7|упд 109/.test(t) || /закупка 2025\/подкладка/.test(t)) s.add("Подкладка Спец. 7 (УПД 109)");
  if (/закупка 2026\/подкладка/.test(t)) s.add("Подкладка Спец. 13");
  if (/закупка 2026\/доп материалы/.test(t)) s.add("Доп. материалы Спец. 16");
  return [...s];
}

/** Разбор перечней вида «З-2026-0041..0046», «З-2026-0010…0013», «З-2026-0047». */
export function expandPurchaseRefs(refs: string[]): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const m = r.match(/^(З-\d{4}-)(\d{4})(?:\.\.|…)(\d{4})$/);
    if (m) {
      for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(`${m[1]}${String(n).padStart(4, "0")}`);
    } else out.push(r);
  }
  return out;
}

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as T) : fallback;
}
export function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** Вес описания: из «то же» берём предыдущее; прочее без изменений. */
export function resolveSameAs(lots: Array<Record<string, unknown>>): Array<{ lot: string; description: string; quantity: number | null }> {
  const out: Array<{ lot: string; description: string; quantity: number | null }> = [];
  let last = "";
  for (const l of lots) {
    if (l.lot == null) continue;
    let d = String(l.description ?? "").trim();
    if (/^то же$/i.test(d)) d = last;
    else if (d) last = d;
    out.push({ lot: String(l.lot).trim(), description: d, quantity: l.quantity == null ? null : Number(l.quantity) });
  }
  return out;
}

/** Цвет из текста: только если в тексте ровно один цветовой признак. */
const COLOR_RULES: Array<[RegExp, string]> = [
  [/серебристо-?\s?голуб/g, "серебристо-голубой"],
  [/серебристо-?\s?[чч]ерн|серебристо-?\s?чёрн/g, "серебристо-чёрный"],
  [/голубой ирис|(?<![а-я])ирис/g, "голубой ирис"],
  [/пастел/g, "пастель"],
  [/лаванд/g, "лаванда"],
  [/виолет/g, "виолет"],
  [/жемчуг/g, "жемчуг"],
  [/махагон/g, "махагон"],
  [/коричнев|браун|brown/g, "коричневый"],
  [/чёрн|черн|блек|black/g, "чёрный"],
  [/(?<![а-я])бел(?:ая|ой|ый|ые|ого)(?![а-я])|отбелен|выбелен/g, "белый"],
  [/красн/g, "красный"],
  [/(?<![а-я])нуга(?![а-я])/g, "нуга"],
  [/(?<![а-я])облако(?![а-я])/g, "облако"],
  [/(?<![а-я])орех(?![а-я])/g, "орех"],
  [/(?<![а-я])фондю(?![а-я])/g, "фондю"],
];
export function colorFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  let t = text.toLowerCase().replace(/ё/g, "е").replace(/чёрн/g, "черн");
  const found = new Set<string>();
  for (const [re, name] of COLOR_RULES) {
    const rr = new RegExp(re.source.replace(/ё/g, "е"), "g");
    if (rr.test(t)) {
      found.add(name);
      t = t.replace(rr, " ");
    }
  }
  return found.size === 1 ? [...found][0] : null;
}
