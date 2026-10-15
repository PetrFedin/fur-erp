// Защита от «zip-бомб» в загружаемых xlsx/docx: до распаковки читаем оглавление архива (последние байты файла)
// и отказываем, если заявленный распакованный размер или число файлов внутри чрезмерны.
// Файл xlsx/docx на 25 МБ может распаковаться в гигабайты и съесть память сервера.

const MAX_ENTRIES = 5_000;
const MAX_TOTAL_UNPACKED = 250 * 1024 * 1024; // 250 МБ
const MAX_ENTRY_UNPACKED = 120 * 1024 * 1024;
const MAX_RATIO = 1_000;

export class UnsafeArchiveError extends Error {}

export function assertSafeZip(input: Buffer | Uint8Array | ArrayBuffer): void {
  const buf = input instanceof ArrayBuffer ? Buffer.from(input) : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new UnsafeArchiveError("Файл повреждён: не найдено оглавление архива");
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new UnsafeArchiveError("Архив слишком большой (zip64) — не поддерживается");
  if (total > MAX_ENTRIES) throw new UnsafeArchiveError("В файле слишком много вложенных частей");
  if (cdOffset + cdSize > buf.length) throw new UnsafeArchiveError("Файл повреждён: оглавление архива за пределами файла");
  let p = cdOffset;
  let unpacked = 0;
  let packed = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new UnsafeArchiveError("Файл повреждён: ошибка оглавления архива");
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    if (usize > MAX_ENTRY_UNPACKED) throw new UnsafeArchiveError("Внутри файла слишком большая часть — похоже на архив-бомбу");
    unpacked += usize;
    packed += csize;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  if (unpacked > MAX_TOTAL_UNPACKED) throw new UnsafeArchiveError("Файл после распаковки получается слишком большим (больше 250 МБ)");
  if (packed > 0 && unpacked / packed > MAX_RATIO && unpacked > 20 * 1024 * 1024) throw new UnsafeArchiveError("Подозрительная степень сжатия — похоже на архив-бомбу");
}
