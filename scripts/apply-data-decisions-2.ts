/**
 * Решения по «прежним вопросам» (08.10.2026), только подтверждённое документами/единым реестром.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-decisions-2.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-decisions-2.ts --apply    # применить (до этого scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-decisions-2.ts --rollback # откат по журналу
 *
 * Что делает:
 *  1) ColorRef.note у «Натуральный» и «Коричневый» — решение по NATURAL (ТЗ остаются «Коричневый»).
 *  2) Цвет «Лаванда» у лотов соболя, названных в едином реестре «Соболь дикий выделанный (лавандер 2039|лавандер), лот N»
 *     (лот и позиции закупок этого лота без цвета). Уже окрашенные лоты не трогаются.
 *  3) Лот 300687: цвет «Коричневый» (реестр: «выделанная шкурка норки коричневой 300687 (сага 03-26)», SAGA 03-26 «MINK BROWN M»,
 *     ТЗ 142/162/167 — «Коричневый»). Материал лота («Соболь» vs норка) НЕ меняется — решение владельца.
 *  4) Лот 513010: размер «40» (реестр: «шкура норки американский жемчуг самец 40», ТЗ 107/120/149/166).
 * verifiedAt не ставится. Журнал: docs-inventory/corrections-journal-data-decisions-2.json (идемпотентно).
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-data-decisions-2.json");
const TAG = "[data-decisions-2 2026-10-08]";

type Change =
  | { kind: "ref"; id: string; before: { note: string | null }; after: { note: string | null } }
  | { kind: "lot"; id: string; lot: string; before: { color: string | null; colorRefId: string | null; sizeGrade: string | null }; after: Record<string, string | null> }
  | { kind: "item"; id: string; before: { color: string | null; colorRefId: string | null }; after: Record<string, string | null> };
type Journal = { script: string; appliedAt?: string; rolledBackAt?: string; changes: Change[] };

const LAV_2039 = ["634", "1449", "1450", "1456", "1457", "1465", "1468", "1483", "1488", "1495", "1498", "3237", "3238", "3239", "3240", "3376", "3746", "3749", "3751", "3754", "3924", "3926", "4016", "4017", "4018", "4145", "4147", "4148", "4256", "4364", "4407"];
const LAV_PLAIN = ["1486", "1490", "1498", "1504", "1517", "1520", "1525", "1541", "1544", "3222", "3223", "3365", "3369", "3485", "3486", "3487", "3488", "3628", "3634", "3635", "3748", "3751", "3958", "3961", "3967", "4051", "4053"];
const LAV = [...new Set([...LAV_2039, ...LAV_PLAIN])];

const NOTE_NAT = `Решено 08.10.2026 (${TAG}): цвет изделия «Коричневый», отдельный цвет «Натуральный» не вводится. Основание: в приложениях ТЗ слова «натуральный» нет ни у одного из 11 ТЗ; в едином реестре NATURAL — код цвета (колонка К.Ц., лист «Реестр произведённых артикулов»/«Лист8»), а колонка «Цвет» у тех же артикулов (M004/M005/M006 SABLE FARM NO SILVER, SABLE WILD SILVER 2) = «Коричневый». Запись оставлена как псевдоним-справочник (ТЗ/лотов с ней нет).`;
const NOTE_BROWN_ADD = `NATURAL (код цвета соболя в реестре) — это «Коричневый»: решено 08.10.2026, см. «Натуральный».`;

async function rollback() {
  const j = readJson<Journal | null>(JOURNAL, null);
  if (!j?.changes?.length) return console.log("Журнала нет или он пуст");
  for (const c of [...j.changes].reverse()) {
    if (c.kind === "ref") await prisma.colorRef.update({ where: { id: c.id }, data: c.before });
    else if (c.kind === "lot") await prisma.rawMaterialLot.update({ where: { id: c.id }, data: c.before });
    else await prisma.purchaseItem.update({ where: { id: c.id }, data: c.before });
  }
  console.log(`Откат: ${j.changes.length}`);
  writeJson(JOURNAL, { ...j, rolledBackAt: new Date().toISOString(), changes: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  const changes: Change[] = [];
  const skipped: string[] = [];
  const refs = await prisma.colorRef.findMany();
  const ref = (n: string) => { const r = refs.find((x) => x.name === n); if (!r) throw new Error(`нет цвета ${n}`); return r; };

  // 1) заметки справочника
  for (const [name, add] of [["Натуральный", null], ["Коричневый", NOTE_BROWN_ADD]] as const) {
    const r = ref(name);
    if ((r.note ?? "").includes(TAG) || (r.note ?? "").includes("08.10.2026")) continue;
    const note = name === "Натуральный" ? NOTE_NAT : `${r.note ?? ""} ${add}`.trim();
    changes.push({ kind: "ref", id: r.id, before: { note: r.note }, after: { note } });
  }

  const lots = await prisma.rawMaterialLot.findMany({ include: { rawMaterial: true, purchaseItems: true } });
  const itemDone = new Set<string>();
  const colorLot = (l: (typeof lots)[number], colorName: string) => {
    const r = ref(colorName);
    changes.push({ kind: "lot", id: l.id, lot: l.lotNumber ?? l.id, before: { color: l.color, colorRefId: l.colorRefId, sizeGrade: l.sizeGrade }, after: { color: r.name, colorRefId: r.id } });
    for (const it of l.purchaseItems) if (!it.colorRefId && !itemDone.has(it.id) && l.rawMaterial.unit !== "M") {
      itemDone.add(it.id);
      changes.push({ kind: "item", id: it.id, before: { color: it.color, colorRefId: it.colorRefId }, after: { color: r.name, colorRefId: r.id } });
    }
  };

  // 2) лаванда
  const byNum = (n: string) => lots.filter((l) => l.lotNumber === n || (l.lotNumber ?? "").startsWith(`${n}-`));
  for (const n of LAV) {
    const found = byNum(n);
    if (!found.length) { skipped.push(`${n}: лота нет в БД`); continue; }
    for (const l of found) {
      if (!/собол/i.test(l.rawMaterial.name)) { skipped.push(`${l.lotNumber}: не соболь`); continue; }
      if (l.colorRefId) { if (l.color !== "Лаванда") skipped.push(`${l.lotNumber}: уже цвет «${l.color}»`); continue; }
      colorLot(l, "Лаванда");
    }
  }
  // 3) 300687
  for (const l of byNum("300687")) if (!l.colorRefId) colorLot(l, "Коричневый");
  // 4) 513010 размер
  for (const l of byNum("513010")) if (!l.sizeGrade) changes.push({ kind: "lot", id: l.id, lot: l.lotNumber ?? l.id, before: { color: l.color, colorRefId: l.colorRefId, sizeGrade: l.sizeGrade }, after: { sizeGrade: "40" } });

  const nLot = changes.filter((c) => c.kind === "lot").length, nItem = changes.filter((c) => c.kind === "item").length;
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==");
  console.log(`ColorRef.note: ${changes.filter((c) => c.kind === "ref").length}; лоты: ${nLot}; позиции закупок: ${nItem}`);
  if (skipped.length) console.log("пропущено:\n  " + skipped.join("\n  "));
  if (process.argv.includes("--list")) for (const c of changes) if (c.kind === "lot") console.log("lot", c.lot, JSON.stringify(c.after));
  if (!APPLY) return;

  const prev = readJson<Journal>(JOURNAL, { script: "apply-data-decisions-2.ts", changes: [] });
  const done: Change[] = [];
  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.kind === "ref") await tx.colorRef.update({ where: { id: c.id }, data: c.after });
      else if (c.kind === "lot") await tx.rawMaterialLot.update({ where: { id: c.id }, data: c.after });
      else await tx.purchaseItem.update({ where: { id: c.id }, data: c.after });
      done.push(c);
    }
  });
  writeJson(JOURNAL, { script: "apply-data-decisions-2.ts", appliedAt: new Date().toISOString(), changes: [...prev.changes, ...done] });
  console.log("Применено:", done.length);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
