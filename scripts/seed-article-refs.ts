/**
 * Справочник артикулов: код и название в системе продаж — из единого реестра (scripts/article_sales_data.json).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-article-refs.ts            # пробный прогон (ничего не пишет в базу)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-article-refs.ts --apply    # применить (после scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-article-refs.ts --rollback # откат по журналу
 *
 * Что делает: для каждого ProductModel, чей код однозначно совпал с артикулом из листов продаж реестра
 * («EB заказ», «Лист12», «olap заказ», «Лист14»), заполняет ПУСТЫЕ поля salesCode (код в продажах, без ткани/цвета),
 * salesName (розничное название из «Реестр (единый)», только если оно там есть) и добавляет в aliases написания:
 * полные артикулы продаж («M012/MINK BGL») и кириллические/искажённые написания из сводки «Лист18» («МОО1К»).
 * Заполненные вручную значения не трогает. Что не нашлось — остаётся пустым (список «ждёт ручного сопоставления»
 * на /settings/articles-ref). Журнал: docs-inventory/corrections-journal-article-refs.json
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { articleKey } from "../src/lib/article-key";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-article-refs.json");

type Data = {
  articles: Record<string, { salesCode: string | null; variants: string[]; sheets: string[]; salesName?: string }>;
  spellings: Array<[string, string]>;
};
type Change = { id: string; name: string; field: "salesCode" | "salesName" | "aliases"; old: string | string[] | null; new: string | string[] | null };

async function rollback() {
  const j = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  let done = 0;
  let skipped = 0;
  for (const c of [...j.changes].reverse()) {
    const cur = await prisma.productModel.findUnique({ where: { id: c.id } });
    if (!cur) { skipped++; continue; }
    const now = (cur as Record<string, unknown>)[c.field];
    if (JSON.stringify(now ?? null) !== JSON.stringify(c.new)) { skipped++; continue; } // изменено вручную после засева
    await prisma.productModel.update({ where: { id: c.id }, data: { [c.field]: c.old ?? (c.field === "aliases" ? [] : null) } });
    done++;
  }
  console.log(`Откат: ${done} полей, пропущено ${skipped} (изменены после засева)`);
  writeJson(JOURNAL, { script: "seed-article-refs.ts", rolledBackAt: new Date().toISOString(), changes: [] });
}

async function main() {
  if (ROLLBACK) return rollback();
  const data = readJson<Data>(join(__dirname, "article_sales_data.json"), { articles: {}, spellings: [] });
  const byKey = new Map<string, Data["articles"][string] & { code: string }>();
  for (const [code, a] of Object.entries(data.articles)) byKey.set(articleKey(code), { ...a, code });
  // написания из сводки: [вариант, канон] или [канон, вариант] — берём те, где ключ не совпадает с ключом канона
  const spellByKey = new Map<string, Set<string>>();
  for (const [a, b] of data.spellings) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const kx = articleKey(x);
      if (byKey.has(kx) && articleKey(y) !== kx && /[A-Za-zА-Яа-я]\d|\d[A-Za-zА-Яа-я]/.test(y)) {
        // y — другое написание артикула x; пропускаем, если оно само — код другого артикула реестра
        if (byKey.has(articleKey(y))) continue;
        (spellByKey.get(kx) ?? spellByKey.set(kx, new Set()).get(kx)!).add(y);
      }
    }
  }
  const orgs = await prisma.organization.findMany();
  const changes: Change[] = [];
  const unmatchedReg: string[] = [];
  const matchedKeys = new Set<string>();
  let models = 0;
  let withCode = 0;
  const noCode: string[] = [];
  for (const org of orgs) {
    const list = await prisma.productModel.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } });
    models += list.length;
    for (const m of list) {
      const k = articleKey(m.name);
      const a = byKey.get(k);
      if (!a) { if (!m.salesCode) noCode.push(m.name); continue; }
      matchedKeys.add(k);
      const upd: { salesCode?: string; salesName?: string; aliases?: string[] } = {};
      if (!m.salesCode && a.salesCode) { upd.salesCode = a.salesCode; changes.push({ id: m.id, name: m.name, field: "salesCode", old: m.salesCode, new: a.salesCode }); }
      if (!m.salesName && a.salesName) { upd.salesName = a.salesName; changes.push({ id: m.id, name: m.name, field: "salesName", old: m.salesName, new: a.salesName }); }
      const want = [...a.variants, ...Array.from(spellByKey.get(k) ?? [])];
      const al = [...m.aliases];
      for (const w of want) if (articleKey(w) !== articleKey(m.name) && !al.some((x) => articleKey(x) === articleKey(w))) al.push(w);
      if (al.length !== m.aliases.length) { upd.aliases = al; changes.push({ id: m.id, name: m.name, field: "aliases", old: m.aliases, new: al }); }
      if ((m.salesCode || upd.salesCode)) withCode++;
      else noCode.push(m.name);
      if (APPLY && Object.keys(upd).length) await prisma.productModel.update({ where: { id: m.id }, data: upd });
    }
    for (const k of byKey.keys()) if (!matchedKeys.has(k)) unmatchedReg.push(byKey.get(k)!.code);
    const after = list.filter((m) => m.salesCode || changes.some((c) => c.id === m.id && c.field === "salesCode")).length;
    console.log(`Организация ${org.name}: артикулов ${list.length}, с кодом продаж после засева: ${after}`);
  }
  console.log(`Артикулов всего: ${models}; полей к изменению: ${changes.length}`);
  console.log(`Артикулы реестра без пары в справочнике: ${unmatchedReg.join(", ") || "—"}`);
  console.log(`Без кода продаж (ждут ручного сопоставления): ${noCode.length}: ${noCode.join(", ")}`);
  if (APPLY) {
    const prev = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
    writeJson(JOURNAL, { script: "seed-article-refs.ts", appliedAt: new Date().toISOString(), changes: [...prev.changes, ...changes] });
    console.log(`Применено. Журнал: ${JOURNAL}`);
  } else console.log("Пробный прогон: в базу ничего не записано. Для записи добавьте --apply (после scripts/backup.sh).");
}

main().finally(() => prisma.$disconnect());
