/**
 * Проверка фото артикулов, ссылок магазина и PLU. Только чтение (БД и файлы не меняются).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-article-photos.ts
 * 1. Нормализация PLU (кириллица НЕ → HE), сопоставление артикулов (только при 100% совпадении кода).
 * 2. Целостность: каждое фото ссылается на существующий файл и миниатюру, нет дублей id/файлов, ссылки магазина — только tsum.ru/product.
 * 3. PLU: формат HE…, один PLU не принадлежит двум артикулам/вариантам.
 * 4. Подрядчик: исходники его кабинета не читают ссылки магазина и свойства; фото-API не отдаёт ссылок. (Проверка по HTTP — в test-security.ts.)
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

let fails = 0, total = 0;
const ok = (c: unknown, m: string) => { total++; console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };

async function main() {
  const { normalizePlu, matchArticle, leadingCode, pluParamName, pluMatchIds, isPluParam } = await import("../src/lib/article-photo-match");
  const { readPhotos, readLinks, PHOTOS_KEY, LINKS_KEY } = await import("../src/lib/article-photos");
  const { readParams } = await import("../src/lib/article-params");
  const { UPLOAD_ROOT } = await import("../src/lib/fitting-files");
  const { prisma } = await import("../src/lib/prisma");

  console.log("== 1. Нормализация и сопоставление");
  ok(normalizePlu("НЕ00924905") === "HE00924905", "кириллическое «НЕ» → латинское «HE»");
  ok(normalizePlu(" he00924905 ") === "HE00924905", "регистр и пробелы");
  ok(normalizePlu("Не 00924905") === "HE00924905", "смешанный регистр, пробел внутри");
  ok(normalizePlu("7130928") === null && normalizePlu("M001A/SABLE WILD/SABLE WILD") === null && normalizePlu(null) === null && normalizePlu("") === null, "не-HE коды и мусор → пусто");
  ok(leadingCode("MGL-01 SABLE FARM+MINK")?.code === "MGL-01" && leadingCode("M007/ LYNX")?.variant === "LYNX", "код и вариант: «MGL-01 …», «M007/ LYNX»");
  const models = [
    { id: "a", name: "M001", salesCode: "M001", aliases: ["M001/X"] },
    { id: "b", name: "M001A", salesCode: "M001A", aliases: ["M001A/SABLE WILD SILVER 4-5"] },
    { id: "c", name: "М002", salesCode: "M002", aliases: [] },
    { id: "d", name: "MCF01", salesCode: "MCF-01", aliases: ["MCF-01/SABLE"] },
    { id: "e", name: "DUP1", salesCode: "M777", aliases: [] },
    { id: "f", name: "M777", salesCode: null, aliases: [] },
  ];
  const m1 = matchArticle("M001A/SABLE WILD SILVER 4-5", models);
  ok(m1.ok && m1.modelId === "b" && m1.variant === "SABLE WILD SILVER 4-5", "M001A не путается с M001");
  const m2 = matchArticle("M002/SABLE WILD", models);
  ok(m2.ok && m2.modelId === "c", "кириллица в имени в базе (М002) = латиница в файле");
  const m3 = matchArticle("MCF-01/SABLE FARM", models);
  ok(m3.ok && m3.modelId === "d", "MCF-01 ↔ MCF01 через код продаж");
  ok(!matchArticle("M059/X", models).ok, "артикула нет в базе — не сопоставляется");
  ok(!matchArticle("M777/X", models).ok, "код у двух артикулов — неоднозначно, не сопоставляется");
  ok(pluParamName("MINK BGL", true) === "PLU MINK BGL" && pluParamName("MINK BGL", false) === "PLU" && pluParamName("", true) === "PLU", "имя свойства PLU: с подписью варианта только при нескольких вариантах");
  const all = new Map([["x", [{ name: "PLU", value: "HE00924905, HE00958542" }]], ["y", [{ name: "Цвет", value: "HE00924905" }]]]);
  ok(pluMatchIds(all, "НЕ00924905").join() === "x" && pluMatchIds(all, "HE").length === 0 && isPluParam("PLU MINK"), "поиск по PLU: кириллица понимается, «HE» не находит всё, чужие свойства не считаются");

  console.log("\n== 2–3. Целостность данных (текущая база)");
  const rows = await prisma.systemState.findMany({ where: { OR: [{ key: { startsWith: PHOTOS_KEY } }, { key: { startsWith: LINKS_KEY } }] }, select: { key: true, value: true } });
  const ids = new Set<string>(), files = new Set<string>();
  let nPhotos = 0, missing = 0, dup = 0, badLinks = 0, nLinks = 0;
  for (const r of rows) {
    if (r.key.startsWith(PHOTOS_KEY)) {
      const raw = (r.value as { photos?: unknown[] }).photos ?? [];
      const list = readPhotos(r.value);
      if (list.length !== raw.length) badLinks++;
      for (const p of list) {
        nPhotos++;
        if (ids.has(p.id) || files.has(p.file)) dup++;
        ids.add(p.id); files.add(p.file);
        if (!existsSync(join(UPLOAD_ROOT, p.file)) || !existsSync(join(UPLOAD_ROOT, p.thumb))) missing++;
        if (!resolve(UPLOAD_ROOT, p.file).startsWith(UPLOAD_ROOT) || !p.file.startsWith("article-photos")) missing++;
      }
    } else {
      const raw = (r.value as { links?: unknown[] }).links ?? [];
      const list = readLinks(r.value);
      nLinks += list.length;
      if (list.length !== raw.length) badLinks++;
    }
  }
  ok(missing === 0, `все ${nPhotos} фото и миниатюры — существующие файлы внутри хранилища`);
  ok(dup === 0, "нет дублей id и файлов фото");
  ok(badLinks === 0, `все записи фото и ${nLinks} ссылок магазина корректны (только https://www.tsum.ru/product/…)`);
  const models2 = await prisma.productModel.findMany({ select: { id: true, name: true, attributes: true } });
  const owner = new Map<string, string>();
  let badPlu = 0, shared = 0;
  for (const m of models2) for (const p of readParams(m.attributes)) {
    if (!isPluParam(p.name)) continue;
    for (const v of p.value.split(/\s*,\s*/).filter(Boolean)) {
      if (normalizePlu(v) !== v) badPlu++;
      const o = owner.get(v);
      if (o && o !== `${m.id}|${p.name}`) shared++;
      owner.set(v, `${m.id}|${p.name}`);
    }
  }
  ok(badPlu === 0, `все ${owner.size} PLU в формате HE + цифры, латиницей`);
  ok(shared === 0, "один PLU не стоит у двух артикулов/вариантов");

  console.log("\n== 4. Подрядчик");
  const sup = readFileSync(resolve("src/app/(app)/articles/supplier-view.tsx"), "utf8");
  ok(!/loadShopLinks|article-shop-links|loadAllArticleParams|isPluParam|tsum\.ru/.test(sup), "кабинет подрядчика не читает ссылки магазина и PLU");
  const api = readFileSync(resolve("src/app/api/article-photos/[modelId]/[photoId]/route.ts"), "utf8");
  ok(/getFreshSession\(\{ allowSupplier: true \}\)/.test(api) && !/loadShopLinks|LINKS_KEY/.test(api), "фото-API: вход обязателен, ссылок магазина не читает");
  const search = readFileSync(resolve("src/app/api/search/route.ts"), "utf8");
  ok(/getFreshSession\(\)/.test(search) && !/allowSupplier/.test(search), "глобальный поиск (в т. ч. по PLU) закрыт для подрядчика");
  const card = readFileSync(resolve("src/app/(app)/models/[id]/page.tsx"), "utf8");
  ok(/role === "SUPPLIER"\) redirect\("\/articles"\)/.test(card) && card.indexOf("redirect(\"/articles\")") < card.indexOf("loadShopLinks("), "карточка артикула: подрядчик уходит на /articles до чтения ссылок");

  console.log(`\n${fails === 0 ? "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : fails + " ПРОВЕРОК НЕ ПРОЙДЕНО"} (всего ${total})`);
  await prisma.$disconnect();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
