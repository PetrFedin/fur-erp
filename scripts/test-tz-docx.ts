/**
 * Проверка генератора Word ТЗ Веллмеха (src/lib/tz-docx-vendor.ts) на присланных образцах: образец → данные → Word → сравнение
 * текста и вёрстки с оригиналом. ТЗ 182 обязано совпасть полностью; остальные — отчёт о расхождениях (инфо).
 * Образцы: документы Drive типа TZ_APPENDIX (файлы в uploads/), плюс *.docx из каталога TZ_SAMPLES_DIR, если задан. Нет файла — пропуск.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-tz-docx.ts
 */
import "./stubs/server-only-shim";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma";
import { buildTzDocx } from "../src/lib/tz-docx-vendor";
import { emptyTz } from "../src/lib/tz-vendor";
import { docxBlocks, layoutDiff, payloadFromBlocks, textDiff } from "./lib/tz-docx-import";

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
      const p = payloadFromBlocks(await docxBlocks(f.buf));
      const gen = await buildTzDocx(p);
      const td = textDiff(await docxBlocks(f.buf), await docxBlocks(gen));
      const ld = await layoutDiff(f.buf, gen);
      console.log(`ТЗ ${m[1]}: текст ${td.length}, вёрстка ${ld.length}${td.length + ld.length ? " — " + [...td, ...ld].slice(0, 3).join(" | ") : ""}`);
      if (m[1] === "182") { required++; check(td.length === 0 && ld.length === 0, `ТЗ 182 не совпало: ${[...td, ...ld].join("; ")}`); }
    } catch (e) { console.log(`ТЗ ${m[1]}: не разобрано (${(e as Error).message})`); }
  }
  if (required === 0) console.log("образец ТЗ 182 не найден — проверка точности пропущена");

  // Правка данных: меняется только то, что изменили; новая строка размножает образец строки
  const base = files.find((f) => /ПРИЛОЖЕНИЕ[_ ]+182/.test(f.name));
  if (base) {
    const p = payloadFromBlocks(await docxBlocks(base.buf));
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
