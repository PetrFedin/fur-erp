/**
 * Подтверждение «предложенных» цветов по документам и привязка ТЗ / позиций закупок / лотов.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-colors.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-colors.ts --apply    # применить (после scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-colors.ts --rollback # откат по журналу
 *
 * Подтверждаются только цвета с прямым русским названием в документах (единый реестр: «шкура каракуля SWAKARA орех»,
 * «шкура норки ирис», «ПРИЛОЖЕНИЕ 17 (… свакара облако)», «тортора» в комментариях и т.д.). «Натуральный» и «С-Бежевый» остаются
 * «ждёт подтверждения». verifiedAt не трогаем. Лоты/позиции с «голубой ирис» получают только ссылку, текст остаётся.
 * Журнал: docs-inventory/corrections-journal-color-confirm.json
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { matchColorRef, splitColorCode, isProposed, type ColorRefLite } from "../src/lib/color-ref";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-color-confirm.json");

const CONFIRM: Record<string, { base: string; note: string }> = {
  Тортора: { base: "Бежевый", note: "Подтверждено по документам: в комментариях единого реестра (лист «EB заказ», «Лист12») — «дикий соболь … тортора», «седой тортор (silvery 4/5)»; цвет TORTORA, аналог-цвет реестра «Бежевый»." },
  Орех: { base: "Бежевый", note: "Подтверждено по документам: единый реестр — номенклатура «шкура каракуля SWAKARA орех» (цвет NUT, аналог «Бежевый»); лот «орех» в закупках." },
  Фондю: { base: "Коричневый", note: "Подтверждено по документам: единый реестр — «шкура каракуля SWAKARA фондю», «ПРИЛОЖЕНИЕ 18 (1 пальто свакара фондю)»; приложения ТЗ — «Коричневый (фондю)»." },
  Нуга: { base: "Бежевый", note: "Подтверждено по документам: единый реестр — «шкура каракуля SWAKARA нуга», «ПРИЛОЖЕНИЕ 16 (1 жакет свакара нуга)»; приложения ТЗ — «Бежевый (нуга)»." },
  Пастель: { base: "Бежевый", note: "Подтверждено по документам: единый реестр — «шкура норки американская пастель», «норка пастель»; приложения ТЗ — «Бежевый (пастель)»." },
  Ирис: { base: "Серый", note: "Подтверждено по названию: единый реестр — «шкура норки ирис», «ПРИЛОЖЕНИЕ 11 (4 манишки ирис)»; цвет IRIS, аналог «Серый». Базовый тон в лотах закупок записан «голубой ирис» — расхождение тона, текст лотов не менялся." },
  Облако: { base: "С-Серый", note: "Подтверждено по документам: единый реестр — «шкура каракуля SWAKARA облако», «ПРИЛОЖЕНИЕ 17 (3 жакет свакара облако)»; приложения ТЗ — «с-серый (облако)»; CLOUD 239264 — код цвета реестра." },
};
const KEEP_TEXT = new Set(["голубой ирис"]);

type Entity = "ProductionOrder" | "PurchaseItem" | "RawMaterialLot";
type Change =
  | { kind: "ref"; id: string; name: string; oldNote: string | null; newNote: string }
  | { kind: "set"; entity: Entity; id: string; ref: string; field: "colorRefId" | "color" | "notes"; old: string | null; new: string | null };
type Dlg = { findUnique(a: unknown): Promise<Record<string, string | null> | null>; update(a: unknown): Promise<unknown> };
const delegate = (e: Entity) => (e === "ProductionOrder" ? prisma.productionOrder : e === "PurchaseItem" ? prisma.purchaseItem : prisma.rawMaterialLot) as unknown as Dlg;

async function rollback() {
  const j = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  let n = 0, skip = 0;
  for (const c of [...j.changes].reverse()) {
    if (c.kind === "ref") { await prisma.colorRef.update({ where: { id: c.id }, data: { note: c.oldNote } }); n++; continue; }
    const cur = await delegate(c.entity).findUnique({ where: { id: c.id } });
    if (!cur || (cur[c.field] ?? null) !== c.new) { skip++; continue; }
    await delegate(c.entity).update({ where: { id: c.id }, data: { [c.field]: c.old } });
    n++;
  }
  console.log(`Откат: ${n}, пропущено ${skip}`);
  writeJson(JOURNAL, { script: "confirm-colors.ts", rolledBackAt: new Date().toISOString(), changes: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  const changes: Change[] = [];
  const dbRefs = await prisma.colorRef.findMany();
  const refs: Array<ColorRefLite & { orgId: string }> = dbRefs.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, note: r.note, orgId: r.organizationId }));
  for (const r of refs) {
    const c = CONFIRM[r.name];
    if (c && isProposed(r.note)) {
      changes.push({ kind: "ref", id: r.id, name: r.name, oldNote: r.note ?? null, newNote: c.note });
      r.note = c.note; // подтверждён в памяти — теперь участвует в сопоставлении
    }
  }
  const summary: Record<string, number> = {};
  const stat = (k: string) => (summary[k] = (summary[k] ?? 0) + 1);
  const baseOf = (name: string) => CONFIRM[name]?.base;
  for (const e of ["ProductionOrder", "PurchaseItem", "RawMaterialLot"] as Entity[]) {
    const rows: Array<{ id: string; color: string | null; notes?: string | null; colorRefId: string | null; ref: string; orgId: string }> =
      e === "ProductionOrder"
        ? (await prisma.productionOrder.findMany({ where: { colorRefId: null, color: { not: null } } })).map((o) => ({ id: o.id, color: o.color, notes: o.notes, colorRefId: null, ref: o.number, orgId: o.organizationId }))
        : e === "PurchaseItem"
          ? (await prisma.purchaseItem.findMany({ where: { colorRefId: null, color: { not: null } }, include: { purchase: true } })).map((o) => ({ id: o.id, color: o.color, colorRefId: null, ref: o.purchase.number, orgId: o.purchase.organizationId }))
          : (await prisma.rawMaterialLot.findMany({ where: { colorRefId: null, color: { not: null } } })).map((o) => ({ id: o.id, color: o.color, colorRefId: null, ref: `лот ${o.lotNumber}`, orgId: o.organizationId }));
    for (const r of rows) {
      const m = matchColorRef(r.color, refs.filter((x) => x.orgId === r.orgId));
      if (!m) continue;
      stat(`${e}→${m.name}`);
      changes.push({ kind: "set", entity: e, id: r.id, ref: r.ref, field: "colorRefId", old: null, new: m.id });
      const keep = KEEP_TEXT.has((r.color ?? "").trim().toLowerCase());
      if (!keep && r.color !== m.name) changes.push({ kind: "set", entity: e, id: r.id, ref: r.ref, field: "color", old: r.color, new: m.name });
      if (e === "ProductionOrder" && baseOf(m.name)) {
        const { code } = splitColorCode(r.color);
        let add = `Цвет по реестру: «${(r.color ?? "").trim()}»; базовый цвет (аналог в реестре): «${baseOf(m.name)}»`;
        if (code) add += `; код цвета: ${code}`;
        if (!(r.notes ?? "").includes("Цвет по реестру:") && !(r.notes ?? "").includes(`Код цвета: ${code}`))
          changes.push({ kind: "set", entity: e, id: r.id, ref: r.ref, field: "notes", old: r.notes ?? null, new: r.notes ? `${r.notes}\n${add}` : add });
      }
    }
  }
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==", "подтверждается цветов:", changes.filter((c) => c.kind === "ref").map((c) => (c as { name: string }).name).join(", "));
  console.log(summary);
  if (!APPLY) return;
  const prev = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  const applied: Change[] = [];
  const flush = () => writeJson(JOURNAL, { script: "confirm-colors.ts", appliedAt: new Date().toISOString(), changes: [...prev.changes, ...applied] });
  for (const c of changes) {
    if (c.kind === "ref") await prisma.colorRef.update({ where: { id: c.id }, data: { note: c.newNote } });
    else {
      if (c.field === "notes") { // перечитать: другой агент мог изменить примечание
        const cur = await delegate(c.entity).findUnique({ where: { id: c.id } });
        const base = cur?.notes ?? null;
        const add = (c.new ?? "").slice((c.old ?? "").length).replace(/^\n/, "");
        c.old = base; c.new = base ? `${base}\n${add}` : add;
      }
      await delegate(c.entity).update({ where: { id: c.id }, data: { [c.field]: c.new } });
    }
    applied.push(c);
    if (applied.length % 40 === 0) flush();
  }
  flush();
  console.log(`Применено ${applied.length}. Журнал ${JOURNAL}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
