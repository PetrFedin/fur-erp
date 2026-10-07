/**
 * Решения владельца 08.10.2026 (часть 3). Только подтверждённое документами/решением владельца.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-decisions-3.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-decisions-3.ts --apply    # применить (до этого scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-decisions-3.ts --rollback # откат по журналу
 *
 *  1) Лоты 301023, 10022, 15898 (+позиции закупок) — «Чёрный».
 *  2) Лот 300687: материал «Соболь» -> «Норка» в одной транзакции (лот, позиция закупки, движения склада, списания ТЗ);
 *     до/после сверяется: остаток и стоимость лота, суммы по виду меха, общий остаток меха.
 *  3) Бобр «deep blue» (З-2026-0063) -> «Тёмно-синий» (+ псевдоним DEEP BLUE у цвета).
 *  4) Свакара 720502–720509, 728011, 728026: цвет лота = цвет ТЗ, если у всех ТЗ лота один цвет; иначе по документам лота.
 *  5) Новые цвета «Муссон» и «Тонировка 2512» (confirmed=true в смысле решения владельца, ColorRef.note) и привязка лотов/позиций.
 * verifiedAt не ставится, схема не меняется. Журнал: docs-inventory/corrections-journal-data-decisions-3.json (идемпотентно).
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-data-decisions-3.json");
const TAG = "[data-decisions-3 2026-10-08]";

type Basis = string;
type Change =
  | { kind: "refCreate"; id: string; name: string; data: Record<string, unknown> }
  | { kind: "refUpdate"; id: string; before: { aliases: string[]; note: string | null }; after: { aliases: string[]; note: string | null } }
  | { kind: "lot"; id: string; lot: string; basis: Basis; before: { color: string | null; colorRefId: string | null }; after: { color: string | null; colorRefId: string | null } }
  | { kind: "item"; id: string; basis: Basis; before: { color: string | null; colorRefId: string | null }; after: { color: string | null; colorRefId: string | null } }
  | { kind: "material"; lot: string; lotId: string; before: MatState; after: MatState };
type MatState = { rawMaterialId: string; lotGrade: string | null; itemGrades: Record<string, string | null>; itemIds: string[]; movementIds: string[]; usageIds: string[] };
type Journal = { script: string; appliedAt?: string; rolledBackAt?: string; changes: Change[] };

const LOTS_BLACK = ["301023", "10022", "15898"];
const LOTS_MUSSON = ["1378", "1384", "1385", "1386", "1388", "1390", "1397", "1400", "337", "343", "344", "346", "353"];
const LOTS_2512 = ["1422", "1423", "1425", "1426", "1437", "543", "549", "583", "588", "866", "867", "869", "872", "873", "874", "875", "877"];
const LOTS_SWAKARA = ["720502", "720503", "720504", "720505", "720506", "720507", "720508", "720509"];
/** Цвет шкуры по документам лота (реестр, отчёт 08.06.2026: SWAKARA WHITE; GR SKY / GR DARK). */
const DOC_COLOR: Record<string, { color: string; src: string }> = {
  ...Object.fromEntries(LOTS_SWAKARA.map((n) => [n, { color: "Белый", src: "реестр/отчёт 08.06.2026: SWAKARA WHITE (УПД 103 «крашенная»)" }])),
  "728011": { color: "Серый", src: "реестр: GR SKY/GR DARK (GR = grey); решение владельца «Серый»" },
  "728026": { color: "Серый", src: "реестр: GR SKY/GR DARK (GR = grey); решение владельца «Серый»" },
};
const NEW_GRADE_MINK = "Выделанная шкурка норки коричневой (SAGA 03-26, MINK BROWN M)";

type Snap = { remQty: number; remCost: number; rcvQty: number; totalCost: number; lots: number };
async function snapshot(): Promise<Record<string, Snap>> {
  const lots = await prisma.rawMaterialLot.findMany({ include: { rawMaterial: true } });
  const out: Record<string, Snap> = {};
  for (const l of lots) {
    const s = (out[l.rawMaterial.name] ??= { remQty: 0, remCost: 0, rcvQty: 0, totalCost: 0, lots: 0 });
    s.remQty += Number(l.quantityRemaining); s.remCost += Number(l.quantityRemaining) * Number(l.unitCost);
    s.rcvQty += Number(l.quantityReceived); s.totalCost += Number(l.totalCost); s.lots++;
  }
  return out;
}
const fmt = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FUR = ["Каракуль (свакара)", "Лиса", "Лиса красная", "Норка", "Соболь", "Бобр"];
function furTotals(s: Record<string, Snap>) {
  let q = 0, c = 0, t = 0;
  for (const n of FUR) if (s[n]) { q += s[n].remQty; c += s[n].remCost; t += s[n].totalCost; }
  return { q, c, t };
}
async function counts() {
  const [lc, ic, pur, lots, ord, pay] = await Promise.all([
    prisma.rawMaterialLot.count({ where: { colorRefId: { not: null } } }),
    prisma.purchaseItem.count({ where: { colorRefId: { not: null } } }),
    prisma.purchase.count(), prisma.rawMaterialLot.count(), prisma.productionOrder.count(), prisma.payment.count(),
  ]);
  return { lotsWithColor: lc, itemsWithColor: ic, purchases: pur, lots, orders: ord, payments: pay };
}

async function rollback() {
  const j = readJson<Journal | null>(JOURNAL, null);
  if (!j?.changes?.length) return console.log("Журнала нет или он пуст");
  await prisma.$transaction(async (tx) => {
    for (const c of [...j.changes].reverse()) {
      if (c.kind === "refCreate") {
        const used = await tx.rawMaterialLot.count({ where: { colorRefId: c.id } }) + await tx.purchaseItem.count({ where: { colorRefId: c.id } });
        if (used) throw new Error(`цвет ${c.name} ещё используется (${used}) — откат остановлен`);
        await tx.colorRef.delete({ where: { id: c.id } });
      } else if (c.kind === "refUpdate") await tx.colorRef.update({ where: { id: c.id }, data: c.before });
      else if (c.kind === "lot") await tx.rawMaterialLot.update({ where: { id: c.id }, data: c.before });
      else if (c.kind === "item") await tx.purchaseItem.update({ where: { id: c.id }, data: c.before });
      else {
        const b = c.before;
        await tx.rawMaterialLot.update({ where: { id: c.lotId }, data: { rawMaterialId: b.rawMaterialId, grade: b.lotGrade } });
        for (const id of b.itemIds) await tx.purchaseItem.update({ where: { id }, data: { rawMaterialId: b.rawMaterialId, grade: b.itemGrades[id] } });
        await tx.stockMovement.updateMany({ where: { id: { in: b.movementIds } }, data: { rawMaterialId: b.rawMaterialId } });
        await tx.productionMaterialUsage.updateMany({ where: { id: { in: b.usageIds } }, data: { rawMaterialId: b.rawMaterialId } });
      }
    }
  });
  console.log(`Откат: ${j.changes.length}`);
  writeJson(JOURNAL, { ...j, rolledBackAt: new Date().toISOString(), changes: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  const changes: Change[] = [];
  const skipped: string[] = [];
  const refs = await prisma.colorRef.findMany();
  const org = refs[0].organizationId;
  const newRefs: Record<string, { id: string; name: string }> = {};
  const ref = (n: string) => { const r = refs.find((x) => x.name === n) ?? newRefs[n]; if (!r) throw new Error(`нет цвета ${n}`); return r; };

  // 5a) новые цвета
  const NEW = [
    { name: "Муссон", aliases: ["муссон", "mussone", "mussons"], note: `Тонировка «муссон» соболя (реестр, лист «Реест затрат на сырье»); решение владельца 08.10.2026 — завести как цвет ${TAG}.` },
    { name: "Тонировка 2512", aliases: ["тонировка 2512", "tonirovka 2512", "2512"], note: `Тонировка по коду 2512 (реестр); расшифровки кода в документах нет; решение владельца 08.10.2026 — завести как цвет ${TAG}.` },
  ];
  for (const n of NEW) {
    const ex = refs.find((r) => r.name === n.name);
    if (ex) { newRefs[n.name] = ex; continue; }
    const id = `plan-${n.name}`;
    newRefs[n.name] = { id, name: n.name };
    changes.push({ kind: "refCreate", id, name: n.name, data: { organizationId: org, name: n.name, aliases: n.aliases, note: n.note } });
  }
  // 3a) псевдоним DEEP BLUE
  const navy = ref("Тёмно-синий") as unknown as { id: string; name: string; aliases: string[]; note: string | null };
  if (!navy.aliases.some((a: string) => a.toLowerCase() === "deep blue")) {
    changes.push({ kind: "refUpdate", id: navy.id, before: { aliases: navy.aliases, note: navy.note }, after: { aliases: [...navy.aliases, "DEEP BLUE", "deep blue"], note: navy.note } });
  }

  const lots = await prisma.rawMaterialLot.findMany({ include: { rawMaterial: true, purchaseItems: true } });
  const byNum = (n: string) => lots.filter((l) => l.lotNumber === n || (l.lotNumber ?? "").startsWith(`${n}-`));
  const itemDone = new Set<string>();
  const setColor = (l: (typeof lots)[number], colorName: string, basis: Basis, force: boolean) => {
    const r = ref(colorName);
    if (l.colorRefId !== r.id || l.color !== r.name) changes.push({ kind: "lot", id: l.id, lot: l.lotNumber ?? l.id, basis, before: { color: l.color, colorRefId: l.colorRefId }, after: { color: r.name, colorRefId: r.id } });
    for (const it of l.purchaseItems) {
      if (itemDone.has(it.id) || l.rawMaterial.unit === "M") continue;
      if (!force && it.colorRefId) continue;
      if (it.colorRefId === r.id && it.color === r.name) continue;
      itemDone.add(it.id);
      changes.push({ kind: "item", id: it.id, basis, before: { color: it.color, colorRefId: it.colorRefId }, after: { color: r.name, colorRefId: r.id } });
    }
  };

  // 1) чёрный
  for (const n of LOTS_BLACK) {
    const f = byNum(n);
    if (!f.length) skipped.push(`${n}: лота нет`);
    for (const l of f) setColor(l, "Чёрный", `решение владельца: лот 301023 «браун краш. в чёрный» -> «Чёрный», связанные 10022 и 15898 тоже; было «${l.color ?? "—"}»`, true);
  }

  // 4) свакара — по ТЗ или по документам
  const usage = await prisma.productionMaterialUsage.findMany({
    where: { lot: { lotNumber: { in: [...LOTS_SWAKARA, "728011", "728026"] } } },
    include: { lot: true, productionOrder: { include: { colors: { include: { colorRef: true } }, colorRef: true } } },
  });
  for (const n of [...LOTS_SWAKARA, "728011", "728026"]) {
    const f = byNum(n);
    if (!f.length) { skipped.push(`${n}: лота нет`); continue; }
    for (const l of f) {
      const tzs = usage.filter((u) => u.lotId === l.id).map((u) => u.productionOrder);
      const perTz = new Map<string, string>();
      for (const o of tzs) {
        const cs = o.colors.length ? o.colors.map((c) => c.colorRef.name) : o.colorRef ? [o.colorRef.name] : o.color ? [o.color] : [];
        if (cs.length) perTz.set(o.workOrderNumber ?? o.number, [...new Set(cs)].sort().join("+"));
      }
      const distinct = [...new Set(perTz.values())];
      const tzTxt = [...perTz].map(([k, v]) => `ТЗ ${k}: ${v}`).join("; ");
      const doc = DOC_COLOR[n];
      let color: string, basis: string;
      if (!doc.src.includes("решение владельца") && distinct.length === 1 && !distinct[0].includes("+")) { color = distinct[0]; basis = `все ТЗ лота одного цвета (${tzTxt})`; }
      else {
        color = doc.color;
        basis = `${perTz.size ? `ТЗ разных цветов или цвет изделия не равен цвету шкуры (${tzTxt}); ` : "лот в ТЗ не использован; "}цвет по документам лота: ${doc.src}`;
      }
      setColor(l, color, basis, false);
    }
  }

  // 5b) муссон / 2512
  for (const [nums, cname] of [[LOTS_MUSSON, "Муссон"], [LOTS_2512, "Тонировка 2512"]] as const) {
    for (const n of nums) {
      const f = byNum(n);
      if (!f.length) { skipped.push(`${n}: лота нет`); continue; }
      for (const l of f) {
        if (l.colorRefId && l.color !== cname) { skipped.push(`${l.lotNumber}: уже цвет «${l.color}»`); continue; }
        setColor(l, cname, `решение владельца 08.10.2026: тонировка «${cname}» заведена как цвет; реестр «Соболь дикий выделанный (${cname === "Муссон" ? "муссон" : "тонировка 2512"}), лот ${n}»`, false);
      }
    }
  }

  // 3b) бобр deep blue
  const beaver = await prisma.purchaseItem.findMany({ where: { purchase: { number: "З-2026-0063" }, color: { in: ["deep blue", "Deep blue", "DEEP BLUE"] } } });
  for (const it of beaver) {
    if (it.colorRefId === navy.id) continue;
    changes.push({ kind: "item", id: it.id, basis: "решение владельца: «deep blue» = «Тёмно-синий» (инвойс 1-2026 от 06.08.2026, 162 шт.)", before: { color: it.color, colorRefId: it.colorRefId }, after: { color: navy.name, colorRefId: navy.id } });
  }

  // 2) материал лота 300687 -> Норка
  const mink = await prisma.rawMaterial.findFirstOrThrow({ where: { name: "Норка" } });
  for (const l of byNum("300687")) {
    if (l.rawMaterialId === mink.id) continue;
    const mv = await prisma.stockMovement.findMany({ where: { lotId: l.id }, select: { id: true } });
    const us = await prisma.productionMaterialUsage.findMany({ where: { lotId: l.id }, select: { id: true } });
    const itemIds = l.purchaseItems.map((i) => i.id);
    const before: MatState = { rawMaterialId: l.rawMaterialId, lotGrade: l.grade, itemGrades: Object.fromEntries(l.purchaseItems.map((i) => [i.id, i.grade])), itemIds, movementIds: mv.map((m) => m.id), usageIds: us.map((u) => u.id) };
    const after: MatState = { ...before, rawMaterialId: mink.id, lotGrade: NEW_GRADE_MINK, itemGrades: Object.fromEntries(itemIds.map((i) => [i, NEW_GRADE_MINK])) };
    changes.push({ kind: "material", lot: l.lotNumber ?? l.id, lotId: l.id, before, after });
  }

  const nOf = (k: Change["kind"]) => changes.filter((c) => c.kind === k).length;
  const bySrc = (basisPart: string) => changes.filter((c) => c.kind === "lot" && c.basis.includes(basisPart)).length;
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==");
  console.log(`новые цвета: ${nOf("refCreate")}; псевдонимы: ${nOf("refUpdate")}; лоты (цвет): ${nOf("lot")}; позиции закупок (цвет): ${nOf("item")}; смена материала: ${nOf("material")}`);
  console.log(`  чёрный: ${bySrc("лот 301023")}; муссон: ${bySrc("«Муссон»")}; 2512: ${bySrc("«Тонировка 2512»")}; свакара/728: ${changes.filter((c) => c.kind === "lot" && (/^72(05|80)/.test(c.lot) || c.lot.startsWith("728"))).length}`);
  if (skipped.length) console.log("пропущено:\n  " + skipped.join("\n  "));
  if (process.argv.includes("--list")) for (const c of changes) if (c.kind === "lot") console.log("lot", c.lot, "->", c.after.color, "|", c.basis.slice(0, 200));

  const before = await snapshot(), cb = await counts();
  const fb = furTotals(before);
  console.log("ДО: ", JSON.stringify(cb), `мех: остаток ${fb.q} шт / ${fmt(fb.c)} ₽; стоимость полученного ${fmt(fb.t)} ₽; Соболь ${before["Соболь"]?.remQty} шт/${fmt(before["Соболь"]?.remCost)}; Норка ${before["Норка"]?.remQty} шт/${fmt(before["Норка"]?.remCost)}`);
  if (!APPLY) return;

  const prev = readJson<Journal>(JOURNAL, { script: "apply-data-decisions-3.ts", changes: [] });
  const done: Change[] = [];
  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.kind === "refCreate") {
        const created = await tx.colorRef.create({ data: c.data as never });
        // подставляем реальный id во все последующие изменения
        for (const x of changes) if (x.kind === "lot" || x.kind === "item") if (x.after.colorRefId === c.id) x.after.colorRefId = created.id;
        c.id = created.id;
      } else if (c.kind === "refUpdate") await tx.colorRef.update({ where: { id: c.id }, data: c.after });
      else if (c.kind === "lot") await tx.rawMaterialLot.update({ where: { id: c.id }, data: c.after });
      else if (c.kind === "item") await tx.purchaseItem.update({ where: { id: c.id }, data: c.after });
      else {
        const a = c.after;
        await tx.rawMaterialLot.update({ where: { id: c.lotId }, data: { rawMaterialId: a.rawMaterialId, grade: a.lotGrade } });
        for (const id of a.itemIds) await tx.purchaseItem.update({ where: { id }, data: { rawMaterialId: a.rawMaterialId, grade: a.itemGrades[id] } });
        await tx.stockMovement.updateMany({ where: { id: { in: a.movementIds } }, data: { rawMaterialId: a.rawMaterialId } });
        await tx.productionMaterialUsage.updateMany({ where: { id: { in: a.usageIds } }, data: { rawMaterialId: a.rawMaterialId } });
      }
      done.push(c);
    }
    // сверка внутри транзакции: ошибка = откат всего
    const lotsAfter = await tx.rawMaterialLot.findMany({ include: { rawMaterial: true } });
    let q = 0, cst = 0;
    for (const l of lotsAfter) if (FUR.includes(l.rawMaterial.name)) { q += Number(l.quantityRemaining); cst += Number(l.quantityRemaining) * Number(l.unitCost); }
    if (Math.abs(q - fb.q) > 0.001 || Math.abs(cst - fb.c) > 0.01) throw new Error(`сверка остатка меха не сошлась: ${q}/${cst} против ${fb.q}/${fb.c}`);
    const n = await tx.rawMaterialLot.count();
    if (n !== cb.lots) throw new Error("число лотов изменилось");
  }, { timeout: 120000 });
  writeJson(JOURNAL, { script: "apply-data-decisions-3.ts", appliedAt: new Date().toISOString(), changes: [...prev.changes, ...done] });
  const after = await snapshot(), ca = await counts(), fa = furTotals(after);
  console.log("Применено:", done.length);
  console.log("ПОСЛЕ:", JSON.stringify(ca), `мех: остаток ${fa.q} шт / ${fmt(fa.c)} ₽; стоимость полученного ${fmt(fa.t)} ₽; Соболь ${after["Соболь"]?.remQty} шт/${fmt(after["Соболь"]?.remCost)}; Норка ${after["Норка"]?.remQty} шт/${fmt(after["Норка"]?.remCost)}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
