/**
 * РОЗНИЧНЫЕ ЦЕНЫ МОДЕЛЕЙ (ProductModel.sellingPrice) — только там, где цена точно известна по последнему файлу; у остальных моделей пусто.
 *
 * Решение владельца (09.10.2026): «последний файл» — письмо Гордеевой А. А. от 30.06.2026 (№86, новые розничные цены с 01.07.2026).
 * К нему добавлены цены, подтверждённые согласованием в письмах позже этого файла или персональным заказом (M029, M001E, M044, M057).
 * Не попавшие в файл модели (в т. ч. цены из реестра FW 25/26 и каталога FW 26/27) остаются без цены.
 * MSC-01: в письме две цены (норка 245 000 / соболь 1 485 000) — для модели цена не однозначна, поле пустое.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-model-prices-last-file.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-model-prices-last-file.ts --apply    # после scripts/backup.sh
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-model-prices-last-file.ts --rollback --apply
 * Журнал: docs-inventory/corrections-journal-model-prices-last-file.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-model-prices-last-file.json");

const norm = (s: string) =>
  s.toUpperCase().replace(/[\s-]/g, "").replace(/[МКЕАНОСТРВХ]/g, (c) => ({ М: "M", К: "K", Е: "E", А: "A", Н: "H", О: "O", С: "C", Т: "T", Р: "P", В: "B", Х: "X" } as Record<string, string>)[c]);

const LETTER = "письмо Гордеевой А. А. 30.06.2026, №86 (цены с 01.07.2026)";
const KEEP: Record<string, { price: number; source: string }> = {
  M002: { price: 16390000, source: LETTER }, M002A: { price: 22250000, source: LETTER }, M003: { price: 8490000, source: LETTER },
  M004: { price: 4380000, source: LETTER }, M009: { price: 1850000, source: LETTER }, M010: { price: 1980000, source: LETTER },
  M011: { price: 2495000, source: LETTER }, M011A: { price: 2495000, source: LETTER }, M012: { price: 890000, source: LETTER },
  M018: { price: 1530000, source: LETTER }, M019: { price: 850000, source: LETTER }, M020: { price: 1595000, source: LETTER },
  M021: { price: 2690000, source: LETTER },
  "MH-02": { price: 119000, source: LETTER }, "MH-05": { price: 82500, source: LETTER }, "MH-06": { price: 74900, source: LETTER }, "MH-07": { price: 149000, source: LETTER },
  M029: { price: 980000, source: "письмо «дозаказ шуб…» 12–16.09.2026, согласовано" },
  M001E: { price: 1570000, source: "письмо «дозаказ шуб…» 12–16.09.2026, согласовано" },
  M044: { price: 2085000, source: "письмо «согласование дозакупки норки» 07–17.07.2026, согласовано 17.07" },
  M057: { price: 13875000, source: "письмо «оплата производства инд. заказа на кейп из соболя» 25–26.05.2026, согласовано 26.05" },
};
// Цены, введённые вручную после выгрузки файла (владельцем на странице «Изделия»): скрипт их не трогает.
const PROTECT = new Set(["M025"].map(norm));
const keep = new Map(Object.entries(KEEP).map(([k, v]) => [norm(k), v]));

type J = { time: string; changes: Array<{ id: string; name: string; old: string | null; new: number | null; source: string }>; rolledBack?: string };

(async () => {
  try {
    if (ROLLBACK) {
      if (!existsSync(JOURNAL)) return console.log("Нет журнала");
      const j: J = JSON.parse(readFileSync(JOURNAL, "utf-8"));
      if (j.rolledBack) return console.log("Уже откачено");
      if (!APPLY) return console.log(`Будет откачено цен: ${j.changes.length} (добавьте --apply)`);
      for (const c of j.changes) await prisma.productModel.update({ where: { id: c.id }, data: { sellingPrice: c.old } });
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      return console.log("Откачено");
    }
    if (existsSync(JOURNAL) && !JSON.parse(readFileSync(JOURNAL, "utf-8")).rolledBack) return console.log("Уже применено (журнал есть)");
    const models = await prisma.productModel.findMany({ orderBy: { name: "asc" } });
    const changes: J["changes"] = [];
    const found = new Set<string>();
    for (const m of models) {
      if (PROTECT.has(norm(m.name))) continue;
      const k = keep.get(norm(m.name));
      const old = m.sellingPrice == null ? null : m.sellingPrice.toString();
      if (k) {
        found.add(norm(m.name));
        if (old == null || Number(old) !== k.price) changes.push({ id: m.id, name: m.name, old, new: k.price, source: k.source });
      } else if (old != null) {
        changes.push({ id: m.id, name: m.name, old, new: null, source: "нет в последнем файле — цена снята" });
      }
    }
    console.log(`\nРозничные цены по последнему файлу (${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН"}):`);
    for (const c of changes) console.log(`  ${c.name.padEnd(8)} ${String(c.old ?? "—").padStart(12)} → ${String(c.new ?? "пусто").padStart(12)}  ${c.new == null ? "" : c.source.slice(0, 50)}`);
    const missing = Array.from(keep.keys()).filter((k) => !found.has(k));
    if (missing.length) console.log(`  Модели из файла, которых нет в базе: ${missing.join(", ")}`);
    console.log(`Итого: ${models.filter((m) => keep.has(norm(m.name))).length} моделей с ценой, снято цен ${changes.filter((c) => c.new == null).length}, поставлено/изменено ${changes.filter((c) => c.new != null).length}`);
    if (!APPLY) return console.log("Пробный прогон: ничего не записано.");
    for (const c of changes) await prisma.productModel.update({ where: { id: c.id }, data: { sellingPrice: c.new } });
    writeFileSync(JOURNAL, JSON.stringify({ time: new Date().toISOString(), changes } satisfies J, null, 1));
    console.log("Готово. Журнал записан.");
  } finally {
    await prisma.$disconnect();
  }
})();
