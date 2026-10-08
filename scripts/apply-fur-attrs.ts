/**
 * Признаки меха: засев справочника FurAttrRef и назначение лотам/ТЗ по тексту описаний.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-fur-attrs.ts            # пробный прогон: БД не меняется, пишет только отчёт docs-inventory/fur-attrs-report.md
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-fur-attrs.ts --apply    # применить (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-fur-attrs.ts --rollback # откат по журналу
 *
 * Что делает:
 *  1. Заводит недостающие признаки из src/lib/fur-attr.ts (FUR_ATTR_SEEDS) с пометкой «ждёт подтверждения»; существующие не трогает.
 *  2. Лотам ставит признаки, найденные в grade, color, notes лота и в grade/notes его позиций закупки (по названию и синонимам признака,
 *     целыми словами; диапазон «SIL 6/7» — не точное значение). ТЗ — по materialDescription. Ставит только признаки с autoDetect=true
 *     и подходящим видом меха; спорные (autoDetect=false) и диапазоны идут в отчёт как предложения. Признаки списанных в ТЗ лотов
 *     учитываются на лету (в базе у ТЗ они не копируются).
 *  3. Идемпотентно: уже стоящие связи не дублируются, ничего не снимается. Журнал: docs-inventory/corrections-journal-fur-attrs.json.
 */
import { join } from "path";
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { FUR_ATTR_SEEDS, findAttrs, type FurAttrLite } from "../src/lib/fur-attr";
import { buildFurIndex, canonicalFur } from "../src/lib/fur-ref";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const JOURNAL = join(INV, "corrections-journal-fur-attrs.json");
const REPORT = join(INV, "fur-attrs-report.md");

type Change =
  | { kind: "create-ref"; id: string; name: string }
  | { kind: "link"; entity: "lot" | "order"; id: string; attrId: string; attr: string; ref: string };

async function rollback() {
  const j = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  let done = 0;
  let skipped = 0;
  for (const c of [...j.changes].reverse()) {
    if (c.kind === "link") {
      const r = c.entity === "lot"
        ? await prisma.rawMaterialLotAttr.deleteMany({ where: { lotId: c.id, attrId: c.attrId, source: "auto" } })
        : await prisma.productionOrderAttr.deleteMany({ where: { orderId: c.id, attrId: c.attrId, source: "auto" } });
      if (r.count) done++;
      else skipped++;
    } else {
      const used = await prisma.furAttrRef.findUnique({ where: { id: c.id }, include: { _count: { select: { lots: true, orders: true } } } });
      if (!used) continue;
      if (used._count.lots + used._count.orders > 0) {
        skipped++;
        console.log(`  признак «${used.name}» оставлен: на него ссылаются ${used._count.lots + used._count.orders} строк (поставлены вручную)`);
        continue;
      }
      await prisma.furAttrRef.delete({ where: { id: c.id } });
      done++;
    }
  }
  console.log(`Откат: ${done} шагов, пропущено ${skipped}`);
  writeJson(JOURNAL, { script: "apply-fur-attrs.ts", rolledBackAt: new Date().toISOString(), changes: [] });
}

async function main() {
  if (ROLLBACK) return rollback();
  if (APPLY && !NO_BACKUP) {
    console.log("Копия базы перед применением: scripts/backup.sh …");
    execSync("sh scripts/backup.sh", { stdio: "inherit" });
  }
  const prev = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  const changes: Change[] = [...prev.changes];
  const orgs = await prisma.organization.findMany();
  const out: string[] = [];
  out.push("# Признаки меха — определение по описаниям лотов и ТЗ", "", `Сформировано \`scripts/apply-fur-attrs.ts\` ${new Date().toISOString().slice(0, 10)} (${APPLY ? "применено" : "пробный прогон, БД не менялась"}).`, "");

  for (const org of orgs) {
    // 1. справочник
    const existing = await prisma.furAttrRef.findMany({ where: { organizationId: org.id } });
    const refs: Array<FurAttrLite & { planned?: boolean }> = existing.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, group: r.group, furKind: r.furKind, autoDetect: r.autoDetect, confirmed: r.confirmed }));
    const created: string[] = [];
    for (const s of FUR_ATTR_SEEDS) {
      if (refs.some((r) => r.name.toLowerCase() === s.name.toLowerCase())) continue;
      let id = `new:${s.name}`;
      if (APPLY) {
        const c = await prisma.furAttrRef.create({ data: { organizationId: org.id, name: s.name, group: s.group, furKind: s.furKind, aliases: s.aliases, description: s.description, autoDetect: s.autoDetect, confirmed: false } });
        id = c.id;
        changes.push({ kind: "create-ref", id, name: s.name });
      }
      refs.push({ id, name: s.name, aliases: s.aliases, group: s.group, furKind: s.furKind, autoDetect: s.autoDetect, confirmed: false, planned: true });
      created.push(s.name);
    }
    out.push(`## Справочник`, "", created.length ? `Заведено признаков: ${created.length} (${created.join(", ")}) — все «ждут подтверждения».` : "Новых признаков заводить не нужно.", "");

    // 2. лоты
    const furRefs = await prisma.furRef.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, nameEn: true, aliases: true, note: true } });
    const furIdx = furRefs.length ? buildFurIndex(furRefs) : undefined;
    const lots = await prisma.rawMaterialLot.findMany({
      where: { organizationId: org.id },
      select: {
        id: true, lotNumber: true, grade: true, color: true, notes: true, quantityReceived: true,
        rawMaterial: { select: { name: true, unit: true } },
        purchaseItems: { select: { grade: true, notes: true } },
        attrs: { select: { attrId: true } },
      },
    });
    const idOf = (name: string) => refs.find((r) => r.name === name)!.id;
    const tally = new Map<string, { lots: number; qty: number; orders: number; sugLots: number; sugQty: number; sugOrders: number; ambLots: number }>();
    const row = (n: string) => tally.get(n) ?? tally.set(n, { lots: 0, qty: 0, orders: 0, sugLots: 0, sugQty: 0, sugOrders: 0, ambLots: 0 }).get(n)!;
    const examples = new Map<string, Set<string>>();
    const ex = (n: string, t: string | null) => { if (t) (examples.get(n) ?? examples.set(n, new Set()).get(n)!).add(t.slice(0, 90)); };
    const lotAttrs = new Map<string, string[]>();
    let newLotLinks = 0;
    for (const l of lots) {
      if (l.rawMaterial.unit === "M") continue; // подкладка
      const kind = canonicalFur(l.rawMaterial.name, furIdx)?.name ?? l.rawMaterial.name;
      const text = [l.grade, l.color, l.notes, ...l.purchaseItems.flatMap((i) => [i.grade, i.notes])].filter(Boolean).join(" ; ");
      const all = findAttrs(text, refs, { furKind: kind });
      const have = new Set(l.attrs.map((a) => a.attrId));
      const auto = all.matched.filter((h) => h.attr.autoDetect !== false);
      lotAttrs.set(l.id, auto.map((h) => h.attr.name));
      for (const h of auto) {
        const t = row(h.attr.name);
        t.lots++;
        t.qty += Number(l.quantityReceived);
        ex(h.attr.name, l.grade ?? l.color);
        if (have.has(h.attr.id)) continue;
        newLotLinks++;
        if (APPLY) {
          await prisma.rawMaterialLotAttr.create({ data: { lotId: l.id, attrId: h.attr.id, source: "auto" } });
          changes.push({ kind: "link", entity: "lot", id: l.id, attrId: h.attr.id, attr: h.attr.name, ref: `лот ${l.lotNumber ?? l.id}` });
        }
      }
      for (const h of all.matched.filter((x) => x.attr.autoDetect === false)) { const t = row(h.attr.name); t.sugLots++; t.sugQty += Number(l.quantityReceived); ex(h.attr.name, l.grade ?? l.color); }
      for (const h of all.ambiguous) { row(h.attr.name).ambLots++; ex(h.attr.name + " (диапазон — проверить)", l.grade); }
    }

    // 3. ТЗ: описание материала в самом ТЗ
    const orders = await prisma.productionOrder.findMany({
      where: { organizationId: org.id, status: { not: "CANCELLED" } },
      select: { id: true, number: true, materialDescription: true, attrs: { select: { attrId: true } }, materialUsages: { select: { lotId: true } } },
    });
    let newOrderLinks = 0;
    const viaLots = new Map<string, Set<string>>();
    for (const o of orders) {
      const text = o.materialDescription ?? "";
      const all = findAttrs(text, refs);
      const have = new Set(o.attrs.map((a) => a.attrId));
      for (const h of all.matched.filter((x) => x.attr.autoDetect !== false)) {
        row(h.attr.name).orders++;
        ex(h.attr.name, text.replace(/\s+/g, " "));
        if (have.has(h.attr.id)) continue;
        newOrderLinks++;
        if (APPLY) {
          await prisma.productionOrderAttr.create({ data: { orderId: o.id, attrId: h.attr.id, source: "auto" } });
          changes.push({ kind: "link", entity: "order", id: o.id, attrId: h.attr.id, attr: h.attr.name, ref: `ТЗ ${o.number}` });
        }
      }
      for (const h of all.matched.filter((x) => x.attr.autoDetect === false)) { row(h.attr.name).sugOrders++; ex(h.attr.name, text.replace(/\s+/g, " ")); }
      for (const lu of o.materialUsages) for (const n of lotAttrs.get(lu.lotId) ?? []) (viaLots.get(n) ?? viaLots.set(n, new Set()).get(n)!).add(o.id);
    }

    out.push("## Найдено", "", "| Признак | Лотов (авто) | Шкур, шт. | ТЗ в тексте (авто) | ТЗ через лоты | Только предложение: лотов / ТЗ | Диапазон (проверить), лотов | Примеры |", "|---|---|---|---|---|---|---|---|");
    for (const [name, t] of [...tally].sort((a, b) => b[1].lots - a[1].lots)) {
      const e = [...(examples.get(name) ?? [])].slice(0, 2).join("<br>");
      out.push(`| ${name} | ${t.lots} | ${Math.round(t.qty)} | ${t.orders} | ${viaLots.get(name)?.size ?? 0} | ${t.sugLots} / ${t.sugOrders} | ${t.ambLots} | ${e} |`);
    }
    out.push("", `Новых связей: лот→признак ${newLotLinks}, ТЗ→признак ${newOrderLinks}.`, "");
    console.log(`${org.name ?? org.id}: новых связей лот→признак ${newLotLinks}, ТЗ→признак ${newOrderLinks}, признаков заведено ${created.length}`);
    for (const [name, t] of [...tally].sort((a, b) => b[1].lots - a[1].lots)) console.log(`  ${name}: лотов ${t.lots} (${Math.round(t.qty)} шт.), ТЗ в тексте ${t.orders}, ТЗ через лоты ${viaLots.get(name)?.size ?? 0}, предложений ${t.sugLots}/${t.sugOrders}, диапазонов ${t.ambLots}`);
  }
  writeFileSync(REPORT, out.join("\n"));
  if (APPLY) writeJson(JOURNAL, { script: "apply-fur-attrs.ts", appliedAt: new Date().toISOString(), changes });
  console.log(APPLY ? `Применено. Журнал: ${JOURNAL}` : `Пробный прогон — БД не менялась. Отчёт: ${REPORT}. Применить: --apply`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
