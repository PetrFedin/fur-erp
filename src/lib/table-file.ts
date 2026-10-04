import "server-only";
import JSZip from "jszip";

/**
 * Читает таблицу из CSV/TXT (разделитель «;», «,» или табуляция, кавычки, BOM) или Excel .xlsx (первый лист)
 * в массив строк. Для импорта из системы продаж; без записи куда-либо.
 */
export async function parseTableFile(buf: Buffer, filename: string): Promise<string[][]> {
  const isXlsx = /\.xlsx$/i.test(filename) || (buf[0] === 0x50 && buf[1] === 0x4b);
  return isXlsx ? parseXlsx(buf) : parseCsv(buf.toString("utf8"));
}

export function parseCsv(textRaw: string): string[][] {
  const text = textRaw.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = count(";") >= count("\t") && count(";") >= count(",") ? ";" : count("\t") >= count(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== "")).slice(0, 5000);
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buf);
  const shared: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) {
    const xml = await ss.async("string");
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(decode(Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((x) => x[1]).join("")));
    }
  }
  const sheets = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (sheets.length === 0) return [];
  const xml = await zip.file(sheets[0])!.async("string");
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = cm[2] ?? "";
      let v = "";
      if (type === "inlineStr") v = decode(Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((x) => x[1]).join(""));
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        v = type === "s" ? (shared[Number(raw)] ?? "") : decode(raw);
      }
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push("");
      row[idx] = v;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== "")).slice(0, 5000);
}
