import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveInside, removeStoredFiles } from "@/lib/fitting-files";

/**
 * Документы закупки (счета аукциона, спецификации, расчётные листы): файлы на
 * диске в UPLOAD_DIR, в БД (PurchaseDocument) — путь относительно UPLOAD_DIR.
 * Имя на диске — uuid, исходное имя хранится только в БД. Тип файла
 * определяем по сигнатуре, а не по имени и не по заявленному mime.
 */

export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const MAX_DOCS_PER_UPLOAD = 10;
/** Суммарный размер одной загрузки — укладывается в serverActions.bodySizeLimit (26 МБ). */
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

type DocKind = { mime: string; ext: string };

// Имена файлов внутри zip хранятся открытым текстом (локальные заголовки и
// центральный каталог) — по ним отличаем настоящий xlsx/docx от переименованного zip.
function zipHas(buf: Buffer, entryName: string): boolean {
  return buf.includes(Buffer.from(entryName, "latin1"));
}

export function detectDocument(head: Buffer, name: string, whole?: Buffer): DocKind | null {
  if (head.length >= 5 && head.toString("latin1", 0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: "image/png", ext: "png" };
  // xlsx/docx — zip-контейнер; различаем по расширению исходного имени
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    if (/\.xlsx$/i.test(name)) {
      if (whole && !(zipHas(whole, "[Content_Types].xml") && zipHas(whole, "xl/"))) return null;
      return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    }
    if (/\.docx$/i.test(name)) {
      if (whole && !(zipHas(whole, "[Content_Types].xml") && zipHas(whole, "word/"))) return null;
      return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
    }
  }
  return null;
}

/** Обрезает имя до maxLen символов, сохраняя расширение (обрезается основа имени). */
export function truncateFileName(name: string, maxLen = 200): string {
  if (name.length <= maxLen) return name;
  const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
  const ext = m ? m[0] : "";
  return name.slice(0, maxLen - ext.length) + ext;
}

export type ReadDoc = { buf: Buffer; kind: DocKind; originalName: string };

export async function readDocumentFiles(
  entries: FormDataEntryValue[],
): Promise<{ error: string } | { files: ReadDoc[] }> {
  const files = entries.filter((e): e is File => typeof e !== "string" && e.size > 0);
  if (files.length === 0) return { error: "Выберите файл" };
  if (files.length > MAX_DOCS_PER_UPLOAD) {
    return { error: `За один раз можно загрузить не больше ${MAX_DOCS_PER_UPLOAD} файлов (выбрано ${files.length})` };
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return { error: `Суммарный размер файлов больше 25 МБ (${(total / 1024 / 1024).toFixed(1)} МБ) — загрузите их по частям` };
  }
  const out: ReadDoc[] = [];
  for (const f of files) {
    // Кавычки и управляющие символы в имени ломают заголовки/ссылки — заменяем на апостроф.
    const name = (f.name || "файл").replace(/["\u0000-\u001f]/g, "'");
    if (f.size > MAX_DOC_BYTES) return { error: `Файл «${name}» больше 25 МБ` };
    const buf = Buffer.from(await f.arrayBuffer());
    const kind = detectDocument(buf.subarray(0, 16), name, buf);
    if (!kind) return { error: `Файл «${name}» не подходит: допустимы PDF, XLSX, DOCX, JPEG, PNG` };
    out.push({ buf, kind, originalName: truncateFileName(name, 200) });
  }
  return { files: out };
}

export type StoredDoc = { storagePath: string; originalName: string; mimeType: string; sizeBytes: number };

export async function writeDocumentFiles(organizationId: string, scope: string, files: ReadDoc[]): Promise<StoredDoc[]> {
  const dirRel = path.join("purchase-docs", organizationId, scope);
  const dirAbs = resolveInside(dirRel);
  if (!dirAbs) throw new Error("Некорректный каталог загрузок");
  await mkdir(dirAbs, { recursive: true });
  const written: StoredDoc[] = [];
  try {
    for (const f of files) {
      const rel = path.join(dirRel, `${randomUUID()}.${f.kind.ext}`);
      const abs = resolveInside(rel);
      if (!abs) throw new Error("Некорректный путь файла");
      await writeFile(abs, f.buf, { flag: "wx" });
      written.push({ storagePath: rel, originalName: f.originalName, mimeType: f.kind.mime, sizeBytes: f.buf.length });
    }
  } catch (e) {
    await removeStoredFiles(written.map((w) => w.storagePath));
    throw e;
  }
  return written;
}

export const DOC_KIND_LABELS: Record<string, string> = {
  AUCTION_INVOICE: "Счёт аукциона",
  SPECIFICATION: "Спецификация",
  ADVANCE_INVOICE: "Счёт на аванс",
  CALC_SHEET: "Расчётный лист",
  UPD: "УПД / акт",
  OTHER: "Другое",
};
