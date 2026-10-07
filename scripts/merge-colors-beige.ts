/**
 * Слияние цветов «С-Бежевый» → «Светло-бежевый» (решение владельца: это один и тот же цвет).
 * Повторяет штатное объединение справочника цветов (settings/colors mergeColors): ТЗ, позиции закупок и лоты со ссылкой на
 * «С-Бежевый» (а также со свободным текстом «С-Бежевый» без ссылки) переезжают в «Светло-бежевый», текст color = каноническое
 * название, «С-Бежевый» становится синонимом, запись «С-Бежевый» удаляется. Итоговый цвет подтверждается (пометка «Предложено…» снимается).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/merge-colors-beige.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/merge-colors-beige.ts --apply    # применить (после scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/merge-colors-beige.ts --rollback # откат по журналу
 * Журнал: docs-inventory/corrections-journal-color-beige-merge.json
 */
import { join } from "path";
import { PrismaClient, type ColorRef } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { colorKey, PROPOSED_MARK } from "../src/lib/color-ref";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-color-beige-merge.json");
const FROM = "С-Бежевый";
const INTO = "Светло-бежевый";

type Entity = "ProductionOrder" | "RawMaterialLot" | "PurchaseItem";
type Journal = {
  script: string; appliedAt?: string; rolledBackAt?: string;
  from: ColorRef | null; intoBefore: ColorRef | null;
  rows: Array<{ entity: Entity; id: string; oldColor: string | null; oldColorRefId: string | null }>;
};
type Dlg = { update(a: unknown): Promise<unknown> };
const dlg = (e: Entity) => (e === "ProductionOrder" ? prisma.productionOrder : e === "RawMaterialLot" ? prisma.rawMaterialLot : prisma.purchaseItem) as unknown as Dlg;
const stripMark = (n: string | null) => ((n ?? "").trim().replace(new RegExp(`^${PROPOSED_MARK}\\.?\\s*`), "").trim() || null);

async function rollback() {
  const j = readJson<Journal | null>(JOURNAL, null);
  if (!j?.from || !j.intoBefore) return console.log("Журнала нет или он пуст");
  const { createdAt: _c, updatedAt: _u, ...from } = j.from;
  void _c; void _u;
  if (!(await prisma.colorRef.findUnique({ where: { id: from.id } }))) await prisma.colorRef.create({ data: from });
  await prisma.colorRef.update({ where: { id: j.intoBefore.id }, data: { aliases: j.intoBefore.aliases, note: j.intoBefore.note } });
  for (const r of j.rows) await dlg(r.entity).update({ where: { id: r.id }, data: { color: r.oldColor, colorRefId: r.oldColorRefId } });
  console.log(`Откат: строк ${j.rows.length}`);
  writeJson(JOURNAL, { ...j, rolledBackAt: new Date().toISOString(), from: null, intoBefore: null, rows: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  const from = await prisma.colorRef.findFirst({ where: { name: FROM } });
  const into = await prisma.colorRef.findFirst({ where: { name: INTO } });
  if (!into) throw new Error(`Нет цвета «${INTO}»`);
  if (!from) { console.log(`«${FROM}» уже объединён. Подтверждение итога:`, stripMark(into.note) === into.note ? "есть" : "нужно"); }
  const orgId = into.organizationId;
  const fromKeys = new Set([FROM, ...(from?.aliases ?? [])].map(colorKey));
  const rows: Journal["rows"] = [];
  const pick = (entity: Entity, list: Array<{ id: string; color: string | null; colorRefId: string | null }>) => {
    for (const r of list) if (r.colorRefId === from?.id || (r.colorRefId === null && fromKeys.has(colorKey(r.color)) && r.color)) rows.push({ entity, id: r.id, oldColor: r.color, oldColorRefId: r.colorRefId });
  };
  pick("ProductionOrder", await prisma.productionOrder.findMany({ where: { organizationId: orgId, color: { not: null } }, select: { id: true, color: true, colorRefId: true } }));
  pick("RawMaterialLot", await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, color: { not: null } }, select: { id: true, color: true, colorRefId: true } }));
  pick("PurchaseItem", await prisma.purchaseItem.findMany({ where: { purchase: { organizationId: orgId }, color: { not: null } }, select: { id: true, color: true, colorRefId: true } }));
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==", `переезжает строк: ТЗ ${rows.filter((r) => r.entity === "ProductionOrder").length}, лотов ${rows.filter((r) => r.entity === "RawMaterialLot").length}, позиций закупок ${rows.filter((r) => r.entity === "PurchaseItem").length}`);
  console.log(`синонимы «${INTO}» после слияния:`, [...new Set([...into.aliases, ...(from ? [from.name, ...from.aliases] : [])])]);
  if (!APPLY) return;
  const journal = readJson<Journal>(JOURNAL, { script: "merge-colors-beige.ts", from: null, intoBefore: null, rows: [] });
  if (from) {
    journal.from = from; journal.intoBefore = into;
    writeJson(JOURNAL, journal);
    await prisma.$transaction(async (tx) => {
      const seen = new Set([colorKey(into.name), ...into.aliases.map(colorKey)]);
      const merged = [...into.aliases];
      for (const a of [from.name, ...from.aliases]) { const k = colorKey(a); if (k && !seen.has(k)) { seen.add(k); merged.push(a); } }
      for (const r of rows) await (dlg(r.entity) as { update(a: unknown): Promise<unknown> }).update({ where: { id: r.id }, data: { colorRefId: into.id, color: into.name } });
      await tx.colorRef.update({ where: { id: into.id }, data: { aliases: merged } });
      await tx.colorRef.delete({ where: { id: from.id } });
    });
    journal.rows = rows;
  }
  const cur = await prisma.colorRef.findUniqueOrThrow({ where: { id: into.id } });
  if (!journal.intoBefore) journal.intoBefore = into;
  await prisma.colorRef.update({ where: { id: into.id }, data: { note: from ? [stripMark(cur.note), `Подтверждено владельцем (07.10.2026): «${FROM}» и «${INTO}» — один цвет, «${FROM}» теперь синоним.`].filter(Boolean).join(" ") : stripMark(cur.note) } });
  journal.appliedAt = new Date().toISOString();
  writeJson(JOURNAL, journal);
  console.log("Готово. Журнал", JOURNAL);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
