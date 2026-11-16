/**
 * Excel «Сопоставление цветов»: оригинал из источника (отчёт, зачёты отгрузки) остаётся как есть,
 * рядом столбец «Сопоставление» (цвет справочника, близкий по смыслу) и «Дополнительное название».
 * Строки без пары и мои предложения подсвечены; список цветов справочника — на третьем листе (выпадающий список).
 *   node --env-file=.env node_modules/.bin/tsx scripts/gen-color-mapping-xlsx.ts <файл.xlsx>
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const db = new PrismaClient();
const ck = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/Ё/g, "Е").replace(/\s+/g, " ").trim();
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const NAVY = "FF2B2A5A", YEL = "FFFFF2CC", PINK = "FFFCE4D6", GREEN = "FFE2EFDA", BR = "FFBFBFBF";
const CYR: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", Ё: "E" };
const norm = (s: string) => s.toUpperCase().replace(/[А-ЯЁ]/g, (c) => CYR[c] ?? c).replace(/[\s\-_]+/g, "");

type Row = Record<string, unknown>;

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("укажите путь файла");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const refs = await db.colorRef.findMany({ where: { organizationId: org }, select: { name: true, aliases: true }, orderBy: { name: "asc" } });
  const nameByCanon = new Map(refs.map((r) => [ck(r.name), r.name]));
  const q = async (s: string) => (await db.$queryRawUnsafe(s)) as Row[];

  // 1. Отчёт: оригинал цвета → цвет справочника
  const rep = await q(`SELECT k.color, k."colorCanon" AS canon, (k."colorRefId" IS NULL) AS noref, string_agg(DISTINCT k."modelCode", ', ') AS models, sum(t.deliv)::int AS deliv, sum(greatest(t.stock,0))::int AS stock FROM "DmSku" k JOIN "DmStock" t ON t."skuId"=k.id GROUP BY 1,2,3 ORDER BY noref DESC, 1`);
  const SUGGEST: Record<string, { map: string; extra: string; note: string }> = {
    MAHOGANY: { map: "", extra: "Красное дерево (Mahogany)", note: "Нет в справочнике: предлагаю завести «Красное дерево» (подтвердите или выберите близкий цвет)" },
    SILVER: { map: "", extra: "Серебристый (Silver)", note: "Нет в справочнике: предлагаю завести «Серебристый» (подтвердите или выберите близкий цвет)" },
  };

  // 2. Зачёты отгрузки: модель × цвет (как записан в файле) → цвет отчёта той же модели
  const zi = await db.systemState.findMany({ where: { organizationId: org, key: { startsWith: "shipment-zi:" } }, select: { value: true } });
  type L = { article?: string; colorRu?: string; sum?: number };
  const lines: L[] = zi.flatMap((z) => ((z.value as { lines?: L[] }).lines ?? []));
  const skuColors = await q(`SELECT DISTINCT "modelCode" AS m, "colorCanon" AS c FROM "DmSku"`);
  const colorsOfModel = new Map<string, string[]>();
  for (const r of skuColors) {
    const m = String(r.m);
    if (!colorsOfModel.has(m)) colorsOfModel.set(m, []);
    colorsOfModel.get(m)!.push(String(r.c));
  }
  const grp = new Map<string, { model: string; color: string; n: number; sum: number }>();
  for (const l of lines) {
    if (!l.article) continue;
    const model = norm(l.article.split(/[\s/]/)[0] ?? l.article);
    const color = (l.colorRu ?? "").trim();
    const k = `${model}|${color}`;
    const g = grp.get(k) ?? { model, color, n: 0, sum: 0 };
    g.n++; g.sum += l.sum ?? 0; grp.set(k, g);
  }
  const ZS: Record<string, { map: string; note: string }> = {
    "MH06|СЕРЫЙ": { map: "Ирис", note: "В справочнике у «Ирис» есть синоним «Серый (ирис)»" },
    "MH06|КРЕМОВЫЙ": { map: "", note: "НЕТ ОЧЕВИДНОЙ ПАРЫ: у MH06 в отчёте Ирис, Лаванда, Чёрный. Выберите цвет или оставьте пустым" },
    "MH07|КОРИЧНЕВЫЙ": { map: "Натуральный", note: "Соболь: в отчёте цвет «Натуральный»" },
    "MCF01|КОРИЧНЕВЫЙ": { map: "Натуральный", note: "Соболь: в отчёте цвет «Натуральный»" },
    "MMF01|КОРИЧНЕВЫЙ": { map: "Натуральный", note: "Соболь: в отчёте цвет «Натуральный»" },
    "M028|КОРИЧНЕВЫЙ": { map: "Натуральный", note: "Соболь: в отчёте цвет «Натуральный»" },
    "M038|ЧЕРНЫЙ, КОРИЧНЕВЫЙ": { map: "Натуральный", note: "Два цвета в одной строке; в отчёте у M038 «Натуральный»" },
    "M055|КОРИЧНЕВЫЙ": { map: "", note: "В отчёте у M055 цвет MAHOGANY (нет в справочнике): сопоставить с новым «Красное дерево»" },
    "M002|БЕЖЕВЫЙ": { map: "Тортора", note: "В отчёте у M002 цвет «Тортора»" },
    "M023|БЕЖЕВЫЙ": { map: "Тортора", note: "В отчёте у M023 цвет «Тортора»" },
  };

  const wb = new ExcelJS.Workbook();
  const head = (ws: ExcelJS.Worksheet, row: number, cols: string[]) => cols.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = fill(NAVY);
    c.alignment = { wrapText: true, vertical: "middle" }; c.border = { bottom: { style: "thin", color: { argb: BR } } };
  });
  const listRange = `'Справочник цветов'!$A$2:$A$${refs.length + 1}`;
  const addValidation = (ws: ExcelJS.Worksheet, col: string, from: number, to: number) => {
    for (let r = from; r <= to; r++) ws.getCell(`${col}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [listRange], showErrorMessage: false };
  };

  const w1 = wb.addWorksheet("Отчёт - цвета", { views: [{ state: "frozen", ySplit: 3 }] });
  w1.getCell(1, 1).value = "Цвета из отчёта «заказ и продажи»: оригинал остаётся, столбец «Сопоставление» — цвет справочника";
  w1.getCell(1, 1).font = { bold: true, size: 12 };
  w1.getCell(2, 1).value = "Жёлтым — нужно ваше решение; зелёным — совпало со справочником автоматически. В «Сопоставлении» можно выбрать из списка или вписать своё; в «Дополнительное название» — доп. название цвета.";
  head(w1, 3, ["Оригинал (как в отчёте)", "Сопоставление (цвет справочника)", "Дополнительное название", "Модели", "Получено, шт.", "Остаток, шт.", "Комментарий"]);
  rep.forEach((r, i) => {
    const row = w1.getRow(4 + i);
    const s = SUGGEST[ck(String(r.color))];
    const noref = Boolean(r.noref);
    const mapped = noref ? (s?.map ?? "") : (nameByCanon.get(String(r.canon)) ?? String(r.canon));
    const vals: ExcelJS.CellValue[] = [String(r.color), mapped, noref ? (s?.extra ?? "") : "", String(r.models), Number(r.deliv), Number(r.stock), noref ? (s?.note ?? "Нет в справочнике цветов: нужно сопоставить") : "Совпало со справочником"];
    vals.forEach((v, c) => { row.getCell(c + 1).value = v; });
    for (let c = 1; c <= 7; c++) row.getCell(c).fill = fill(noref ? YEL : GREEN);
  });
  [26, 32, 30, 28, 14, 14, 70].forEach((w, i) => { w1.getColumn(i + 1).width = w; });
  addValidation(w1, "B", 4, 3 + rep.length);

  const w2 = wb.addWorksheet("Зачёты отгрузки - цвета", { views: [{ state: "frozen", ySplit: 3 }] });
  w2.getCell(1, 1).value = "Цвета из зачётов отгрузки (ИТ/ЗИ): оригинал остаётся, рядом — подобранный близкий цвет";
  w2.getCell(1, 1).font = { bold: true, size: 12 };
  w2.getCell(2, 1).value = "Жёлтым — предложение (нужно подтвердить); розовым — пары нет, нужен ваш выбор; зелёным — цвет уже совпадает с отчётом. Цвета этой модели в отчёте указаны в столбце «Цвета модели в отчёте».";
  head(w2, 3, ["Модель", "Оригинал (как в зачёте)", "Сопоставление (цвет справочника)", "Дополнительное название", "Цвета модели в отчёте", "Строк", "Сумма, ₽", "Комментарий"]);
  const zrows = [...grp.values()].sort((a, b) => b.n - a.n);
  zrows.forEach((g, i) => {
    const row = w2.getRow(4 + i);
    const key = `${g.model}|${ck(g.color)}`;
    const sug = ZS[key];
    const have = colorsOfModel.get(g.model) ?? [];
    const inRep = have.includes(ck(g.color));
    const mapped = inRep ? (nameByCanon.get(ck(g.color)) ?? g.color) : (sug?.map ?? "");
    const vals: ExcelJS.CellValue[] = [g.model, g.color, mapped, "", have.map((c) => nameByCanon.get(c) ?? c).join(", "), g.n, Math.round(g.sum), inRep ? "Совпадает с цветом модели в отчёте" : (sug?.note ?? "Нет пары в отчёте: нужно сопоставить")];
    vals.forEach((v, c) => { row.getCell(c + 1).value = v; });
    const color = inRep ? GREEN : sug?.map ? YEL : PINK;
    for (let c = 1; c <= 8; c++) row.getCell(c).fill = fill(color);
  });
  [10, 24, 32, 30, 36, 8, 14, 70].forEach((w, i) => { w2.getColumn(i + 1).width = w; });
  addValidation(w2, "C", 4, 3 + zrows.length);

  const w3 = wb.addWorksheet("Справочник цветов");
  head(w3, 1, ["Цвет справочника", "Синонимы"]);
  refs.forEach((r, i) => { w3.getCell(i + 2, 1).value = r.name; w3.getCell(i + 2, 2).value = r.aliases.join(", "); });
  w3.getColumn(1).width = 28; w3.getColumn(2).width = 80;

  await wb.xlsx.writeFile(out);
  console.log(`готово: ${out}; цветов в отчёте ${rep.length} (без пары ${rep.filter((r) => r.noref).length}), пар в зачётах ${zrows.length}`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
