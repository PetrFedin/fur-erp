/**
 * Розничные цены моделей (ProductModel.sellingPrice) по единому реестру, письмам и каталогам Drive «мех».
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-model-prices-from-registry.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-model-prices-from-registry.ts --apply    # после scripts/backup.sh
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-model-prices-from-registry.ts --rollback
 *
 * Правила (решение владельца: сезон для партий пропишет позже):
 *  - sellingPrice = цена сезона FW 25/26 (реестр «EB заказ» от 19.02.2025, колонка П.Р.Ц. / «Реестр (единый)» ПРЦ) там, где она есть;
 *    у цветозависимых моделей (M003/M009/M010/M011/M012) остаётся базовая (первая в заказе) — как уже в базе;
 *    цены по остальным цветам и сезону FW 26/27 дописываются строкой «[цены:реестр-2026-10]» в описание модели.
 *  - Новые цены ставятся только там, где источник один и однозначный: письма согласования (июль–сентябрь 2026) и каталог закупки
 *    FW 26/27 от 06.02.2026 (Drive). Цветозависимое без базовой цены (MSC-01, MH06, M041) — в очередь «ждёт цены».
 *  - M006: 2 345 000 → 1 985 000 (см. SET ниже).
 * Журнал: docs-inventory/corrections-journal-model-prices.json (старая цена и описание для --rollback). verifiedAt не трогается.
 */
import { join } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-model-prices.json");
const MARK = "[цены:реестр-2026-10]";

const norm = (s: string) =>
  s.toUpperCase().replace(/[\s-]/g, "").replace(/[МКЕАНОСТРВХ]/g, (c) => ({ М: "M", К: "K", Е: "E", А: "A", Н: "H", О: "O", С: "C", Т: "T", Р: "P", В: "B", Х: "X" } as Record<string, string>)[c]);

type Set = { model: string; price: number; source: string };
const SET: Set[] = [
  { model: "M006", price: 1985000, source: "реестр: лист «EB заказ» (заказ 19.02.2025, FW 25/26) П.Р.Ц. 1 985 000 и «Реестр (единый)» ТЗ №53 (analog M006/SABLE FARM NO SILVER). Прежние 2 345 000 — цена M013 (в реестре ТЗ №45 ошибочно помечено М006 при analog M013/MINK PERFORATED)" },
  { model: "M029", price: 980000, source: "письмо «дозаказ шуб 10 красных лис 6 арктических лис» 12–16.09.2026: розница 980 000, MU 3,3 (согласовано Решетняк, Киржнер)" },
  { model: "M001E", price: 1570000, source: "письмо «дозаказ шуб…» 12–16.09.2026: розница 1 570 000, MU 4 (согласовано)" },
  { model: "M044", price: 2085000, source: "письмо «согласование дозакупки норки — 225 штук» 07–17.07.2026: «Розничная цена: 2 085 000 руб, MU 3.6» (согласовано 17.07)" },
  { model: "M057", price: 13875000, source: "письмо «оплата производства инд. заказа на кейп из соболя» 25–26.05.2026: розница 13 875 000 (индивидуальный заказ клиентки ЦУМ, согласовано 26.05)" },
  { model: "M031", price: 3460000, source: "каталог закупки MVST FW 26/27 от 06.02.2026 (Drive): M031/SWAKARA FONDU, Розн.цена 3 460 000 (единственная цена модели)" },
  { model: "MH08", price: 643000, source: "каталог закупки MVST FW 26/27 от 06.02.2026 (Drive): MH-08 шапка-кубанка, Розн.цена 643 000 (единственная цена модели)" },
];

// строка цен в описании: цветозависимые FW 25/26 (реестр) и FW 26/27 (каталог 06.02.2026)
const NOTE: Record<string, string> = {
  M003: "FW25/26 (EB заказ 19.02.2025): SILVER 2 NATURAL 5 350 000; SILVER 4-5 TORTORA 6 850 000 (в реестре ТЗ №52 стоит 5 855 000 — вероятная опечатка). FW26/27 (каталог 06.02.2026): SILVER 2 NATURAL 6 805 000",
  M009: "FW25/26: BLACK GLAMA 1 525 000; LAVENDER 1 780 000. FW26/27: BLACK GLAMA 1 855 000; WHITE 1 855 000",
  M010: "FW25/26: BROWN 1 435 000; PASTEL 1 850 000. FW26/27: BROWN 1 885 000; PASTEL 2 235 000",
  M011: "FW25/26: BLACK GLAMA 2 175 000; PEARL 2 290 000",
  M012: "FW25/26: BLACK GLAMA и IRIS 649 000; LAVANDER 780 000. FW26/27: BLACK GLAMA и BROWN 841 500; IRIS 649 000",
  M001A: "FW26/27 (каталог 06.02.2026): TORTORA 13 350 000",
  M002: "FW26/27: TORTORA 17 500 000",
  M002A: "FW26/27: NATURAL 36 550 000",
  M011A: "FW26/27: BROWN 2 880 000",
  M018: "FW26/27: NOUGAT 2 230 000",
  "MSC-01": "FW26/27: SABLE FARM NATURAL 995 000 (цены по цветам норки в каталоге нет)",
  "MSC-02": "FW26/27: TORTOR SILVER 4 — 3 995 000 (в базе цена FW25/26 для SIL 5 — 1 935 000)",
  MH06: "FW26/27: IRIS 49 900; LAVANDER 63 100 (базовой цены нет)",
  M041: "FW26/27: MINK PST 2 555 000 (BLACK SHAVED без цены; в базе модель «стриженая норка»)",
};
const LINE = (k: string) => `${MARK} ${NOTE[k]}`;

type J = { prices: Array<{ id: string; name: string; oldPrice: string | null; newPrice: string; source: string }>; descs: Array<{ id: string; name: string; old: string | null }> };

async function rollback() {
  const j = readJson<J>(JOURNAL, { prices: [], descs: [] });
  await prisma.$transaction(async (tx) => {
    for (const p of j.prices) await tx.productModel.update({ where: { id: p.id }, data: { sellingPrice: p.oldPrice } });
    for (const d of j.descs) await tx.productModel.update({ where: { id: d.id }, data: { description: d.old } });
  });
  console.log(`Откат: цен ${j.prices.length}, описаний ${j.descs.length}`);
  writeJson(JOURNAL, { script: "apply-model-prices-from-registry.ts", rolledBackAt: new Date().toISOString(), prices: [], descs: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==");
  const models = await prisma.productModel.findMany({ orderBy: { name: "asc" } });
  const by = new Map(models.map((m) => [norm(m.name), m]));
  const prev = readJson<J>(JOURNAL, { prices: [], descs: [] });
  const journal: J = { prices: [...prev.prices], descs: [...prev.descs] };
  const saved = () => writeJson(JOURNAL, { script: "apply-model-prices-from-registry.ts", appliedAt: new Date().toISOString(), ...journal });

  for (const s of SET) {
    const m = by.get(norm(s.model));
    if (!m) { console.log(`! нет модели ${s.model}`); continue; }
    if (m.sellingPrice && Number(m.sellingPrice) === s.price) { console.log(`= ${m.name}: уже ${s.price}`); continue; }
    console.log(`${m.sellingPrice ? "исправить" : "проставить"} ${m.name}: ${m.sellingPrice ?? "—"} -> ${s.price}  [${s.source.slice(0, 80)}…]`);
    if (APPLY) {
      await prisma.productModel.update({ where: { id: m.id }, data: { sellingPrice: new Prisma.Decimal(s.price) } });
      if (!journal.prices.some((p) => p.id === m.id)) journal.prices.push({ id: m.id, name: m.name, oldPrice: m.sellingPrice ? String(m.sellingPrice) : null, newPrice: String(s.price), source: s.source });
      saved();
    }
  }
  for (const [k] of Object.entries(NOTE)) {
    const m = by.get(norm(k));
    if (!m) { console.log(`! нет модели ${k} (описание)`); continue; }
    const lines = (m.description ?? "").split("\n");
    const i = lines.findIndex((l) => l.startsWith(MARK));
    if (i >= 0 && lines[i] === LINE(k)) continue;
    if (i >= 0) lines[i] = LINE(k); else lines.push(LINE(k));
    const next = lines.join("\n").replace(/^\n/, "");
    console.log(`описание ${m.name}: + ${LINE(k).slice(0, 90)}…`);
    if (APPLY) {
      await prisma.productModel.update({ where: { id: m.id }, data: { description: next } });
      if (!journal.descs.some((d) => d.id === m.id)) journal.descs.push({ id: m.id, name: m.name, old: m.description });
      saved();
    }
  }
  const after = await prisma.productModel.findMany({ orderBy: { name: "asc" }, select: { name: true, sellingPrice: true } });
  const waiting = after.filter((m) => !m.sellingPrice).map((m) => m.name);
  console.log(`\nс ценой: ${after.length - waiting.length} из ${after.length}; ждут цены (${waiting.length}; в dry-run без учёта пробных правок): ${waiting.join(", ")}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
