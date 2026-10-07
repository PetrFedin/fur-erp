/**
 * Посев справочника категорий изделий (CategoryRef) и привязка моделей.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-category-refs.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-category-refs.ts --apply    # применить (после scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-category-refs.ts --rollback # откат по журналу
 *
 * Источники: правила и список категорий src/lib/product-category.ts (CATEGORY_RULES) + реально встречающиеся тексты
 * ProductModel.category. Однозначное соответствие (в тексте ключевые слова ровно одной категории) — модель получает
 * categoryRefId, текст category приводится к каноническому названию, прежний текст уходит синонимом категории.
 * Спорное (несколько категорий в тексте, нет ключевых слов, пусто) — модель не трогается, остаётся в блоке «Не сопоставлено».
 * Категория подтверждена (confirmed), если у неё есть однозначно привязанные модели; иначе «предложено, ждёт подтверждения».
 * Идемпотентно: повторный запуск не дублирует. Журнал: docs-inventory/corrections-journal-category-refs.json
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { CATEGORY_RULES, categoryHitsFromText } from "../src/lib/product-category";
import { categoryKey, oneLine } from "../src/lib/category-ref";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-category-refs.json");

type Journal = {
  script: string;
  appliedAt?: string;
  rolledBackAt?: string;
  createdRefs: Array<{ id: string; name: string }>;
  aliasAdds: Array<{ id: string; name: string; alias: string }>;
  confirmedRefs: Array<{ id: string; name: string; oldConfirmed: boolean; oldNote: string | null }>;
  models: Array<{ id: string; name: string; oldCategory: string | null; newCategory: string; newRefId: string }>;
  /** Прежний текст категории («Пальто женское из соболя») сохранён в пустом описании модели, чтобы подробное название не пропало. */
  descriptions?: Array<{ id: string; text: string }>;
};

async function rollback() {
  const j = readJson<Journal | null>(JOURNAL, null);
  if (!j) return console.log("Журнала нет");
  let n = 0, skip = 0;
  for (const m of [...j.models].reverse()) {
    const cur = await prisma.productModel.findUnique({ where: { id: m.id } });
    if (!cur || cur.categoryRefId !== m.newRefId) { skip++; continue; }
    await prisma.productModel.update({ where: { id: m.id }, data: { categoryRefId: null, category: cur.category === m.newCategory ? m.oldCategory : cur.category } });
    n++;
  }
  for (const d of [...(j.descriptions ?? [])].reverse()) await prisma.productModel.updateMany({ where: { id: d.id, description: d.text }, data: { description: null } });
  // Созданные категории удаляем, только если на них никто не ссылается (после отката моделей ссылок нет).
  let del = 0;
  for (const r of j.createdRefs) {
    const used = await prisma.productModel.count({ where: { categoryRefId: r.id } });
    if (used === 0) { await prisma.categoryRef.deleteMany({ where: { id: r.id } }); del++; }
  }
  for (const c of j.confirmedRefs) await prisma.categoryRef.updateMany({ where: { id: c.id }, data: { confirmed: c.oldConfirmed, note: c.oldNote } });
  for (const a of j.aliasAdds) {
    const ref = await prisma.categoryRef.findUnique({ where: { id: a.id } });
    if (ref) await prisma.categoryRef.update({ where: { id: a.id }, data: { aliases: ref.aliases.filter((x) => x !== a.alias) } });
  }
  console.log(`Откат: моделей ${n}, пропущено ${skip}, удалено категорий ${del}`);
  writeJson(JOURNAL, { ...j, rolledBackAt: new Date().toISOString(), createdRefs: [], aliasAdds: [], confirmedRefs: [], models: [], descriptions: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const journal = readJson<Journal>(JOURNAL, { script: "seed-category-refs.ts", createdRefs: [], aliasAdds: [], confirmedRefs: [], models: [] });
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==");
  for (const org of orgs) {
    const refs = await prisma.categoryRef.findMany({ where: { organizationId: org.id } });
    const byKey = new Map(refs.map((r) => [categoryKey(r.name), r]));
    const models = await prisma.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, category: true, categoryRefId: true } });

    // 1. Отнесение моделей: однозначные — к категории, спорные — в список.
    const plan = new Map<string, { name: string; aliasTexts: Set<string>; models: typeof models }>();
    const disputed: Array<{ text: string; hits: string[]; models: number }> = [];
    for (const m of models) {
      if (m.categoryRefId) continue;
      const text = oneLine(m.category);
      const hits = categoryHitsFromText(text);
      if (hits.length !== 1) {
        const d = disputed.find((x) => x.text === text);
        if (d) d.models++; else disputed.push({ text, hits, models: 1 });
        continue;
      }
      const e = plan.get(hits[0]) ?? { name: hits[0], aliasTexts: new Set<string>(), models: [] };
      e.models.push(m);
      if (categoryKey(text) !== categoryKey(hits[0])) e.aliasTexts.add(text);
      plan.set(hits[0], e);
    }

    console.log(`\nКатегория (правило) | моделей привязать | новые синонимы`);
    for (const [i, r] of CATEGORY_RULES.entries()) {
      const e = plan.get(r.category);
      const existing = byKey.get(categoryKey(r.category));
      console.log(`${r.category.padEnd(18)} ${existing ? "(есть)" : "(новая)"} моделей ${e?.models.length ?? 0}, синонимов ${e?.aliasTexts.size ?? 0}${(e?.models.length ?? 0) > 0 || existing?.confirmed ? " → подтверждена" : " → предложена, ждёт подтверждения"}`);
      void i;
    }
    console.log("\nНе сопоставлено (спорное / без ключевых слов / пусто):");
    for (const d of disputed) console.log(`  «${d.text || "(пусто)"}» моделей ${d.models}${d.hits.length ? ` — в тексте: ${d.hits.join(", ")}` : ""}`);
    if (!APPLY) continue;

    // 2. Категории.
    for (const [i, r] of CATEGORY_RULES.entries()) {
      const e = plan.get(r.category);
      let ref = byKey.get(categoryKey(r.category));
      const bound = (e?.models.length ?? 0) > 0;
      if (!ref) {
        ref = await prisma.categoryRef.create({
          data: {
            organizationId: org.id, name: r.category, aliases: [], sortOrder: (i + 1) * 10, confirmed: bound,
            note: bound ? "Из правил src/lib/product-category.ts; подтверждено моделями с однозначным названием." : "Предложено, ждёт подтверждения. Из правил src/lib/product-category.ts, моделей с такой категорией пока нет.",
          },
        });
        journal.createdRefs.push({ id: ref.id, name: ref.name });
        byKey.set(categoryKey(ref.name), ref);
      } else if (bound && !ref.confirmed) {
        journal.confirmedRefs.push({ id: ref.id, name: ref.name, oldConfirmed: ref.confirmed, oldNote: ref.note });
        ref = await prisma.categoryRef.update({ where: { id: ref.id }, data: { confirmed: true } });
      }
      if (!e) continue;
      // 3. Синонимы и модели.
      const have = new Set([ref.name, ...ref.aliases].map(categoryKey));
      const add = [...e.aliasTexts].filter((t) => !have.has(categoryKey(t)));
      if (add.length) {
        await prisma.categoryRef.update({ where: { id: ref.id }, data: { aliases: [...ref.aliases, ...add] } });
        for (const a of add) journal.aliasAdds.push({ id: ref.id, name: ref.name, alias: a });
      }
      for (const m of e.models) {
        await prisma.productModel.update({ where: { id: m.id }, data: { categoryRefId: ref.id, category: ref.name } });
        journal.models.push({ id: m.id, name: m.name, oldCategory: m.category, newCategory: ref.name, newRefId: ref.id });
      }
      writeJson(JOURNAL, { ...journal, appliedAt: new Date().toISOString() });
    }
  }
  if (APPLY) {
    // Подробное прежнее название не теряем: кладём в пустое описание модели (если текст отличался от канонического).
    journal.descriptions ??= [];
    for (const m of journal.models) {
      const old = oneLine(m.oldCategory);
      if (!old || categoryKey(old) === categoryKey(m.newCategory) || journal.descriptions.some((d) => d.id === m.id)) continue;
      const cur = await prisma.productModel.findUnique({ where: { id: m.id }, select: { description: true } });
      if (cur && !(cur.description ?? "").trim()) {
        await prisma.productModel.update({ where: { id: m.id }, data: { description: old } });
        journal.descriptions.push({ id: m.id, text: old });
      }
    }
    writeJson(JOURNAL, { ...journal, appliedAt: new Date().toISOString() }); console.log(`\nГотово. Журнал ${JOURNAL}`); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
