// Определение типа документа по сигнатуре содержимого (PDF, JPEG, PNG, xlsx, docx).
// Без server-only: используется и серверным кодом приложения, и скриптами в scripts/.

export type DocKind = { mime: string; ext: string };

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

