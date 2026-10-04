/**
 * Дозаполнение деталей лотов закупок ТОЛЬКО из документов Drive «мех»
 * (docs-inventory/extract/p2025a|p2025b|p2026a|p2026b.json) и из уже занесённых расчётов.
 *
 *  1. grade (вид/описание) у позиций и лотов, где он пуст: описание лота из УПД / расчёта
 *     (совпадение по номеру лота И количеству, «то же» = предыдущая строка документа).
 *  2. grade из furDescription расчёта (costPlan / lot.costBreakdown), если описания в документах нет.
 *  3. color (цвет) из описания — только если в тексте ровно один цветовой признак.
 *  4. Подкладка Спец. 13: статьи расчёта за 1 м.п. из «предварительный_расчет_за_подкладку.xlsx» (Drive 1DIfQOowRD_mCYAtjEe-QwdNhtIcIHkhi)
 *     дописываются в costPlan.costBreakdown.items (итоговая цена 4500 ₽/м.п. по спецификации не меняется).
 *  5. Purchase.expectedDate для СП 09-26: «срок поставки 30.12.2026» (ПРИЛОЖЕНИЕ 20 (СП09-26).docx).
 *
 * Ничего не перезаписывает: меняются только пустые поля. Идемпотентно.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/fill-detail-lots.ts             # пробный прогон (по умолчанию)
 *   node --env-file=.env node_modules/.bin/tsx scripts/fill-detail-lots.ts --apply     # применить (перед этим scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/fill-detail-lots.ts --rollback  # откат по журналу
 *
 * Журнал: docs-inventory/corrections-journal-detail-lots.json
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, loadPurchaseExtracts, docSessions, resolveSameAs, colorFromText, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-detail-lots.json");

type Change = {
  entity: "PurchaseItem" | "RawMaterialLot" | "Purchase";
  // для field=costPlan old/new — JSON-строки
  id: string;
  ref: string;
  field: string;
  old: string | null;
  new: string;
  source: string;
};

// «ЦУМ Ткань Турция», расчёт за 1 м.п. (значения как в файле; валюта «39,75» в файле не указана)
const LINING13_CALC = [
  { label: "Цена за 1 м.п. (базовая, валюта в файле не указана)", value: 39.75 },
  { label: "Оплата через карго 1,5%", value: 0.59625 },
  { label: "Доставка через карго", value: 1.61 },
  { label: "Наличные 10%", value: 4.195625 },
  { label: "Курс покупки наличной валюты", value: 76.9 },
  { label: "Доставка до склада", value: 0.065019506 },
  { label: "Цена за м.п. в ₽ без НДС (расчёт)", value: 3554.079188 },
  { label: "НДС 22% (цена с НДС по расчёту), ₽", value: 4335.976609 },
  { label: "Комиссия 4,5%, ₽", value: 159.9335634 },
  { label: "Итого по расчёту за 1 м.п., ₽ (в спецификации округлено до 4500)", value: 4495.910172 },
];

// jsonb возвращает ключи в своём порядке — сравниваем в каноническом виде
const canon = (v: any): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

const EXPECTED_SP0926 = new Date("2026-12-30T00:00:00.000Z");

async function rollback() {
  const j = readJson<{ changes: Change[]; rolledBack?: boolean }>(JOURNAL, { changes: [] });
  if (!j.changes.length) return console.log("Журнал пуст — откатывать нечего.");
  let done = 0;
  let skipped = 0;
  for (const c of j.changes) {
    const cur: any =
      c.entity === "PurchaseItem"
        ? await prisma.purchaseItem.findUnique({ where: { id: c.id } })
        : c.entity === "RawMaterialLot"
          ? await prisma.rawMaterialLot.findUnique({ where: { id: c.id } })
          : await prisma.purchase.findUnique({ where: { id: c.id } });
    if (!cur) { skipped++; continue; }
    const curVal = c.field === "expectedDate" ? cur.expectedDate?.toISOString() ?? null : c.field === "costPlan" ? canon(cur.costPlan) : cur[c.field];
    if (curVal !== (c.field === "costPlan" ? canon(JSON.parse(c.new)) : c.new)) { skipped++; continue; } // изменено после нас — не трогаем
    const data: any = { [c.field]: c.field === "expectedDate" ? (c.old ? new Date(c.old) : null) : c.field === "costPlan" ? JSON.parse(c.old as string) : c.old };
    if (c.entity === "PurchaseItem") await prisma.purchaseItem.update({ where: { id: c.id }, data });
    else if (c.entity === "RawMaterialLot") await prisma.rawMaterialLot.update({ where: { id: c.id }, data });
    else await prisma.purchase.update({ where: { id: c.id }, data });
    done++;
  }
  writeJson(JOURNAL, { ...j, changes: [], rolledBackAt: new Date().toISOString(), rolledBackCount: done });
  console.log(`Откат: восстановлено ${done}, пропущено (изменено позже) ${skipped}.`);
}

async function main() {
  if (ROLLBACK) return rollback();
  const org = await prisma.organization.findFirstOrThrow();
  const extracts = loadPurchaseExtracts().filter((d) => !d.duplicateOf && d.lots?.length);

  // lot+qty -> кандидаты описаний (приоритет УПД > прочие, затем более длинное)
  type Cand = { desc: string; docTitle: string; isUpd: boolean; sessions: string[] };
  const cands = new Map<string, Cand[]>();
  for (const d of extracts) {
    const isUpd = /упд|upd/i.test(`${d.docType} ${d.title}`);
    for (const l of resolveSameAs(d.lots!)) {
      if (!l.description || l.quantity == null) continue;
      const key = `${l.lot}|${l.quantity}`;
      (cands.get(key) ?? cands.set(key, []).get(key)!).push({ desc: l.description, docTitle: d.title, isUpd, sessions: docSessions(d) });
    }
  }

  const purchases = await prisma.purchase.findMany({
    where: { organizationId: org.id },
    include: { items: { include: { lot: true } } },
    orderBy: { number: "asc" },
  });

  const changes: Change[] = [];
  const skipped: string[] = [];

  for (const p of purchases) {
    for (const it of p.items) {
      const lotNo = it.lotNumber?.trim();
      let grade = it.grade;
      let gradeSource = "";
      if (!grade && lotNo) {
        const cs = (cands.get(`${lotNo}|${Number(it.quantity)}`) ?? []).filter(
          (c) => c.sessions.length === 0 || (p.auctionSession && c.sessions.includes(p.auctionSession))
        );
        if (cs.length) {
          cs.sort((a, b) => Number(b.isUpd) - Number(a.isUpd) || b.desc.length - a.desc.length);
          const best = cs[0];
          grade = best.desc;
          gradeSource = `описание лота ${lotNo} × ${Number(it.quantity)} в документе «${best.docTitle}»`;
        }
      }
      if (!grade) {
        const fd: string | undefined =
          (it.costPlan as any)?.costBreakdown?.furDescription ?? (it.lot?.costBreakdown as any)?.furDescription ?? undefined;
        if (fd) {
          grade = fd;
          gradeSource = "furDescription из расчётного листа закупки (costBreakdown)";
        }
      }
      if (grade && !it.grade) {
        changes.push({ entity: "PurchaseItem", id: it.id, ref: `${p.number}/${lotNo ?? it.id}`, field: "grade", old: null, new: grade, source: gradeSource });
      }
      if (grade && it.lot && !it.lot.grade) {
        changes.push({ entity: "RawMaterialLot", id: it.lot.id, ref: `${p.number}/${lotNo ?? it.lot.id}`, field: "grade", old: null, new: grade, source: gradeSource });
      }
      const text = grade ?? it.grade ?? it.lot?.grade ?? null;
      const color = colorFromText(text);
      if (color && !it.color) {
        changes.push({ entity: "PurchaseItem", id: it.id, ref: `${p.number}/${lotNo ?? it.id}`, field: "color", old: null, new: color, source: `цвет из описания «${text}»` });
      }
      if (color && it.lot && !it.lot.color) {
        changes.push({ entity: "RawMaterialLot", id: it.lot.id, ref: `${p.number}/${lotNo ?? it.lot.id}`, field: "color", old: null, new: color, source: `цвет из описания «${text}»` });
      }
      if (!grade) skipped.push(`${p.number}/${lotNo ?? "?"}: описания в документах нет`);
    }
    if (p.auctionSession === "Подкладка Спец. 13") {
      for (const it of p.items) {
        const cp: any = it.costPlan;
        const items: any[] = cp?.costBreakdown?.items ?? [];
        if (!cp || items.some((x) => /карго/i.test(String(x.label)))) continue;
        const next = { ...cp, costBreakdown: { ...cp.costBreakdown, items: [...LINING13_CALC, ...items], calcSource: "предварительный_расчет_за_подкладку.xlsx (Drive 1DIfQOowRD_mCYAtjEe-QwdNhtIcIHkhi), «ЦУМ Ткань Турция», расчёт за 1 м.п." } };
        changes.push({ entity: "PurchaseItem", id: it.id, ref: `${p.number}/${it.id}`, field: "costPlan", old: JSON.stringify(cp), new: JSON.stringify(next), source: "предварительный_расчет_за_подкладку.xlsx" });
      }
    }
    if (p.auctionSession === "СП 09-26" && !p.expectedDate) {
      changes.push({
        entity: "Purchase",
        id: p.id,
        ref: p.number,
        field: "expectedDate",
        old: null,
        new: EXPECTED_SP0926.toISOString(),
        source: "ПРИЛОЖЕНИЕ 20 (СП09-26).docx: «срок поставки 30.12.2026»",
      });
    }
  }

  const byField: Record<string, number> = {};
  for (const c of changes) byField[`${c.entity}.${c.field}`] = (byField[`${c.entity}.${c.field}`] ?? 0) + 1;
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN (ничего не записано) ==");
  console.log("Изменений:", changes.length, byField);
  for (const c of changes.slice(0, 14)) console.log(`  ${c.entity} ${c.ref} ${c.field}: «${c.new.slice(0, 90)}»`);
  const colorMap = new Set(changes.filter((c) => c.field === "color" && c.entity === "PurchaseItem").map((c) => `${c.new} <= ${c.source.replace("цвет из описания ", "")}`));
  console.log("Цвета (уникальные пары):\n  " + [...colorMap].sort().join("\n  "));
  console.log(`Позиций без описания в документах: ${skipped.length}`);

  if (!APPLY) return;
  const prev = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  const applied: Change[] = [];
  for (const c of changes) {
    if (c.entity === "PurchaseItem") await prisma.purchaseItem.update({ where: { id: c.id }, data: { [c.field]: c.field === "costPlan" ? JSON.parse(c.new) : c.new } });
    else if (c.entity === "RawMaterialLot") await prisma.rawMaterialLot.update({ where: { id: c.id }, data: { [c.field]: c.new } });
    else await prisma.purchase.update({ where: { id: c.id }, data: { expectedDate: new Date(c.new) } });
    applied.push(c);
    // пишем журнал по ходу, чтобы падение посреди скрипта не потеряло откат
    if (applied.length % 25 === 0) writeJson(JOURNAL, { script: "fill-detail-lots.ts", changes: [...prev.changes, ...applied] });
  }
  writeJson(JOURNAL, {
    script: "fill-detail-lots.ts",
    appliedAt: new Date().toISOString(),
    summary: byField,
    changes: [...prev.changes, ...applied],
    notFoundInDocuments: skipped,
  });
  console.log(`Применено ${applied.length}. Журнал: ${JOURNAL}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
