/**
 * Справочник меха (FurRef): засев из реально встречающихся названий + сверка охвата.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-fur-refs.ts            # пробный прогон (в базу ничего не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-fur-refs.ts --apply    # применить (после scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-fur-refs.ts --rollback # откат по журналу
 *
 * Что делает: создаёт виды меха из src/lib/fur-ref.ts (SEED_FURS: Соболь/Sable, Норка/Mink, Каракуль (свакара)/Karakul (Swakara),
 * Лиса/Fox, Рысь/Lynx, Бобр/Beaver) — английские названия только общепринятые однозначные; существующим видам добавляет
 * недостающие синонимы. Лоты, позиции закупок и ТЗ в базе НЕ меняются (вид меха определяется по справочнику на лету).
 * Печатает охват: сколько материалов/лотов/позиций/ТЗ сопоставлено и что не нашлось.
 * Журнал: docs-inventory/corrections-journal-fur-refs.json
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { SEED_FURS, buildFurIndex, furKey, matchFurRef } from "../src/lib/fur-ref";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-fur-refs.json");

type Change =
  | { kind: "create"; id: string; name: string }
  | { kind: "aliases"; id: string; name: string; old: string[]; new: string[]; oldNameEn: string | null; newNameEn: string | null };

async function rollback() {
  const j = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  let done = 0;
  let skipped = 0;
  for (const c of [...j.changes].reverse()) {
    const cur = await prisma.furRef.findUnique({ where: { id: c.id } });
    if (!cur) { skipped++; continue; }
    if (c.kind === "create") {
      const a = SEED_FURS.find((s) => s.name === c.name);
      const untouched = a && JSON.stringify(cur.aliases) === JSON.stringify(a.aliases) && cur.nameEn === a.nameEn;
      if (!untouched) { skipped++; console.log(`  «${cur.name}» оставлен: правился вручную после засева`); continue; }
      await prisma.furRef.delete({ where: { id: c.id } });
    } else {
      if (JSON.stringify(cur.aliases) !== JSON.stringify(c.new)) { skipped++; continue; }
      await prisma.furRef.update({ where: { id: c.id }, data: { aliases: c.old, nameEn: c.oldNameEn } });
    }
    done++;
  }
  console.log(`Откат: ${done} шагов, пропущено ${skipped}`);
  writeJson(JOURNAL, { script: "seed-fur-refs.ts", rolledBackAt: new Date().toISOString(), changes: [] });
}

async function main() {
  if (ROLLBACK) return rollback();
  const orgs = await prisma.organization.findMany();
  const changes: Change[] = [];
  for (const org of orgs) {
    const existing = await prisma.furRef.findMany({ where: { organizationId: org.id } });
    for (const s of SEED_FURS) {
      const have = existing.find((r) => furKey(r.name) === furKey(s.name));
      if (!have) {
        console.log(`  + ${org.name}: ${s.name} / ${s.nameEn} (синонимов ${s.aliases.length})`);
        if (APPLY) {
          const c = await prisma.furRef.create({ data: { organizationId: org.id, name: s.name, nameEn: s.nameEn, aliases: s.aliases } });
          changes.push({ kind: "create", id: c.id, name: s.name });
        } else changes.push({ kind: "create", id: "(новая)", name: s.name });
        continue;
      }
      const have2 = new Set([have.name, have.nameEn ?? "", ...have.aliases].map(furKey));
      const add = s.aliases.filter((a) => !have2.has(furKey(a)));
      const nameEn = have.nameEn ?? s.nameEn;
      if (add.length || nameEn !== have.nameEn) {
        console.log(`  ~ ${org.name}: ${have.name}: добавить синонимы [${add.join(", ")}]${nameEn !== have.nameEn ? `, англ. «${nameEn}»` : ""}`);
        if (APPLY) await prisma.furRef.update({ where: { id: have.id }, data: { aliases: [...have.aliases, ...add], nameEn } });
        changes.push({ kind: "aliases", id: have.id, name: have.name, old: have.aliases, new: [...have.aliases, ...add], oldNameEn: have.nameEn, newNameEn: nameEn });
      }
    }

    // Охват по справочнику (после засева — по базе, до него — по встроенному набору; результат одинаков).
    const refs = APPLY ? await prisma.furRef.findMany({ where: { organizationId: org.id } }) : [];
    const idx = APPLY ? buildFurIndex(refs) : undefined;
    const mats = await prisma.rawMaterial.findMany({ where: { organizationId: org.id, unit: { not: "M" } }, select: { id: true, name: true, _count: { select: { lots: true } } } });
    const per = new Map<string, { m: number; lots: number; orders: number }>();
    const bump = (n: string, k: "m" | "lots" | "orders", by = 1) => per.set(n, { ...(per.get(n) ?? { m: 0, lots: 0, orders: 0 }), [k]: (per.get(n)?.[k] ?? 0) + by });
    const unM: string[] = [];
    for (const m of mats) {
      const r = matchFurRef(m.name, idx);
      if (r) { bump(r.name, "m"); bump(r.name, "lots", m._count.lots); } else unM.push(`${m.name} (лотов ${m._count.lots})`);
    }
    const orders = await prisma.productionOrder.findMany({ where: { organizationId: org.id, status: { not: "CANCELLED" } }, select: { materialDescription: true, productModel: { select: { category: true, name: true } } } });
    const unO = new Map<string, number>();
    let okO = 0;
    for (const o of orders) {
      const r = matchFurRef(o.materialDescription, idx) ?? matchFurRef(o.productModel.category, idx) ?? matchFurRef(o.productModel.name, idx);
      if (r) { bump(r.name, "orders"); okO++; } else {
        const t = ((o.materialDescription ?? "").trim() || (o.productModel.category ?? "").trim() || "(пусто)").replace(/\s+/g, " ").toLowerCase();
        unO.set(t, (unO.get(t) ?? 0) + 1);
      }
    }
    console.log(`Организация ${org.name}: видов меха ${per.size}; материалов-меха ${mats.length - unM.length} из ${mats.length}; ТЗ сопоставлено ${okO} из ${orders.length}`);
    for (const [n, v] of per) console.log(`   ${n}: материалов ${v.m}, лотов ${v.lots}, ТЗ ${v.orders}`);
    console.log(`   Не сопоставлено материалов: ${unM.join("; ") || "—"}`);
    console.log(`   Не сопоставлено ТЗ: ${Array.from(unO, ([t, n]) => `${t} ×${n}`).join("; ") || "—"}`);
  }
  if (APPLY) {
    const prev = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
    writeJson(JOURNAL, { script: "seed-fur-refs.ts", appliedAt: new Date().toISOString(), changes: [...prev.changes, ...changes] });
    console.log(`Применено. Журнал: ${JOURNAL}`);
  } else console.log("Пробный прогон: в базу ничего не записано. Для записи добавьте --apply (после scripts/backup.sh).");
}

main().finally(() => prisma.$disconnect());
