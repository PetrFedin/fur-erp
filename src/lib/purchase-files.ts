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

import { detectDocument, type DocKind } from "@/lib/doc-sniff";

export { detectDocument };

/** Обрезает имя до maxLen символов, сохраняя расширение (обрезается основа имени). */
export function truncateFileName(name: string, maxLen = 200): string {
  if (name.length <= maxLen) return name;
  const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
  const ext = m ? m[0] : "";
  return name.slice(0, maxLen - ext.length) + ext;
}

/** Приводит расширение имени к реальному типу файла (подмена .jpg у PDF исправляется). */
export function fixFileNameExt(name: string, ext: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  if (m) {
    const cur = m[1].toLowerCase();
    if (cur === ext || (ext === "jpg" && cur === "jpeg")) return name;
    return name.slice(0, name.length - m[0].length) + "." + ext;
  }
  return name + "." + ext;
}

/** Размер в МБ с двумя знаками, округлённый вверх (чтобы «больше 25 МБ» не выглядело как «25,00 МБ»). */
export function formatMb(bytes: number): string {
  return (Math.ceil((bytes / 1024 / 1024) * 100) / 100).toFixed(2).replace(".", ",");
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
    return { error: `Суммарный размер файлов ${formatMb(total)} МБ — больше лимита 25 МБ; загрузите файлы по частям` };
  }
  const out: ReadDoc[] = [];
  for (const f of files) {
    // Кавычки и управляющие символы в имени ломают заголовки/ссылки — заменяем на апостроф.
    const name = (f.name || "файл").replace(/["\u0000-\u001f]/g, "'");
    if (f.size > MAX_DOC_BYTES) return { error: `Файл «${name}» (${formatMb(f.size)} МБ) больше лимита 25 МБ` };
    const buf = Buffer.from(await f.arrayBuffer());
    const kind = detectDocument(buf.subarray(0, 16), name, buf);
    if (!kind) return { error: `Файл «${name}» не подходит: допустимы PDF, XLSX, DOCX, JPEG, PNG` };
    out.push({ buf, kind, originalName: truncateFileName(fixFileNameExt(name, kind.ext), 200) });
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
  PAYMENT_PROOF: "Платёжный документ",
  OTHER: "Другое",
};
