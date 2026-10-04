/**
 * Справочник цветов: засев ColorRef и привязка однозначных значений.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-color-refs.ts            # пробный прогон (пишет только docs-inventory/color-unification.md)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-color-refs.ts --apply    # применить (после scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-color-refs.ts --rollback # откат по журналу
 *
 * Что делает: создаёт цвета из scripts/color-seed-data.ts (если такого названия ещё нет); у ТЗ, позиций закупок и
 * лотов, чьё написание ОДНОЗНАЧНО соответствует подтверждённому цвету, ставит colorRefId и приводит текст `color`
 * к каноническому названию. Код (5–7 цифр) из «BROWN 239341» переносится в примечание ТЗ. Неоднозначные значения
 * и «предложенные» цвета не трогает — они попадают в блок «Не сопоставлено» на /settings/colors.
 * Журнал: docs-inventory/corrections-journal-color-refs.json
 */
import { join } from "path";
import { existsSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { SEED_COLORS } from "./color-seed-data";
import { matchColorRef, splitColorCode, suggestColorRef, type ColorRefLite } from "../src/lib/color-ref";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-color-refs.json");
const REPORT = join(INV, "color-unification.md");

type Entity = "ProductionOrder" | "PurchaseItem" | "RawMaterialLot";
type Change =
  | { kind: "create-ref"; id: string; name: string }
  | { kind: "set"; entity: Entity; id: string; ref: string; field: "colorRefId" | "color" | "notes"; old: string | null; new: string | null };

type Row3 = { id: string; color: string | null; notes?: string | null };
type Dlg = {
  findUnique(a: { where: { id: string } }): Promise<Row3 | null>;
  update(a: { where: { id: string }; data: Record<string, string | null> }): Promise<unknown>;
};
const delegate = (e: Entity) => (e === "ProductionOrder" ? prisma.productionOrder : e === "PurchaseItem" ? prisma.purchaseItem : prisma.rawMaterialLot) as unknown as Dlg;

async function rollback() {
  const j = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  let done = 0;
  let skipped = 0;
  for (const c of [...j.changes].reverse()) {
    if (c.kind === "set") {
      const cur = (await delegate(c.entity).findUnique({ where: { id: c.id } })) as Record<string, string | null> | null;
      if (!cur || (cur[c.field] ?? null) !== c.new) {
        skipped++;
        continue;
      }
      await delegate(c.entity).update({ where: { id: c.id }, data: { [c.field]: c.old } });
      done++;
    } else {
      const used = await prisma.colorRef.findUnique({ where: { id: c.id }, include: { _count: { select: { orders: true, lots: true, purchaseItems: true } } } });
      if (!used) continue;
      const n = used._count.orders + used._count.lots + used._count.purchaseItems;
      if (n > 0) {
        skipped++;
        console.log(`  цвет «${used.name}» оставлен: на него ссылаются ${n} строк (добавлены после засева)`);
        continue;
      }
      await prisma.colorRef.delete({ where: { id: c.id } });
      done++;
    }
  }
  console.log(`Откат: ${done} шагов, пропущено ${skipped}`);
  writeJson(JOURNAL, { script: "seed-color-refs.ts", rolledBackAt: new Date().toISOString(), changes: [] });
}

type Row = { entity: Entity; id: string; ref: string; color: string; notes?: string | null; colorRefId?: string | null };

async function main() {
  if (ROLLBACK) return rollback();
  const orgs = await prisma.organization.findMany();
  const changes: Change[] = [];
  const spellingsBefore = new Set<string>();
  const spellingsAfter = new Set<string>();
  let ordersWithColor = 0;
  let ordersLinked = 0;
  let ordersWithoutRef = 0;
  const plannedCreates: Array<{ organizationId: string; name: string; aliases: string[]; note: string }> = [];
  const tableByTarget = new Map<string, { raw: Map<string, { o: number; i: number; l: number }>; status: string; confidence: string }>();
  const unmatched = new Map<string, { o: number; i: number; l: number; sug: string | null }>();

  for (const org of orgs) {
    const existing = await prisma.colorRef.findMany({ where: { organizationId: org.id } });
    const refs: Array<ColorRefLite & { planned?: boolean }> = existing.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, note: r.note }));
    for (const s of SEED_COLORS) {
      const have = refs.find((r) => r.name.toLowerCase() === s.name.toLowerCase());
      if (have) continue;
      const note = s.note;
      refs.push({ id: `new:${s.name}`, name: s.name, aliases: s.aliases, note: s.auto ? s.note : note, planned: true });
      plannedCreates.push({ organizationId: org.id, name: s.name, aliases: s.aliases, note });
    }

    const rows: Row[] = [];
    for (const o of await prisma.productionOrder.findMany({ where: { organizationId: org.id, color: { not: null } }, select: { id: true, number: true, color: true, notes: true, colorRefId: true } }))
      if (o.color?.trim()) rows.push({ entity: "ProductionOrder", id: o.id, ref: o.number, color: o.color, notes: o.notes, colorRefId: o.colorRefId });
    for (const i of await prisma.purchaseItem.findMany({ where: { purchase: { organizationId: org.id }, color: { not: null } }, select: { id: true, color: true, colorRefId: true, purchase: { select: { number: true } } } }))
      if (i.color?.trim()) rows.push({ entity: "PurchaseItem", id: i.id, ref: i.purchase.number, color: i.color, colorRefId: i.colorRefId });
    for (const l of await prisma.rawMaterialLot.findMany({ where: { organizationId: org.id, color: { not: null } }, select: { id: true, color: true, colorRefId: true, lotNumber: true } }))
      if (l.color?.trim()) rows.push({ entity: "RawMaterialLot", id: l.id, ref: `лот ${l.lotNumber ?? l.id}`, color: l.color, colorRefId: l.colorRefId });

    for (const r of rows) {
      spellingsBefore.add(r.color.trim());
      const bump = (m: Map<string, { o: number; i: number; l: number }>, k: string) => {
        const e = m.get(k) ?? { o: 0, i: 0, l: 0 };
        if (r.entity === "ProductionOrder") e.o++;
        else if (r.entity === "PurchaseItem") e.i++;
        else e.l++;
        m.set(k, e);
      };
      if (r.entity === "ProductionOrder") ordersWithColor++;
      const m = matchColorRef(r.color, refs);
      if (m) {
        const { code } = splitColorCode(r.color);
        const key = `${m.name}|${m.id}`;
        let t = tableByTarget.get(key);
        if (!t) {
          const sd = SEED_COLORS.find((s) => s.name === m.name);
          t = { raw: new Map(), status: "объединено автоматически", confidence: sd?.confidence ?? "высокая" };
          tableByTarget.set(key, t);
        }
        bump(t.raw, r.color.trim());
        spellingsAfter.add(m.name);
        if (r.entity === "ProductionOrder") ordersLinked++;
        // colorRefId проставляется после создания цвета (для новых id вида «new:Название»)
        if (r.colorRefId !== m.id) changes.push({ kind: "set", entity: r.entity, id: r.id, ref: r.ref, field: "colorRefId", old: r.colorRefId ?? null, new: m.id });
        if (r.color !== m.name) changes.push({ kind: "set", entity: r.entity, id: r.id, ref: r.ref, field: "color", old: r.color, new: m.name });
        if (code && r.entity === "ProductionOrder" && !(r.notes ?? "").includes(`Код цвета: ${code}`)) {
          const add = `Код цвета: ${code} (из реестра: «${r.color.trim()}»)`;
          changes.push({ kind: "set", entity: r.entity, id: r.id, ref: r.ref, field: "notes", old: r.notes ?? null, new: r.notes ? `${r.notes}\n${add}` : add });
        }
      } else {
        spellingsAfter.add(r.color.trim());
        if (r.entity === "ProductionOrder") ordersWithoutRef++;
        const sug = suggestColorRef(r.color, refs);
        const k = r.color.trim();
        const u = unmatched.get(k) ?? { o: 0, i: 0, l: 0, sug: sug ? sug.ref.name : null };
        if (r.entity === "ProductionOrder") u.o++;
        else if (r.entity === "PurchaseItem") u.i++;
        else u.l++;
        unmatched.set(k, u);
      }
    }
  }

  // ── отчёт ──
  const fmt = (e: { o: number; i: number; l: number }) => `${e.o} / ${e.i} / ${e.l}`;
  const lines: string[] = [];
  lines.push("# Единый справочник цветов — предложение унификации", "");
  lines.push(`Сформировано скриптом \`scripts/seed-color-refs.ts\` ${new Date().toISOString().slice(0, 10)}. Источники значений: ТЗ (\`ProductionOrder.color\`), позиции закупок и лоты (\`color\`), единый реестр «21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST 2.xlsx» (колонки Color / Analog Color — латиница), приложения ТЗ (\`docs-inventory/extract/prod*.json\`, цвет по-русски, часто «Базовый (оттенок)»).`, "");
  lines.push(`**Было ${spellingsBefore.size} написаний → стало ${spellingsAfter.size} значений** (из них подтверждённых цветов справочника: ${tableByTarget.size}, не сопоставлено осталось ${unmatched.size}).`);
  lines.push("", "Колонка «ТЗ / закупок / лотов» — сколько ТЗ, позиций закупок и лотов используют это написание.", "");
  lines.push("## 1. Объединено автоматически (однозначные)", "", "| Было (написания) | Предложено (канон) | ТЗ / закупок / лотов | Уверенность | Основание |", "|---|---|---|---|---|");
  for (const [key, t] of [...tableByTarget.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"))) {
    const name = key.split("|")[0];
    const sd = SEED_COLORS.find((s) => s.name === name);
    const tot = { o: 0, i: 0, l: 0 };
    for (const v of t.raw.values()) {
      tot.o += v.o;
      tot.i += v.i;
      tot.l += v.l;
    }
    const was = [...t.raw.entries()].sort((a, b) => b[1].o + b[1].i + b[1].l - (a[1].o + a[1].i + a[1].l)).map(([k, v]) => `${k} (${fmt(v)})`).join("<br>");
    lines.push(`| ${was} | **${name}** | ${fmt(tot)} | ${t.confidence} | ${sd?.note ?? ""} |`);
  }
  lines.push("", "## 2. Предложено — ждёт подтверждения (ссылки у ТЗ/лотов НЕ проставлены, текст не менялся)", "", "Цвет заведён в справочник с пометкой «Предложено, ждёт подтверждения»; привязать значения можно на /settings/colors, блок «Не сопоставлено».", "", "| Было (написания) | Предложено | ТЗ / закупок / лотов | Уверенность | Основание |", "|---|---|---|---|---|");
  const proposed = SEED_COLORS.filter((s) => !s.auto);
  const used = new Set<string>();
  for (const s of proposed) {
    const was: string[] = [];
    const tot = { o: 0, i: 0, l: 0 };
    for (const [k, v] of unmatched) {
      if (v.sug === s.name) {
        was.push(`${k} (${fmt(v)})`);
        tot.o += v.o;
        tot.i += v.i;
        tot.l += v.l;
        used.add(k);
      }
    }
    lines.push(`| ${was.join("<br>") || "—"} | **${s.name}** | ${fmt(tot)} | ${s.confidence} | ${s.note.replace(/^Предложено, ждёт подтверждения\. /, "")} |`);
  }
  lines.push("", "## 3. Без предложения (остаётся как есть)", "", "| Значение | ТЗ / закупок / лотов | Что с ним |", "|---|---|---|");
  for (const [k, v] of unmatched) if (!used.has(k)) lines.push(`| ${k} | ${fmt(v)} | ${/[×;]|\bx\d/.test(k) ? "смешанное значение (несколько цветов в одной ячейке) — разнести по размерам вручную" : "подходящего цвета в справочнике нет — добавить вручную"} |`);

  // цвет в описаниях
  lines.push("", "## 4. Цвет внутри описания (сорт лота / описание ТЗ), в поле «цвет» не вынесен", "", "Эти значения не переносятся автоматически — поле «цвет» у них остаётся прежним; предложения для ручной проверки:", "");
  const gradeHits = await prisma.rawMaterialLot.findMany({ where: { OR: [{ grade: { contains: "краш", mode: "insensitive" } }, { grade: { contains: "махагон", mode: "insensitive" } }] }, select: { grade: true } });
  const gh = new Map<string, number>();
  for (const g of gradeHits) if (g.grade && /браун\s+краш|краш\S*\s+в\s+черн|махагон/i.test(g.grade)) gh.set(g.grade, (gh.get(g.grade) ?? 0) + 1);
  const oh = await prisma.productionOrder.findMany({ where: { OR: [{ materialDescription: { contains: "краш", mode: "insensitive" } }, { materialDescription: { contains: "махагон", mode: "insensitive" } }] }, select: { materialDescription: true } });
  const ohm = new Map<string, number>();
  for (const o of oh) if (o.materialDescription && /браун\s+краш|краш\S*\s+в\s+черн|махагон/i.test(o.materialDescription)) ohm.set(o.materialDescription, (ohm.get(o.materialDescription) ?? 0) + 1);
  lines.push("| Где | Текст | Сколько | Предложение |", "|---|---|---|---|");
  for (const [g, n] of gh) lines.push(`| сорт лота | ${g} | ${n} | ${/черн|чёрн/i.test(g) ? "цвет «Чёрный» (крашеная), ждёт подтверждения" : "цвет «Коричневый», оттенок «махагон» — в описании; ждёт подтверждения"} |`);
  for (const [g, n] of ohm) lines.push(`| описание ТЗ | ${g.replace(/\n/g, " ")} | ${n} | ${/в черн/i.test(g) ? "цвет «Чёрный» (крашеная), ждёт подтверждения" : "ждёт подтверждения"} |`);
  lines.push("", "## 5. Итог сверки", "", `- ТЗ с заполненным цветом: ${ordersWithColor} до и после (число не меняется — меняется только написание).`, `- Из них привязано к справочнику автоматически: ${ordersLinked}; ждут ручной проверки: ${ordersWithoutRef}.`, `- Цветов будет создано в справочнике: ${plannedCreates.length}.`, "");
  // Отчёт — снимок «до»: после применения повторный прогон его не затирает (кроме явного --report).
  if (APPLY || process.argv.includes("--report") || !existsSync(REPORT)) writeFileSync(REPORT, lines.join("\n"));

  const setCounts: Record<string, number> = {};
  for (const c of changes) if (c.kind === "set") setCounts[`${c.entity}.${c.field}`] = (setCounts[`${c.entity}.${c.field}`] ?? 0) + 1;
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN (в базу ничего не записано) ==");
  console.log(`Написаний было ${spellingsBefore.size}, стало ${spellingsAfter.size}. Новых цветов: ${plannedCreates.length}. ТЗ с цветом ${ordersWithColor}: привязано ${ordersLinked}, в очереди ${ordersWithoutRef}.`);
  console.log("Изменений:", setCounts);
  console.log(`Отчёт: ${REPORT}`);
  if (!APPLY) return;

  const prev = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  const applied: Change[] = [];
  const flush = () => writeJson(JOURNAL, { script: "seed-color-refs.ts", appliedAt: new Date().toISOString(), changes: [...prev.changes, ...applied] });
  const idByPlan = new Map<string, string>();
  for (const c of plannedCreates) {
    const row = await prisma.colorRef.create({ data: c });
    idByPlan.set(`new:${c.name}`, row.id);
    applied.push({ kind: "create-ref", id: row.id, name: c.name });
    flush();
  }
  for (const c of changes) {
    if (c.kind !== "set") continue;
    const real = c.field === "colorRefId" && c.new ? idByPlan.get(c.new) ?? c.new : c.new;
    await delegate(c.entity).update({ where: { id: c.id }, data: { [c.field]: real } });
    applied.push({ ...c, new: real });
    if (applied.length % 50 === 0) flush();
  }
  flush();
  console.log(`Применено: создано цветов ${plannedCreates.length}, правок ${applied.length - plannedCreates.length}. Журнал: ${JOURNAL}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
