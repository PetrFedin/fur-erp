// Решение владельца 23.10.2026: ТЗ 116 (ремонт пальто) → партия 15, ТЗ 117 (кейп М057) → партия 16.
// Прежнее состояние: batchId = null, batchNotRequired = true (письмо №135 от 10.07.2026 называло их вне партий). Откат: batchId = null, batchNotRequired = true.
import { PrismaClient } from "@prisma/client";
(async () => {
  const p = new PrismaClient();
  const pairs: [string, number][] = [["116", 15], ["117", 16]];
  for (const [wo, bn] of pairs) {
    const o = await p.productionOrder.findFirst({ where: { workOrderNumber: wo }, select: { id: true, number: true, organizationId: true, notes: true, batchId: true } });
    const b = o ? await p.productionBatch.findFirst({ where: { organizationId: o.organizationId, number: bn }, select: { id: true, notes: true, plannedUnits: true } }) : null;
    if (!o || !b) { console.log("пропуск", wo, bn, !!o, !!b); continue; }
    const q = Number((await p.productionOrder.findUnique({ where: { id: o.id }, select: { plannedQuantity: true } }))!.plannedQuantity);
    await p.productionOrder.update({ where: { id: o.id }, data: { batchId: b.id, batchNotRequired: false, notes: `${o.notes ?? ""}\n[owner:2026-10-23] Привязано к партии ${bn} по решению владельца (раньше — вне партий по письму №135 от 10.07.2026).`.trim() } });
    await p.productionBatch.update({ where: { id: b.id }, data: { year: 2026, plannedUnits: b.plannedUnits ?? q, notes: `ТЗ ${wo}. Привязано владельцем 23.10.2026.\n${(b.notes ?? "").replace(/^Документов нет[^\n]*\n?/, "")}`.trim() } });
    console.log("ok", o.number, "→ партия", bn);
  }
  process.exit(0);
})();
