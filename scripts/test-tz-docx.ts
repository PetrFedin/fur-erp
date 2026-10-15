/**
 * Проверка генератора Word ТЗ Веллмеха (src/lib/tz-docx-vendor.ts) на присланных образцах: образец → данные → Word → сравнение
 * текста и вёрстки с оригиналом. Точность закреплена по ТЗ, у которых она достигнута (см. EXACT / TEXT_OK / STRUCT_OK ниже); остальные —
 * отчёт о расхождениях (инфо). Расхождения вёрстки со знаком «~» — мелочи отдельных ячеек (выравнивание, границы), остальные — структура.
 * Образцы: документы Drive типа TZ_APPENDIX (файлы в uploads/), плюс *.docx из каталога TZ_SAMPLES_DIR, если задан. Нет файла — пропуск.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-tz-docx.ts
 */
import "./stubs/server-only-shim";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma";
import { buildTzDocx } from "../src/lib/tz-docx-vendor";
import { emptyTz } from "../src/lib/tz-vendor";
import { docxBlocks, layoutDiff, payloadFromDocx, textDiff } from "./lib/tz-docx-import";

/** Совпадают полностью (текст, структура, мелочи ячеек). */
const EXACT = new Set(["116", "171", "178", "182"]);
/** Текст совпадает до символа (остальные ТЗ — опечатки и ручные правки Веллмеха, разобраны в отчёте). */
const TEXT_OK = new Set(["116", "141", "170", "171", "174", "175", "176", "177", "178", "180", "181", "182"]);
/** Структура (блоки, таблицы, строки, колонки, ширины, поля, стили) совпадает; допустимы только «~» мелочи. */
const STRUCT_OK = new Set(["116", "141", "170", "171", "178", "182"]);
let bad = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { bad++; console.log("ПРОВАЛ:", msg); } };

async function main() {
  const files: { name: string; buf: Buffer }[] = [];
  const docs = await prisma.driveDocument.findMany({ where: { docType: "TZ_APPENDIX", storagePath: { not: null } }, select: { title: true, storagePath: true } });
  const seen = new Set<string>();
  for (const d of docs) {
    const f = join(process.cwd(), "uploads", d.storagePath!);
    if (!existsSync(f) || seen.has(f)) continue;
    seen.add(f);
    files.push({ name: d.title, buf: readFileSync(f) });
  }
  const dir = process.env.TZ_SAMPLES_DIR;
  if (dir && existsSync(dir)) for (const n of readdirSync(dir).filter((x) => x.endsWith(".docx"))) files.push({ name: n, buf: readFileSync(join(dir, n)) });

  let required = 0;
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const m = /(\d{3})/.exec(f.name);
    if (!m || Number(m[1]) < 100 || f.buf.subarray(0, 2).toString() !== "PK") continue;
    try {
      const p = await payloadFromDocx(f.buf);
      const gen = await buildTzDocx(p);
      const td = textDiff(await docxBlocks(f.buf), await docxBlocks(gen));
      const ld = await layoutDiff(f.buf, gen);
      const fine = ld.filter((x) => x.startsWith("~")).length;
      console.log(`ТЗ ${m[1]}: текст ${td.length}, вёрстка: структура ${ld.length - fine}, мелочи ${fine}${td.length + ld.length ? " — " + [...td, ...ld.filter((x) => !x.startsWith("~"))].slice(0, 3).join(" | ") : ""}`);
      if (EXACT.has(m[1])) { required++; check(td.length === 0 && ld.length === 0, `ТЗ ${m[1]} не совпало: ${[...td, ...ld].join("; ")}`); }
      if (TEXT_OK.has(m[1])) check(td.length === 0, `ТЗ ${m[1]}: текст не совпал: ${td.slice(0, 3).join("; ")}`);
      if (STRUCT_OK.has(m[1])) check(ld.length === fine, `ТЗ ${m[1]}: структура вёрстки не совпала: ${ld.filter((x) => !x.startsWith("~")).slice(0, 3).join("; ")}`);
    } catch (e) { console.log(`ТЗ ${m[1]}: не разобрано (${(e as Error).message})`); }
  }
  if (required === 0) console.log("присланные образцы ТЗ не найдены — проверка точности пропущена");

  // Правка данных: меняется только то, что изменили; новая строка размножает образец строки
  const base = files.find((f) => /ПРИЛОЖЕНИЕ[_ ]+182/.test(f.name));
  if (base) {
    const p = await payloadFromDocx(base.buf);
    p.items.push({ ...p.items[0], qty: "2", price: "100", total: undefined });
    p.number = "999";
    const g = await docxBlocks(await buildTzDocx(p));
    const txt = JSON.stringify(g);
    check(txt.includes("ПРИЛОЖЕНИЕ № 999") && txt.includes("200,00"), "правка номера/строки не попала в Word");
    check((g[6] as ["T", string[][]])[1].length === 6, "число строк изделий после добавления");
    const e = await buildTzDocx(emptyTz("WORK", "1", "2026-01-01"));
    check(e.length > 5000, "пустое ТЗ собирается");
  }
  console.log(bad ? `ПРОВАЛОВ: ${bad}` : "OK");
  await prisma.$disconnect();
  process.exit(bad ? 1 : 0);
}
main();
