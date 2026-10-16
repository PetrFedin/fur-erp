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



  console.log("\n== 6. Цвета фото, PLU и ссылка-кнопка");
  const { groupPhotosByColor, variantColorName, galleryExtras, pluOfItem } = await import("../src/lib/article-photo-color");
  const refs = [
    { id: "1", name: "Коричневый", aliases: ["BROWN"] }, { id: "2", name: "Блэкглама", aliases: ["BLACK GLAMA"] }, { id: "3", name: "Пастель", aliases: ["PASTEL"] },
    { id: "4", name: "Чёрный", aliases: ["BLACK"] }, { id: "5", name: "Виолет", aliases: [] }, { id: "6", name: "Лаванда", aliases: ["LAVENDER"] },
  ];
  ok(variantColorName("MINK BGL", refs) === "Блэкглама" && variantColorName("MINK PST", refs) === "Пастель" && variantColorName("MINK LVD", refs) === "Лаванда", "сокращения BGL / PST / LVD → цвета справочника");
  ok(variantColorName("MINK BROWN+CASHMERE", refs) === "Коричневый" && variantColorName("MINK VIOLET", refs) === "Виолет" && variantColorName("SABLE WILD SILVER 4-5", refs) === null, "цвет внутри варианта находится, серебристость соболя — не цвет");
  const ph = [
    { id: "a1", variant: "MINK BROWN", color: "Коричневый", itemId: "HE1" }, { id: "a2", variant: "MINK BROWN" }, { id: "b1", variant: "MINK BGL", color: "Черный" },
    { id: "c1", variant: "SABLE WILD SILVER 5" }, { id: "c2", variant: "MINK BROWN+CASHMERE", color: "Коричневый" },
  ];
  const gr = groupPhotosByColor(ph, refs);
  ok(gr.map((g) => g.photos.length).join() === "2,1,1,1", "фото разложены по вариантам, чужой цвет в группу не попадает");
  ok(gr[0].label === "Коричневый · MINK BROWN" && gr[1].label === "Блэкглама", "подписи групп: из справочника цветов");
  ok(gr[gr.length - 1].undetermined === true && gr[gr.length - 1].label === "Цвет не определён", "«Цвет не определён» — последней группой");
  ok(gr.filter((g) => g.label.startsWith("Коричневый")).every((g) => g.label.includes("·")), "одинаковые названия цвета у разных вариантов различаются вариантом");
  ok(groupPhotosByColor([{ id: "x", variant: "MINK BROWN" }], refs).length === 1, "один цвет — одна группа (переключатель не показывается)");
  ok(pluOfItem("he00924906") === "HE00924906" && pluOfItem("7130192") === null, "PLU берётся только из кодов HE…, числовой код страницы PLU не считается");
  const ex = galleryExtras(ph, [{ itemId: "he1", url: "https://www.tsum.ru/product/he1/" }], refs);
  ok(ex.shops?.HE1?.url.startsWith("https://www.tsum.ru/") && galleryExtras(ph, null, refs).shops === undefined, "ссылки и PLU готовятся только заказчику (links=null → shops нет)");
  const gal2 = readFileSync(resolve("src/components/photo-gallery.tsx"), "utf8");
  ok(/aria-label="Цвета"/.test(gal2) && /Товар в магазине/.test(gal2) && /noopener noreferrer/.test(gal2) && /PLU \{shop\.plu\}/.test(gal2), "окно: вкладки цветов, PLU в шапке, кнопка «Товар в магазине» (noopener noreferrer)");
  ok(!/shops=|itemId|pluOfItem|loadAllShopLinks/.test(sup), "кабинет подрядчика не получает shops, код страницы магазина и PLU");
  ok(/loadAllShopLinks/.test(readFileSync(resolve("src/app/(app)/articles/page.tsx"), "utf8")) && /min-h-11/.test(card), "список «Изделия» и карточка показывают ссылку/PLU заказчику, кнопка ≥44px");
  const listSrc = readFileSync(resolve("src/app/(app)/articles/page.tsx"), "utf8");
  ok(/ath\("photos"\)\}>Фото<\/Th>/.test(listSrc) && /ath\("plu"\)\}>PLU<\/Th>/.test(listSrc) && /photos: \(r\) => photoSummary\.get\(r\.id\)\?\.length/.test(listSrc), "список «Изделия»: отдельные столбцы «Фото» (сортировка по числу) и «PLU» (по тексту), ссылка — узкий столбец");
  ok(!/supplierNote/.test(listSrc) && /подрядчик: \{r\.supplierWork\}/.test(listSrc), "строка «работа … · шкур …» убрана из ячейки артикула и перенесена во вторые строки столбцов «Работа» и «Шкур»");
  ok(/<Th>Фото<\/Th>/.test(sup) && !/PLU|plu|shopLinks|↗/.test(sup.replace(/\/\/.*$/gm, "")), "кабинет подрядчика: столбец «Фото» есть, PLU и ссылки нет");
  const ps = await prisma.systemState.findMany({ where: { key: { startsWith: PHOTOS_KEY } }, select: { key: true, value: true } });
  let noItem = 0, orphan = 0;
  for (const r of ps) {
    const links = readLinks((await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: (await prisma.organization.findFirstOrThrow()).id, key: LINKS_KEY + r.key.slice(PHOTOS_KEY.length) } } }))?.value);
    for (const p of readPhotos(r.value)) { if (!p.itemId) noItem++; else if (!links.some((l) => l.itemId.toUpperCase() === p.itemId)) orphan++; }
  }
  ok(orphan === 0, "каждое фото с кодом страницы ссылается на существующую ссылку магазина артикула");
  console.log(`   (фото без кода страницы: ${noItem} — до запуска sync-article-photo-colors они в группе по варианту)`);

  console.log("\n== 5. Удаление фото (кнопка в окне «Фото»)");
  const act = readFileSync(resolve("src/app/(app)/models/photo-actions.ts"), "utf8");
  ok(/requireRole\(\.\.\.ACCESS\.models\)/.test(act) && !/allowSupplier|"SUPPLIER"/.test(act), "server action: роль проверяется на сервере (владелец/админ/технолог), подрядчик не допускается");
  ok(!/onDelete|photo-actions/.test(sup), "кабинет подрядчика не получает функций удаления фото");
  ok(/canEdit \? \{ onDelete/.test(card), "карточка артикула передаёт удаление только при праве редактирования");
  const gal = readFileSync(resolve("src/components/photo-gallery.tsx"), "utf8");
  ok(/Удалить это фото\?/.test(gal) && /Удалить все фото артикула/.test(gal) && /size-11/.test(gal), "окно: подтверждение «Удалить это фото?», пункт «Удалить все фото артикула», цели касания 44px");
  const liveDb = /\/fur_erp(\?|$)/.test(process.env.DATABASE_URL ?? "");
  if (liveDb) {
    console.log("   (боевая база: проверка записи пропущена — запустите на scratch-базе)");
  } else {
    const { rawPrisma } = await import("../src/lib/prisma");
    const { deleteArticlePhotos } = await import("../src/lib/article-photo-delete");
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const org = await rawPrisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const taken = new Set((await rawPrisma.systemState.findMany({ where: { key: { startsWith: PHOTOS_KEY } }, select: { key: true } })).map((r) => r.key.slice(PHOTOS_KEY.length)));
    const model = (await rawPrisma.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true } })).find((m) => !taken.has(m.id));
    if (!model) { ok(false, "нет артикула без фото для проверки"); } else {
      const dirRel = join("article-photos", org.id, model.id);
      mkdirSync(join(UPLOAD_ROOT, dirRel), { recursive: true });
      const mk = (id: string) => { const f = join(dirRel, id + ".jpg"), t = join(dirRel, id + "-t.jpg"); writeFileSync(join(UPLOAD_ROOT, f), "x"); writeFileSync(join(UPLOAD_ROOT, t), "x"); return { id, file: f, thumb: t, w: 1, h: 1, variant: "" }; };
      const ids = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"];
      const photos = ids.map(mk);
      await rawPrisma.systemState.create({ data: { organizationId: org.id, key: PHOTOS_KEY + model.id, value: { photos } } });
      const actor = { id: "test-user", name: "Тест", role: "OWNER", organizationId: org.id };
      const stranger = { ...actor, organizationId: "other-org-000" };
      const exists = (rel: string) => existsSync(join(UPLOAD_ROOT, rel));
      const cur = async () => readPhotos((await rawPrisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: PHOTOS_KEY + model.id } } }))?.value);
      const bad = await deleteArticlePhotos(rawPrisma, stranger, model.id, ids[0]);
      ok(!bad.ok && (await cur()).length === 3 && exists(photos[0].file), "чужая организация: удаление отклонено, фото и файлы целы");
      const none = await deleteArticlePhotos(rawPrisma, actor, model.id, "aaaaaaaa-0000-4000-8000-0000000000ff");
      ok(!none.ok && (await cur()).length === 3, "несуществующее фото: ошибка, ничего не удалено");
      const odd = await deleteArticlePhotos(rawPrisma, actor, model.id, "../../etc");
      ok(!odd.ok, "некорректный id фото отклонён");
      const r1 = await deleteArticlePhotos(rawPrisma, actor, model.id, ids[1]);
      const after = await cur();
      ok(r1.ok && r1.left === 2 && after.map((p) => p.id).join() === [ids[0], ids[2]].join(), "одно фото: в записи осталось 2, порядок сохранён");
      ok(!exists(photos[1].file) && !exists(photos[1].thumb) && exists(photos[0].file) && exists(photos[2].thumb), "файлы удалённого фото (оригинал и миниатюра) стёрты, остальные целы");
      const log = await rawPrisma.auditLog.findFirst({ where: { model: "ArticlePhoto", recordId: model.id }, orderBy: { at: "desc" } });
      ok(!!log && log.action === "delete" && /Удалено фото артикула/.test(log.label ?? "") && log.actorId === "test-user" && log.organizationId === org.id, "журнал изменений: «Удалено фото артикула …», кто и когда");
      const r2 = await deleteArticlePhotos(rawPrisma, actor, model.id, null);
      const row = await rawPrisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: PHOTOS_KEY + model.id } } });
      ok(r2.ok && r2.removed === 2 && !row && !exists(photos[0].file) && !exists(photos[2].file) && !existsSync(join(UPLOAD_ROOT, dirRel)), "«Удалить все»: запись и все файлы стёрты, пустой каталог убран");
      const again = await deleteArticlePhotos(rawPrisma, actor, model.id, null);
      ok(!again.ok, "у артикула без фото «удалить все» — понятная ошибка");
      await rawPrisma.auditLog.deleteMany({ where: { model: "ArticlePhoto", recordId: model.id } });
      rmSync(join(UPLOAD_ROOT, dirRel), { recursive: true, force: true });
    }
  }

  console.log("\n== 7. Редактор «Магазин и фото»: правила");
  const core = await import("../src/lib/article-shop-core");
  ok(core.normalizePluToken("НЕ 00924905") === "HE00924905" && core.normalizePluToken(" he-12 ") === "HE-12" && core.normalizePluToken("a") === null && core.normalizePluToken("<script>") === null, "PLU: кириллица → латиница, пробелы убраны, верхний регистр, мусор отклонён");
  const pl = core.parsePluList("НЕ00111222, he00111222 ; HE00222333");
  ok("plus" in pl && pl.plus.join() === "HE00111222,HE00222333", "список PLU через запятую/;: повторы убраны");
  ok("error" in core.parsePluList("HE1, ???"), "список PLU с мусором — ошибка");
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@x.ru/a", "ftp://x.ru/a", "data:text/html,x", "https://x", "https://x.ru/" + "a".repeat(500), "https://x.ru/a b"]) ok("error" in core.validateShopUrl(bad), `ссылка отвергнута: ${bad.slice(0, 32)}`);
  ok("url" in core.validateShopUrl("https://www.tsum.ru/product/x/") && "url" in core.validateShopUrl("http://shop.example.com/p?id=1") && (core.validateShopUrl("") as { url: string }).url === "", "https/http-ссылки и пустое значение допустимы");
  ok(readLinks({ links: [{ variant: "", itemId: "", url: "javascript:alert(1)" }, { variant: "", itemId: "", url: "https://a.ru/p" }] }).length === 1, "чтение записи ссылок отбрасывает опасные адреса");
  const bp = core.buildPluParams([{ variant: "A", plus: ["HE1111"] }, { variant: "B", plus: [] }]);
  const bp2 = core.buildPluParams([{ variant: "A", plus: ["HE1111"] }, { variant: "B", plus: ["HE2222"] }]);
  ok(Array.isArray(bp) && bp[0].name === "PLU" && Array.isArray(bp2) && bp2.map((x) => x.name).join() === "PLU A,PLU B", "свойства PLU: «PLU» для одного цвета, «PLU <цвет>» для нескольких");
  const { processPhotoBuffer } = await import("../src/lib/article-photo-upload");
  const sharp = (await import("sharp")).default;
  const jpg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#a33" } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 500, height: 800, channels: 4, background: "#3a3" } }).png().toBuffer();
  const rj = await processPhotoBuffer(jpg), rp = await processPhotoBuffer(png);
  ok(rj.ok && Math.max(rj.w, rj.h) === 1600 && (await sharp(rj.full).metadata()).format === "jpeg" && Math.max((await sharp(rj.thumb).metadata()).width!, (await sharp(rj.thumb).metadata()).height!) <= 400, "jpg: длинная сторона 1600, результат jpg, миниатюра ≤400");
  ok(rp.ok && (await sharp(rp.full).metadata()).format === "jpeg" && rp.h === 800, "png → jpg без увеличения");
  const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300, 1)]);
  ok(!(await processPhotoBuffer(exe)).ok, "exe под именем .jpg отклонён (проверка по содержимому)");
  ok(!(await processPhotoBuffer(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50, 7)]))).ok, "битый jpeg с верной сигнатурой отклонён");
  ok(!(await processPhotoBuffer(Buffer.alloc(core.PHOTO_MAX_BYTES + 1, 0xff))).ok && !(await processPhotoBuffer(Buffer.alloc(0))).ok, "лимит 15 МБ и пустой файл");
  const actSrc = readFileSync(resolve("src/app/(app)/models/shop-actions.ts"), "utf8");
  ok((actSrc.match(/requireRole\(\.\.\.ACCESS\.models\)/g) ?? []).length === 3 && !/allowSupplier|"SUPPLIER"/.test(actSrc), "все три действия редактора: роль на сервере, подрядчик не допускается");
  const upSrc = readFileSync(resolve("src/app/api/article-photos/[modelId]/route.ts"), "utf8");
  ok(/hasRole\(session\.user\.role, ACCESS\.models\)/.test(upSrc) && /status: 403/.test(upSrc), "загрузка фото по HTTP: подрядчику 403");
  ok(!/ArticleShopEditor|shop-actions|article-shop/.test(sup), "кабинет подрядчика не содержит редактор");
  ok(/sp\.shop === "1"/.test(card) && /canEdit && <ArticleShopEditor/.test(card), "карточка: редактор только при праве правки, открывается по ?shop=1 (после «+ Новый артикул»)");
  ok(/canCreate && <ArticleShopEditor/.test(listSrc), "список «Изделия»: карандаш только при праве правки");

  if (!liveDb) {
    console.log("\n== 8. Редактор: запись (копия базы)");
    const { rawPrisma } = await import("../src/lib/prisma");
    const { Prisma } = await import("@prisma/client");
    const { saveShop, loadShopEditor } = await import("../src/lib/article-shop");
    const { stageArticlePhoto } = await import("../src/lib/article-photo-upload");
    const { rmSync, writeFileSync, mkdirSync } = await import("node:fs");
    const org = await rawPrisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const models = await rawPrisma.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, attributes: true } });
    const taken = new Set((await rawPrisma.systemState.findMany({ where: { key: { startsWith: PHOTOS_KEY } }, select: { key: true } })).map((r) => r.key.slice(PHOTOS_KEY.length)));
    const free = models.filter((m) => !taken.has(m.id));
    const m1 = free[0], m2 = free[1];
    if (!m1 || !m2) ok(false, "нужны два артикула без фото");
    else {
      const actor = { id: "test-user", name: "Тест", role: "OWNER", organizationId: org.id };
      const stranger = { ...actor, organizationId: "other-org-000" };
      const dir = join(UPLOAD_ROOT, "article-photos", org.id, m1.id);
      const cleanup = async () => {
        for (const m of [m1, m2]) {
          await rawPrisma.systemState.deleteMany({ where: { organizationId: org.id, key: { in: [PHOTOS_KEY + m.id, LINKS_KEY + m.id] } } });
          await rawPrisma.productModel.update({ where: { id: m.id }, data: { attributes: (m.attributes ?? Prisma.DbNull) as never } });
        }
        await rawPrisma.auditLog.deleteMany({ where: { model: "ArticlePhoto", recordId: { in: [m1.id, m2.id] } } });
        rmSync(dir, { recursive: true, force: true });
      };
      try {
        const st = await stageArticlePhoto(rawPrisma, org.id, m1.id, jpg);
        const st2 = await stageArticlePhoto(rawPrisma, org.id, m1.id, png);
        ok(st.ok && st2.ok && existsSync(join(dir, (st as { photo: { id: string } }).photo.id + ".jpg")) && existsSync(join(dir, (st as { photo: { id: string } }).photo.id + "-t.jpg")), "загрузка jpg и png: файл и миниатюра лежат в каталоге артикула организации");
        ok(!(await stageArticlePhoto(rawPrisma, "other-org-000", m1.id, jpg)).ok, "чужая организация: загрузка отклонена");
        ok(!(await stageArticlePhoto(rawPrisma, org.id, "../../etc", jpg)).ok, "путь вида ../ в id артикула отклонён");
        const ids = [(st as { photo: { id: string } }).photo.id, (st2 as { photo: { id: string } }).photo.id];
        const payload = (over: object = {}) => ({ rows: [{ key: "ТЕСТ", plu: "НЕ 00777001", url: "https://shop.example.com/p/1", label: "Тест" }], photos: ids.map((id) => ({ id, variant: "ТЕСТ", color: "Тест" })), known: [], ...over });
        ok(!(await saveShop(rawPrisma, stranger, m1.id, payload())).ok, "чужая организация: сохранение отклонено");
        ok(!(await saveShop(rawPrisma, actor, m1.id, payload({ photos: [{ id: "../../etc/passwd", variant: "" }] }))).ok, "path traversal в id фото отклонён");
        ok(!(await saveShop(rawPrisma, actor, m1.id, payload({ photos: [{ id: "aaaaaaaa-0000-4000-8000-0000000000aa", variant: "ТЕСТ" }] }))).ok, "фото, которого не загружали, не принимается");
        ok(!(await saveShop(rawPrisma, actor, m1.id, payload({ rows: [{ key: "ТЕСТ", plu: "HE1111", url: "javascript:alert(1)" }] }))).ok, "javascript:-ссылка не сохраняется");
        ok(!(await saveShop(rawPrisma, actor, m1.id, payload({ photos: Array.from({ length: 61 }, (_, k) => ({ id: `bbbbbbbb-0000-4000-8000-${String(k).padStart(12, "0")}`, variant: "" })) }))).ok, "больше 60 фото на артикул — отказ");
        const r = await saveShop(rawPrisma, actor, m1.id, payload());
        const ph = readPhotos((await rawPrisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: PHOTOS_KEY + m1.id } } }))?.value);
        const lk = readLinks((await rawPrisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: LINKS_KEY + m1.id } } }))?.value);
        const at = readParams((await rawPrisma.productModel.findUnique({ where: { id: m1.id }, select: { attributes: true } }))?.attributes);
        ok(r.ok && ph.length === 2 && ph[0].variant === "ТЕСТ" && ph[0].color === "Тест" && ph[0].w > 0, "сохранено: два фото с цветом, размеры записаны");
        ok(lk.length === 1 && lk[0].url === "https://shop.example.com/p/1", "ссылка записана в article-shop-links");
        ok(at.some((x) => x.name === "PLU" && x.value === "HE00777001"), "PLU записан свойством «PLU» с кириллицей → латиница");
        const log = await rawPrisma.auditLog.findFirst({ where: { model: "ArticlePhoto", recordId: m1.id, action: "update" } });
        ok(!!log && /^Изменены PLU\/ссылка\/фото артикула/.test(log.label ?? "") && log.actorId === "test-user" && !JSON.stringify(log.changes).includes("shop.example.com"), "журнал: «Изменены PLU/ссылка/фото…», автор есть, адреса ссылки нет");
        ok((await saveShop(rawPrisma, actor, m1.id, { rows: [{ key: "ТЕСТ", plu: "HE00777001", url: "https://shop.example.com/p/1" }], photos: [...ids].reverse().map((id) => ({ id, variant: "ТЕСТ" })), known: ids })).ok && readPhotos((await rawPrisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: PHOTOS_KEY + m1.id } } }))?.value)[0].id === ids[1], "порядок фото меняется и сохраняется");
        const d1 = await saveShop(rawPrisma, actor, m2.id, { rows: [{ key: "", plu: "HE00777001", url: "" }], photos: [], known: [] });
        ok(!d1.ok && d1.dupes?.[0]?.article === m1.name, "тот же PLU у другого артикула: предупреждение с названием артикула");
        const d2 = await saveShop(rawPrisma, actor, m2.id, { rows: [{ key: "", plu: "HE00777001", url: "" }], photos: [], known: [], allowDup: true });
        ok(d2.ok, "после подтверждения дубль PLU сохраняется");
        const ed = await loadShopEditor(rawPrisma, org.id, m1.id);
        ok(ed?.rows[0]?.plu === "HE00777001" && ed.rows[0].url === "https://shop.example.com/p/1" && ed.photos.length === 2, "окно читает то, что записал редактор");
        const rm = await saveShop(rawPrisma, actor, m1.id, { rows: [{ key: "ТЕСТ", plu: "", url: "" }], photos: [{ id: ids[0], variant: "ТЕСТ" }], known: ids });
        ok(rm.ok && !existsSync(join(dir, ids[1] + ".jpg")) && !existsSync(join(dir, ids[1] + "-t.jpg")) && existsSync(join(dir, ids[0] + ".jpg")), "убранное фото: файлы стёрты, остальное цело; пустые PLU и ссылка очищены");
        const lk2 = await rawPrisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: LINKS_KEY + m1.id } } });
        ok(!lk2, "пустая ссылка — запись article-shop-links удалена");
        void writeFileSync; void mkdirSync;
      } finally { await cleanup(); }
    }
  }

  console.log(`\n${fails === 0 ? "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : fails + " ПРОВЕРОК НЕ ПРОЙДЕНО"} (всего ${total})`);
  await prisma.$disconnect();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
