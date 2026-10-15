import "server-only";
import JSZip from "jszip";
import { assertSafeZip } from "@/lib/zip-guard";
import { inflateSync } from "node:zlib";
import { parseTableFile } from "@/lib/table-file";
import { draftsFromTable, draftsFromText, type TzDraft } from "@/lib/tz-import-core";

/** Текст из .docx: абзацы — строки, ячейки таблицы — через табуляцию. */
export async function docxText(buf: Buffer): Promise<string> {
  assertSafeZip(buf);
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file("word/document.xml");
  if (!f) return "";
  const xml = await f.async("string");
  const dec = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return dec(
    xml
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\t+\n/g, "\n")
    .replace(/[  ]+\n/g, "\n");
}

/** Текст из PDF с текстовым слоем (без внешних библиотек): распаковывает потоки и берёт строки операторов Tj/TJ. Скан без текста -> пусто. */
export function pdfText(buf: Buffer): string {
  const out: string[] = [];
  const s = buf.toString("latin1");
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let data = Buffer.from(m[1], "latin1");
    try {
      data = inflateSync(data);
    } catch {
      /* поток без сжатия */
    }
    const t = data.toString("latin1");
    if (!/\b(?:Tj|TJ)\b/.test(t)) continue;
    for (const line of t.split(/\bET\b/)) {
      const parts: string[] = [];
      for (const mm of line.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
        const raw = mm[1] ?? [...(mm[2] ?? "").matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => x[1]).join("");
        parts.push(raw.replace(/\\([()\\])/g, "$1").replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
      }
      if (parts.length) out.push(parts.join(" "));
    }
  }
  const text = out.join("\n");
  // UTF-16 с BOM в строках Tj (Identity-H без ToUnicode прочитать нельзя)
  return /[A-Za-zА-Яа-я0-9]{3}/.test(text) ? text : "";
}

export type TzFileResult = { source: string; drafts: TzDraft[]; error?: string };

/** Файл ТЗ (xlsx, csv/txt, docx, pdf с текстом) -> черновики. Ошибка — понятным текстом, без угадывания. */
export async function draftsFromFile(name: string, buf: Buffer): Promise<TzFileResult> {
  const source = name;
  try {
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    if (/\.docx$/i.test(name) && isZip) {
      const t = await docxText(buf);
      const drafts = draftsFromText(t, source);
      return drafts.length ? { source, drafts } : { source, drafts: [], error: "в документе не найдено ТЗ: нужны строки «Артикул: …», «ТЗ № …» или таблица с заголовками" };
    }
    if (/\.pdf$/i.test(name) || buf.subarray(0, 5).toString("latin1") === "%PDF-") {
      const t = pdfText(buf);
      if (!t.trim()) return { source, drafts: [], error: "в PDF нет текстового слоя (скан) — вставьте таблицу из Excel или введите вручную" };
      const drafts = draftsFromText(t, source);
      return drafts.length ? { source, drafts } : { source, drafts: [], error: "в PDF не найдено ТЗ — вставьте таблицу из Excel" };
    }
    if (/\.(xlsx|csv|txt|tsv)$/i.test(name) || isZip) {
      const rows = await parseTableFile(buf, name);
      let drafts = draftsFromTable(rows, source);
      if (!drafts.length && /\.(txt)$/i.test(name)) drafts = draftsFromText(buf.toString("utf8"), source);
      return drafts.length ? { source, drafts } : { source, drafts: [], error: "не найдены колонки ТЗ: ожидаются заголовки «№ ТЗ», «Артикул», «Цвет», «Лот», «Расход»…" };
    }
    return { source, drafts: [], error: "формат не поддерживается: загрузите xlsx, csv, docx или pdf с текстом" };
  } catch (e) {
    return { source, drafts: [], error: `не удалось прочитать файл: ${e instanceof Error ? e.message : "ошибка"}` };
  }
}
