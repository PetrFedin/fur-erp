import "server-only";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { assertSafeZip } from "@/lib/zip-guard";
import { parseTableFile } from "@/lib/table-file";

/**
 * Текст документа для распознавания типа, номера и суммы (мастер «Новая партия»). Без внешних библиотек:
 *  • DOCX — word/document.xml (абзацы → строки, ячейки → табуляция);
 *  • XLSX — первый лист (через parseTableFile), строки через табуляцию;
 *  • PDF  — простой разбор: сжатые потоки (Flate), шрифты с ToUnicode (в т.ч. Type0/Identity-H из «Печать в PDF»),
 *           позиционирование строк по операторам Td/Tm. Сканы и PDF без текстового слоя вернут пустую строку.
 * Пустая строка = «текст не прочитан»: интерфейс просит указать номер и сумму вручную.
 */

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function docxText(buf: Buffer): Promise<string> {
  assertSafeZip(buf);
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file("word/document.xml");
  if (!f) return "";
  const xml = await f.async("string");
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

async function xlsxText(buf: Buffer): Promise<string> {
  const rows = await parseTableFile(buf, "x.xlsx");
  return rows.map((r) => r.join("\t")).join("\n");
}

// ---------------------------------------------------------------- PDF

type PdfObj = { dict: string; data?: Buffer };

function parseObjects(buf: Buffer): Map<number, PdfObj> {
  const s = buf.toString("latin1");
  const objs = new Map<number, PdfObj>();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  const starts: { id: number; at: number }[] = [];
  while ((m = re.exec(s))) starts.push({ id: Number(m[1]), at: m.index + m[0].length });
  for (let i = 0; i < starts.length; i++) {
    const end = s.indexOf("endobj", starts[i].at);
    const body = s.slice(starts[i].at, end < 0 ? s.length : end);
    const si = body.indexOf("stream");
    if (si < 0) {
      objs.set(starts[i].id, { dict: body });
      continue;
    }
    const dict = body.slice(0, si);
    let ds = si + 6;
    if (body[ds] === "\r") ds++;
    if (body[ds] === "\n") ds++;
    let de = body.lastIndexOf("endstream");
    if (de < 0) de = body.length;
    let data: Buffer | undefined = Buffer.from(body.slice(ds, de), "latin1");
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(data);
      } catch {
        try {
          data = inflateSync(data.subarray(0, Math.max(0, data.length - 1)));
        } catch {
          data = undefined;
        }
      }
    } else if (/\/Filter/.test(dict)) data = undefined; // другие фильтры (DCT, LZW…) — не текст
    objs.set(starts[i].id, { dict, data });
  }
  // объектные потоки (PDF 1.5): вложенные объекты тоже нужны (шрифты)
  for (const [, o] of [...objs]) {
    if (!o.data || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const t = o.data.toString("latin1");
    const nums = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      const id = nums[k * 2], off = nums[k * 2 + 1];
      const next = k + 1 < n ? nums[(k + 1) * 2 + 1] : t.length - first;
      if (Number.isFinite(id) && !objs.has(id)) objs.set(id, { dict: t.slice(first + off, first + next) });
    }
  }
  return objs;
}

type CMap = { map: Map<number, string>; width: number };

const utf16 = (h: string) => {
  let out = "";
  for (let i = 0; i + 4 <= h.length; i += 4) {
    const c = parseInt(h.slice(i, i + 4), 16);
    if (c) out += String.fromCharCode(c); // некоторые генераторы кладут 32-битные значения с нулевой половиной
  }
  return out;
};

function parseCMap(text: string): CMap {
  const map = new Map<number, string>();
  let width = 2;
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      width = Math.max(1, m[1].length / 2);
      map.set(parseInt(m[1], 16), utf16(m[2]));
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      width = Math.max(1, m[1].length / 2);
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[3].startsWith("[")) {
        const arr = [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => utf16(x[1]));
        for (let c = lo; c <= hi && c - lo < arr.length; c++) map.set(c, arr[c - lo]);
      } else {
        const base = m[3].slice(1, -1);
        const b0 = parseInt(base, 16);
        const len = base.length;
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, utf16((b0 + (c - lo)).toString(16).padStart(len, "0")));
      }
    }
  }
  return { map, width };
}

function unescapeLiteral(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e: string) => {
    if (e === "n") return "\n";
    if (e === "r") return "\r";
    if (e === "t") return "\t";
    if (e === "b") return "\b";
    if (e === "f") return "\f";
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    if (e === "(" || e === ")" || e === "\\") return e;
    return "";
  });
}

function pdfText(buf: Buffer): string {
  const objs = parseObjects(buf);
  // шрифт (объект) → CMap из ToUnicode
  const cmapOfObj = new Map<number, CMap>();
  for (const [id, o] of objs) {
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dict);
    if (!tu) continue;
    const data = objs.get(Number(tu[1]))?.data;
    if (data) cmapOfObj.set(id, parseCMap(data.toString("latin1")));
  }
  // имя ресурса (/F4) → объект шрифта
  const nameToObj = new Map<string, number>();
  const addFonts = (d: string) => {
    for (const m of d.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) nameToObj.set(m[1], Number(m[2]));
  };
  for (const [, o] of objs) {
    for (const f of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) addFonts(f[1]);
    const ind = /\/Font\s+(\d+)\s+\d+\s+R/.exec(o.dict);
    if (ind) {
      const t = objs.get(Number(ind[1]));
      if (t) addFonts(t.dict);
    }
  }

  const out: string[] = [];
  const tok =
    /\/([A-Za-z0-9_.+-]+)\s+(-?[\d.]+)\s+Tf|\[((?:[^\]\\]|\\[\s\S])*)\]\s*TJ|(<[0-9A-Fa-f\s]*>|\((?:[^()\\]|\\[\s\S])*\))\s*(?:Tj|'|")|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|(?:-?[\d.]+\s+){4}(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|\bT\*|\bET\b/g;
  for (const [, o] of objs) {
    if (!o.data || o.data.length < 20) continue;
    const t = o.data.toString("latin1");
    if (!/\bBT\b/.test(t) || !/(Tj|TJ)/.test(t)) continue;
    let cmap: CMap | null = null;
    let y = NaN;
    let line = "";
    const flush = () => {
      if (line.trim()) out.push(line.trim());
      line = "";
    };
    const decode = (raw: string, hex: boolean): string => {
      if (hex) {
        const h = raw.replace(/[<>\s]/g, "");
        if (cmap) {
          let s = "";
          const w = cmap.width * 2;
          for (let i = 0; i + w <= h.length; i += w) s += cmap.map.get(parseInt(h.slice(i, i + w), 16)) ?? "";
          return s;
        }
        let s = "";
        for (let i = 0; i + 2 <= h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
        return s;
      }
      const lit = unescapeLiteral(raw.slice(1, -1));
      if (cmap) {
        let s = "";
        if (cmap.width >= 2) {
          for (let i = 0; i + 2 <= lit.length; i += 2) s += cmap.map.get((lit.charCodeAt(i) << 8) | lit.charCodeAt(i + 1)) ?? "";
        } else for (const ch of lit) s += cmap.map.get(ch.charCodeAt(0)) ?? ch;
        return s;
      }
      return lit;
    };
    tok.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tok.exec(t))) {
      if (m[1] !== undefined) {
        const fo = nameToObj.get(m[1]);
        cmap = fo !== undefined ? (cmapOfObj.get(fo) ?? null) : null;
      } else if (m[3] !== undefined) {
        for (const p of m[3].matchAll(/(<[0-9A-Fa-f\s]*>|\((?:[^()\\]|\\[\s\S])*\))|(-?[\d.]+)/g)) {
          if (p[1]) line += decode(p[1], p[1].startsWith("<"));
          else if (p[2] && Number(p[2]) < -250) line += " ";
        }
      } else if (m[4] !== undefined) {
        line += decode(m[4], m[4].startsWith("<"));
      } else if (m[5] !== undefined) {
        const ty = Number(m[6]);
        if (Math.abs(ty) > 0.5) flush();
        else line += " ";
      } else if (m[7] !== undefined) {
        const ny = Number(m[8]);
        if (Number.isFinite(y) && Math.abs(ny - y) > 2) flush();
        else if (line && !line.endsWith(" ")) line += " ";
        y = ny;
      } else {
        flush(); // T* или ET
      }
    }
    flush();
  }
  return out.map(despace).join("\n");
}

/**
 * Некоторые генераторы PDF выводят каждую букву отдельным фрагментом («С ч е т   н а   о п л а т у»).
 * Если в строке в основном одиночные символы, склеиваем буквы внутри слов; слова разделены несколькими пробелами.
 */
function despace(line: string): string {
  const toks = line.split(" ").filter((x) => x !== "");
  if (toks.length < 4) return line;
  const single = toks.filter((x) => [...x].length === 1).length;
  if (single / toks.length < 0.6) return line;
  return line
    .split(/ {2,}/)
    .map((w) => w.replace(/ /g, ""))
    .join(" ");
}

/** Текст документа по содержимому. Ошибки чтения не бросаются: пустая строка = «не прочитано». */
export async function extractDocText(buf: Buffer, ext: string): Promise<string> {
  try {
    if (ext === "docx") return await docxText(buf);
    if (ext === "xlsx") return await xlsxText(buf);
    if (ext === "pdf") return pdfText(buf);
  } catch (e) {
    console.error("[doc-content-text]", ext, e instanceof Error ? e.message : e);
  }
  return "";
}
