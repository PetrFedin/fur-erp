/**
 * Проверка Word Веллмеха «из данных ТЗ нашей базы» (src/lib/tz-from-orders*.ts → tz-docx-vendor.ts) на выборке ТЗ разных вариантов:
 * ремонт, пошив с подкладкой и без, несколько позиций в одном ТЗ, составной цвет, разные виды меха.
 * Для каждого ТЗ выборки: документ собирается, открывается как docx (zip + разбор блоков), содержит нужные разделы, а цифры
 * (изделия, работа, расход сырья по лотам, итоги) равны данным ТЗ. Только чтение базы.
 * Если среди сохранённых Word (Drive TZ_APPENDIX) есть присланный оригинал этого ТЗ — сверяются количество, работа и состав сырья с ним.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-tz-from-orders.ts
 */
import "./stubs/server-only-shim";
import Module from "module";
import JSZip from "jszip";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Decimal } from "@prisma/client/runtime/library";
import { docxBlocks, payloadFromDocx } from "./lib/tz-docx-import";

// маршрут /api/production/[id]/word: подмена сессии, как в других тестах
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "@/lib/session") return join(__dirname, "stubs", "session-stub.js");
  return origResolve.call(this, req, ...rest);
};
let bad = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { bad++; console.log("ПРОВАЛ:", msg); } };
const num = (s: string) => Number(String(s).replace(/[\s ]/g, "").replace(",", ".")) || 0;
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { loadTzFromOrders } = await import("../src/lib/tz-from-orders-server");
  const { buildTzDocx } = await import("../src/lib/tz-docx-vendor");
  const { orderUnits } = await import("../src/lib/production-totals");
  const { lineWith4, usageInput } = await import("../src/lib/commission4");

  // сохранённые присланные Word: номер ТЗ → файл
  const originals = new Map<string, Buffer>();
  for (const d of await prisma.driveDocument.findMany({ where: { docType: "TZ_APPENDIX", storagePath: { not: null } }, select: { storagePath: true } })) {
    const f = join(process.cwd(), "uploads", d.storagePath!);
    if (!existsSync(f)) continue;
    const buf = readFileSync(f);
    if (buf.subarray(0, 2).toString() !== "PK") continue;
    try { const p = await payloadFromDocx(buf); if (p.items.length) originals.set(p.number, buf); } catch { /* другой вид документа */ }
  }

  // группы ТЗ и ключи вариантов
  const all = await prisma.productionOrder.findMany({
    select: { id: true, organizationId: true, workOrderNumber: true, productModel: { select: { category: true } }, colors: { select: { id: true } }, materialUsages: { select: { rawMaterial: { select: { unit: true, name: true } } } } },
    orderBy: { number: "asc" },
  });
  const groups = new Map<string, typeof all>();
  for (const o of all) { const k = o.workOrderNumber?.trim() || o.id; groups.set(k, [...(groups.get(k) ?? []), o]); }
  const variantOf = (g: typeof all) => {
    const cat = g[0].productModel.category ?? "?";
    const lining = g.some((o) => o.materialUsages.some((u) => u.rawMaterial.unit === "M")) ? "подкладка" : "без подкладки";
    const fur = (g.flatMap((o) => o.materialUsages.map((u) => u.rawMaterial.name))[0] ?? "без сырья").split(" ")[0];
    return [cat, lining, g.length > 1 ? "несколько позиций" : "одна позиция", g.some((o) => o.colors.length) ? "составной цвет" : "", fur].filter(Boolean).join(" · ");
  };
  const byVariant = new Map<string, { key: string; g: typeof all }[]>();
  for (const [key, g] of groups) { const v = variantOf(g); byVariant.set(v, [...(byVariant.get(v) ?? []), { key, g }]); }
  // выборка: по одному ТЗ каждого варианта (с присланным оригиналом — в первую очередь), затем ТЗ с оригиналами, пока не наберётся 20
  const sample: { key: string; g: typeof all; variant: string }[] = [];
  for (const [v, list] of byVariant) { const pick = list.find((x) => originals.has(x.key)) ?? list[0]; sample.push({ ...pick, variant: v }); }
  sample.splice(30);
  // ТЗ с присланным Word, не попавшие в выборку по варианту, добавляются сверх неё
  for (const [v, list] of byVariant) for (const x of list) if (originals.has(x.key) && !sample.some((s) => s.key === x.key)) sample.push({ ...x, variant: v });
  console.log(`вариантов ТЗ в базе: ${byVariant.size}, в выборке ТЗ: ${sample.length}, из них с присланным Word: ${sample.filter((s) => originals.has(s.key)).length}`);
  check(sample.length >= 15, `в выборке меньше 15 ТЗ (${sample.length})`);

  let checkedOrig = 0, matMatched = 0;
  for (const s of sample) {
    const first = s.g[0];
    const r = await loadTzFromOrders(first.organizationId, first.id);
    check(!!r, `ТЗ ${s.key}: не загрузилось`);
    if (!r) continue;
    const p = r.payload;
    const label = `ТЗ ${p.number} [${s.variant}]`;
    if (!r.complete) { console.log(`${label}: данных не хватает на полный документ (${r.missing.join("; ")}) — остаётся печатная форма`); continue; }
    const buf = await buildTzDocx(p);
    // 1) открывается как docx
    const zip = await JSZip.loadAsync(buf).catch(() => null);
    check(!!zip && !!zip.file("word/document.xml") && !!zip.file("[Content_Types].xml"), `${label}: не открывается как docx`);
    const blocks = await docxBlocks(buf);
    const text = JSON.stringify(blocks);
    // 2) разделы
    for (const need of [`ПРИЛОЖЕНИЕ № ${p.number}`, "ТЕХНИЧЕСКОЕ ЗАДАНИЕ", "ЗАКАЗЧИК ПЕРЕДАЛ", "Общая стоимость настоящего", "Порядок оплаты", "ПОДПИСИ СТОРОН", "Генеральный директор"]) check(text.includes(need), `${label}: нет «${need}»`);
    const tables = blocks.filter((b): b is ["T", string[][]] => b[0] === "T").map((b) => b[1]);
    const items = tables[1].filter((row) => /^\d+\.?$/.test(row[0].trim()));
    const itemsTotal = tables[1][tables[1].length - 1];
    const mats = tables[2].filter((row, i) => i >= 2 && row.length >= 7 && row[0].trim() && !/^ИТОГО/i.test(row[0]));
    // 3) цифры равны данным ТЗ
    const full = await prisma.productionOrder.findMany({
      where: { organizationId: first.organizationId, id: { in: s.g.map((o) => o.id) } },
      select: {
        status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true,
        materialUsages: { select: { quantity: true, totalCost: true, commission4: true, vatRate: true, rawMaterial: { select: { name: true } }, lot: true } },
      },
    });
    const live = full.filter((o) => o.status !== "CANCELLED");
    const used = live.length ? live : full;
    const units = used.reduce((a, o) => a + (Number(orderUnits(o)) || Number(o.plannedQuantity)), 0);
    const work = used.reduce((a, o) => a + (Number(orderUnits(o)) || Number(o.plannedQuantity)) * Number(o.clientWorkPricePerUnit ?? 0), 0);
    const itemsQty = items.reduce((a, row) => a + num(row[7]), 0);
    check(near(itemsQty, units, 0.0005), `${label}: изделий в Word ${itemsQty}, в данных ${units}`);
    check(near(num(itemsTotal[1]), units, 0.0005), `${label}: «Итого» количество ${itemsTotal[1]} ≠ ${units}`);
    if (p.kind === "WORK") {
      const wordWork = items.reduce((a, row) => a + num(row[7]) * num(row[8]), 0);
      check(near(wordWork, work), `${label}: работа в Word ${wordWork}, в данных ${work}`);
    } else check(near(items.reduce((a, row) => a + num(row[8]), 0), work), `${label}: работа (ремонт) в Word ≠ данных ${work}`);
    // сырьё: по каждому лоту количество равно списаниям
    const useByLot = new Map<string, number>();
    let usesIncl = new Decimal(0);
    for (const o of used) for (const u of o.materialUsages) {
      const k = `${u.rawMaterial.name}|${u.lot.id}`; useByLot.set(k, (useByLot.get(k) ?? 0) + Number(u.quantity));
      usesIncl = usesIncl.add(lineWith4(usageInput(u), "on").incl);
    }
    check(mats.length === useByLot.size, `${label}: строк сырья в Word ${mats.length}, лотов в данных ${useByLot.size}`);
    check(near(mats.reduce((a, row) => a + num(row[3]), 0), [...useByLot.values()].reduce((a, b) => a + b, 0), 0.0015), `${label}: расход сырья в Word ≠ списаниям`);
    check(near(mats.reduce((a, row) => a + num(row[6]), 0), Number(usesIncl.toFixed(2)), 0.011 * Math.max(mats.length, 1)), `${label}: стоимость сырья в Word ≠ списаниям (с 4%)`);
    // итог ТЗ = сырьё + работа
    const grand = num(itemsTotal[itemsTotal.length - 1]);
    check(near(grand, Number(usesIncl.toFixed(2)) + work, 0.011 * Math.max(items.length, 1)), `${label}: итого ${grand} ≠ сырьё ${usesIncl.toFixed(2)} + работа ${work}`);
    check(near(grand, items.reduce((a, row) => a + num(row[10]), 0), 0.011 * Math.max(items.length, 1)), `${label}: «Итого» ≠ сумма строк`);
    // 4) присланный оригинал: те же количество и работа, то же сырьё по лотам
    const orig = originals.get(p.number);
    if (orig) {
      checkedOrig++;
      const op = await payloadFromDocx(orig);
      const oq = op.items.reduce((a, i) => a + num(i.qty), 0);
      check(near(oq, itemsQty, 0.0005), `${label}: изделий в присланном Word ${oq}, в нашем ${itemsQty}`);
      const ow = op.kind === "WORK" ? op.items.reduce((a, i) => a + num(i.qty) * num(i.work), 0) : op.items.reduce((a, i) => a + num(i.work), 0);
      // работа: допуск — копейки округления цены за единицу в нашей базе
      check(near(ow, p.kind === "WORK" ? items.reduce((a, row) => a + num(row[7]) * num(row[8]), 0) : items.reduce((a, row) => a + num(row[8]), 0), 0.011 * Math.max(units, 1)), `${label}: работа в присланном Word ${ow} ≠ нашей`);
      // сырьё: номера лотов у нас и у Веллмеха записаны по-разному (FW26-20 / СП0526.20), поэтому сверяются количество и цена за единицу
      const sig = (qty: string, price: string) => `${num(qty)}×${num(price).toFixed(2)}`;
      const sO = op.materials.filter((m) => m.lot).map((m) => sig(m.qty, m.priceNet)).sort();
      const sN = mats.filter((row) => row[1].trim()).map((row) => sig(row[3], row[4])).sort();
      const sameMats = JSON.stringify(sO) === JSON.stringify(sN);
      if (!sameMats) console.log(`  · ${label}: сырьё отличается от присланного Word (данные базы иные): Word ${sO.join(", ")} / база ${sN.join(", ")}`);
      else matMatched++;
      const sameKind = op.kind === p.kind;
      check(sameKind, `${label}: вид ТЗ (ремонт/пошив) отличается от присланного`);
    }
    console.log(`${label}: ок · позиций ${r.positions}, строк изделий ${items.length}, строк сырья ${mats.length}${orig ? " · сверено с присланным Word" : ""}${r.missing.length ? ` · пусто: ${r.missing.slice(0, 3).join(", ")}` : ""}`);
  }
  // маршрут: порядок «сохранённый файл → Word из данных → печатная форма»
  {
    const { GET } = await import("../src/app/api/production/[id]/word/route");
    const call = async (id: string, orgId: string) => {
      const user = await prisma.user.findFirst({ where: { organizationId: orgId, role: "OWNER" } }) ?? (await prisma.user.findFirstOrThrow({ where: { organizationId: orgId } }));
      (globalThis as { __TEST_SESSION?: unknown }).__TEST_SESSION = { user: { id: user.id, role: user.role, organizationId: orgId, name: "Тест" } };
      return GET(new Request("http://localhost/api/production/x/word"), { params: Promise.resolve({ id }) } as never);
    };
    const saved = await prisma.driveDocument.findFirst({ where: { docType: "TZ_APPENDIX", storagePath: { not: null }, storedMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", productionOrderId: { not: null } }, select: { productionOrderId: true, organizationId: true, id: true } });
    if (saved) {
      const r = await call(saved.productionOrderId!, saved.organizationId);
      check(r.status === 307 && (r.headers.get("location") ?? "").includes(`/api/drive-docs/${saved.id}`), "маршрут: при сохранённом Word должен быть редирект на файл");
      console.log(`маршрут: ТЗ с сохранённым Word → редирект на файл (${r.status})`);
    }
    const savedIds = new Set((await prisma.driveDocument.findMany({ where: { docType: "TZ_APPENDIX", storagePath: { not: null }, productionOrderId: { not: null } }, select: { productionOrderId: true } })).map((d) => d.productionOrderId));
    const noFile = all.find((o) => !savedIds.has(o.id) && groups.get(o.workOrderNumber?.trim() || o.id)!.every((x) => !savedIds.has(x.id)) && o.workOrderNumber !== "75");
    if (noFile) {
      const r = await call(noFile.id, noFile.organizationId);
      check(r.status === 200 && (r.headers.get("content-type") ?? "").includes("wordprocessingml"), `маршрут: без сохранённого Word ожидался Word из данных (получили ${r.status})`);
      const z = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer())).catch(() => null);
      check(!!z?.file("word/document.xml"), "маршрут: ответ не docx");
      console.log(`маршрут: ТЗ ${noFile.workOrderNumber} без сохранённого Word → Word из данных (${r.status})`);
    }
    const partial = all.find((o) => o.workOrderNumber === "75");
    if (partial) {
      const r = await call(partial.id, partial.organizationId);
      check(r.status === 307 && (r.headers.get("location") ?? "").endsWith("/docx"), `маршрут: при неполных данных ожидалась печатная форма (получили ${r.status})`);
      console.log(`маршрут: ТЗ 75 (нет списаний сырья) → печатная форма (${r.status} → ${r.headers.get("location")})`);
    }
  }
  console.log(`сверено с присланными Word: ${checkedOrig}, из них сырьё (количество × цена) совпало полностью: ${matMatched}`);
  check(matMatched >= 5, `сырьё совпало с присланным Word только у ${matMatched} ТЗ`);
  check(checkedOrig >= 3, `с присланными Word сверено ${checkedOrig} ТЗ (ожидалось не меньше 3)`);
  console.log(bad ? `ПРОВАЛОВ: ${bad}` : "OK");
  await prisma.$disconnect();
  process.exit(bad ? 1 : 0);
}
main();
