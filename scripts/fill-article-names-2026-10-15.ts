/**
 * Названия изделий (ProductModel.salesName) там, где пусто, — по документам: «Наименование Продукции» в Word-ТЗ (приложения к договору подряда),
 * расчётным таблицам «Расчёт стоимости пошива ММ» / «расчёты LYNX», каталогу закупки MVST FW 26/27 и письму Меркури Мода от 27.05.2026.
 * Ставит ТОЛЬКО в пустое salesName и только где документ однозначен. Спорные и без документов — в SKIP (с вариантами), не трогает.
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал); --rollback [--apply] возвращает пустые названия.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fill-article-names-2026-10-15.ts [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeModelCode } from "../src/lib/model-code";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-article-names-2026-10-15.json");

const T = "ТЗ (приложение к договору подряда №1605)";
// код -> [название, источник, категория-если-пуста]
const NAMES: Record<string, [string, string, string?]> = {
  M004: ["Жакет женский вязаный из соболя", `${T}: прил. 37, 60`],
  M006: ["Жилет женский вязаный из соболя", `${T}: прил. 45, 53`],
  M011A: ["Пальто женское из норки", `${T}: прил. 22, 47`],
  M013: ["Пальто женское из норки", `${T}: прил. 28, 44`],
  M016: ["Жилет женский из норки", `${T}: прил. 33, 41, 80`],
  M017: ["Жакет женский из норки", `${T}: прил. 27 (Drive)`],
  M022: ["Куртка женская из каракульчи", `${T}: прил. 48, 78, 86`],
  M023: ["Полупальто из дикого соболя", `${T}: прил. 171`],
  M044: ["Жилет меховой", `${T}: прил. 177`],
  M055: ["Куртка женская из норки", `${T}: прил. 181`],
  MCF01: ["Манжеты меховые", `${T}: прил. 179`],
  MMF01: ["Муфта меховая", `${T}: прил. 178`],
  MGL01: ["Варежки", `${T}: прил. 105`],
  MGL02: ["Варежки", `${T}: прил. 88`],
  MGL03: ["Варежки", `${T}: прил. 88`],
  MH01: ["Головной убор", `${T}: прил. 76`],
  MH03: ["Головной убор (ушанка)", `${T}: прил. 160 («Головной убор (ушанка)»; в остальных «Головной убор»)`],
  // Не из списка владельца из 36: у этих описание — только цены реестра, названия в ТЗ однозначны.
  MH06: ["Головной убор (повязка меховая)", `${T}: прил. 96 (14 ТЗ), 182 («Головной убор (Повязка)»)`],
  "MSC-01": ["Шарф меховой", `${T}: 24 ТЗ (прил. 106-109 и др.)`],
  "MSC-02": ["Шарф меховой", `${T}: 6 ТЗ (в т.ч. прил. 156)`],
  M041: ["Куртка из стриженой норки", `${T}: прил. 123 (4 ТЗ)`],
  M008: ["Шуба удлиненная из рыси", "расчёты LYNX MVST FW26 («Шуба удлиненная», рысь) + каталог закупки FW26/27 («Шуба удлиненная… из рыси»)", "Шуба / полушубок"],
  M047: ["Шуба укороченная из рыси", "расчёты LYNX MVST FW26 («Шуба укороченная», рысь канадская)"],
  M039: ["Пальто из стриженой норки с отделкой из соболя", "Расчёт стоимости пошива ММ FW26 («пальто», норка стрижка + соболь) + каталог закупки FW26/27"],
  M040: ["Пальто из соболя", "Расчёт стоимости пошива ММ FW26 («пальто», соболь) + письмо Меркури Мода 27.05.2026 («пальто из соболя в роспуск»)"],
  M054: ["Пальто из соболя", "Расчёт стоимости пошива ММ FW26 («пальто», соболь темный)"],
  M034: ["Жакет из брутейла с вышивкой стеклярусом", "каталог закупки MVST FW26/27"],
  M035: ["Пальто однобортное из брутейла с вышивкой", "каталог закупки MVST FW26/27"],
  "MBG-01": ["Сумка из норки", "каталог закупки MVST FW26/27 («Сумка», MINK BROWN)"],
  "MGL-04": ["Перчатки с мехом соболя (из голов)", "каталог закупки MVST FW26/27 (кожаные и замшевые варианты)"],
  "MGL-05": ["Перчатки-митенки из соболя", "каталог закупки MVST FW26/27 («митенки без пальцев»)"],
  "MH-18": ["Шапка меховая из рыси", "каталог закупки MVST FW26/27 («Шапка меховая», LYNX)"],
};
const SKIP: Record<string, string> = {
  M002A: "в ТЗ разные: «Пальто женское из соболя» (прил. 21, 29, 140, 152) и «Полупальто из стриженой норки с воротником из дикого соболя» (прил. 142, 148); в каталоге «Шуба удлиненная» (соболь, 6 рядов)",
  M007: "расчёт LYNX: «Шуба средней длины»; каталог: «Полупальто меховое — фрачный жакет из рыси»",
  M026: "ТЗ прил. 150/174: «Пальто женское из норки с шарфом»; письмо Меркури Мода 27.05.2026: шарф — отдельный артикул MSC01, М026 только пальто",
  M030: "расчёт ММ: «п/пальто», соболь; каталог: «Шуба… с капюшоном»; в письме от 27.05.2026: «модель не согласована»",
  M036: "только каталог: «Шуба» (норка американская black с вышивкой) — вид изделия не уточнён",
  M037: "каталог: два варианта — «жакет из брутейла» и «норка», оба с воротником-гуру и вышивкой",
  M058: "документов нет (только в отчёте по меху)",
  "MCF-02": "документов нет (в каталоге только MCF-01 «Манжеты»)",
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:fill-article-names");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string; name: string; oldCategory: string | null; oldCategoryRefId: string | null; setCategory: boolean }[];
    console.log(`откат: ${j.length} артикулов`);
    if (!APPLY) return console.log("пробный откат (добавьте --apply)");
    for (const r of j) {
      const cur = await prisma.productModel.findUnique({ where: { id: r.id }, select: { salesName: true } });
      if (cur?.salesName === NAMES[r.name]?.[0] || cur?.salesName) await prisma.productModel.update({ where: { id: r.id }, data: { salesName: null, ...(r.setCategory ? { category: r.oldCategory, categoryRefId: r.oldCategoryRefId } : {}) } });
    }
    return console.log("откат выполнен");
  }
  const models = await prisma.productModel.findMany({ select: { id: true, name: true, salesName: true, category: true, categoryRefId: true } });
  const byCode = new Map(models.map((m) => [normalizeModelCode(m.name).toUpperCase(), m]));
  const todo: { m: (typeof models)[number]; code: string; name: string; src: string; cat?: string }[] = [];
  console.log("артикул | название | источник");
  for (const [code, [name, src, cat]] of Object.entries(NAMES)) {
    const m = byCode.get(normalizeModelCode(code).toUpperCase());
    if (!m) { console.log(`${code}: артикула нет в базе`); continue; }
    if (m.salesName?.trim()) { console.log(`${m.name}: название уже есть («${m.salesName}») — не трогаю`); continue; }
    todo.push({ m, code, name, src, cat });
    console.log(`${m.name} | ${name}${cat && !m.category ? ` | категория → ${cat}` : ""} | ${src}`);
  }
  console.log("\nСПОРНЫЕ / БЕЗ ДОКУМЕНТОВ (не ставлю):");
  for (const [c, why] of Object.entries(SKIP)) console.log(`${c}: ${why}`);
  console.log(`\nбудет заполнено: ${todo.length}`);
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const journal: unknown[] = [];
  for (const t of todo) {
    const setCat = !!t.cat && !t.m.category;
    let refId: string | null = null;
    if (setCat) refId = (await prisma.categoryRef.findFirst({ where: { name: t.cat } }))?.id ?? null;
    journal.push({ id: t.m.id, name: t.m.name, oldCategory: t.m.category, oldCategoryRefId: t.m.categoryRefId, setCategory: setCat, newName: t.name, source: t.src });
    await prisma.productModel.update({ where: { id: t.m.id }, data: { salesName: t.name, ...(setCat ? { category: t.cat, categoryRefId: refId } : {}) } });
  }
  let old: unknown[] = [];
  try { old = JSON.parse(readFileSync(JOURNAL, "utf8")); } catch { /* первого журнала нет */ }
  writeFileSync(JOURNAL, JSON.stringify([...old, ...journal], null, 2));
  console.log("применено, журнал:", JOURNAL);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
