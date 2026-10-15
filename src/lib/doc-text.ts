import "server-only";
import JSZip from "jszip";
import { assertSafeZip } from "@/lib/zip-guard";

/**
 * Отрисованный текст DOCX и таблицы XLSX для окна DocViewer (без тяжёлых пакетов: только zip + разбор XML).
 * Лимиты защищают от огромных файлов и «zip-бомб»: до 5 МБ распакованного XML на часть, 12 листов,
 * 500 строк × 40 столбцов на лист, 200 000 знаков текста.
 */

export type DocContent =
  | { kind: "text"; text: string }
  | { kind: "tables"; sheets: { name: string; rows: string[][]; truncated: boolean }[] };

const MAX_PART = 5 * 1024 * 1024;
const MAX_SHEETS = 12;
const MAX_ROWS = 500;
const MAX_COLS = 40;
const MAX_TEXT = 200_000;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

async function part(zip: JSZip, name: string): Promise<string | null> {
  const f = zip.file(name);
  if (!f) return null;
  const buf = await f.async("nodebuffer");
  if (buf.length > MAX_PART) return null;
  return buf.toString("utf-8");
}

/** Текст <w:t>/<a:t>/<t> внутри фрагмента. */
function runsText(xml: string): string {
  let out = "";
  const re = /<(?:w:t|t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|t)>|<w:tab\/>|<w:br\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] !== undefined ? decode(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n";
  return out;
}

export async function extractDocx(buf: Buffer): Promise<DocContent> {
  assertSafeZip(buf);
  const zip = await JSZip.loadAsync(buf);
  const xml = await part(zip, "word/document.xml");
  if (!xml) return { kind: "text", text: "" };
  const paras = xml.split(/<\/w:p>/).map((p) => runsText(p).trim());
  // Строки таблиц Word: ячейки в одной строке уже склеены абзацами — этого достаточно для чтения и поиска.
  const text = paras.filter((p, i) => p || (paras[i - 1] ?? "")).join("\n").slice(0, MAX_TEXT);
  return { kind: "text", text };
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function extractXlsx(buf: Buffer): Promise<DocContent> {
  assertSafeZip(buf);
  const zip = await JSZip.loadAsync(buf);
  const shared: string[] = [];
  const ss = await part(zip, "xl/sharedStrings.xml");
  if (ss) for (const si of ss.split(/<\/si>/)) if (/<si[\s>]/.test(si)) shared.push(runsText(si.slice(si.indexOf("<si"))));
  const wb = (await part(zip, "xl/workbook.xml")) ?? "";
  const rels = (await part(zip, "xl/_rels/workbook.xml.rels")) ?? "";
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) relTarget.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const sheetDefs = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decode(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "Лист"),
    rid: /\br:id="([^"]+)"/.exec(m[0])?.[1] ?? "",
  }));
  const sheets: { name: string; rows: string[][]; truncated: boolean }[] = [];
  for (const [i, def] of sheetDefs.slice(0, MAX_SHEETS).entries()) {
    const xml = await part(zip, relTarget.get(def.rid) ?? `xl/worksheets/sheet${i + 1}.xml`);
    if (!xml) continue;
    const rows: string[][] = [];
    let truncated = false;
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      let last = -1;
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const idx = ref ? colIndex(ref) : last + 1;
        if (idx >= MAX_COLS) continue;
        const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const body = cm[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = "";
        if (t === "s" && v !== undefined) val = shared[Number(v)] ?? "";
        else if (t === "inlineStr") val = runsText(body);
        else if (v !== undefined) val = decode(v);
        while (cells.length < idx) cells.push("");
        cells[idx] = val;
        last = idx;
      }
      if (cells.some((c) => c !== "")) rows.push(cells);
    }
    if (rows.length) sheets.push({ name: def.name, rows, truncated });
  }
  return { kind: "tables", sheets };
}
