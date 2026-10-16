/**
 * Журнал движений склада по подкладке: приход З-2026-0061 записан на чужие лоты — 16.10.2026.
 *
 * Что нашли (read-only разбор): у 12 лотов подкладки «журнал ≠ остаток», причём ровно парами. В лотах пулов З-2026-0032 (LIN-191-0 и ещё
 * 4 без номера) и З-2026-0060 в журнале стоит лишний PURCHASE_IN от 24.08.2026 по цене 4 515 и с purchaseId закупки З-2026-0061, а в
 * соответствующих лотах З-2026-0061 (№2, 24, 27, 37, 38, 41) этого прихода в журнале нет, хотя «получено» и позиции закупки на месте.
 * Так остались движения после разнесения пулов по закупкам (split-lining-pool-lots): они не переехали вместе с лотами.
 *
 * Исправление: у каждого такого движения меняется ТОЛЬКО lotId — на лот З-2026-0061 того же материала и склада, где «получено» = количеству
 * движения и журнал не хватает именно этого прихода. Остаток лота, «получено», стоимость, позиции закупок, списания в ТЗ, остатки склада
 * по материалу, сверка и себестоимость не меняются (суммы по материалу те же). Новых движений нет, ничего не придумывается.
 * Если для движения нет ЕДИНСТВЕННОГО подходящего лота — оно не трогается и попадает в «Не исправлено».
 *
 *   TSX="node --conditions=react-server --env-file=.env node_modules/.bin/tsx"
 *   $TSX scripts/fix-lining-journal-2026-10-16.ts                    # пробный прогон: таблица лот → было → стало
 *   $TSX scripts/fix-lining-journal-2026-10-16.ts --apply [--live]   # записать (на боевую — сам делает bash scripts/backup.sh)
 *   $TSX scripts/fix-lining-journal-2026-10-16.ts --rollback --apply [--live]
 * Журнал отката: docs-inventory/fix-lining-journal-2026-10-16.json (id движения, прежний и новый lotId).
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const ACTOR = "script:fix-lining-journal";
const ROOT = join(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL = join(INV, "fix-lining-journal-2026-10-16.json");
const IN = ["PURCHASE_IN", "ADJUSTMENT_IN", "TRANSFER_IN"];
const N = (x: unknown) => Number(x ?? 0);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

type J = { script: string; status: "applied" | "rolled-back"; at: string; moves: { id: string; qty: number; from: string; to: string; fromLabel: string; toLabel: string }[] };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient(ACTOR);
  const url = process.env.DATABASE_URL ?? "";
  const isLive = /\/fur_erp(\?|$)/.test(url);
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  console.log(`База: ${/\/([^/?]+)(\?|$)/.exec(url)?.[1]}${isLive ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "исправление"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Это боевая база: нужен флаг --live (сам сделает бэкап). Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы перед записью: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); };

  if (ROLLBACK) {
    const j: J | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    console.log(`Откат: движений ${j.moves.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    for (const m of j.moves) console.log(`  ${m.id.slice(-8)} ${m.qty}: ${m.toLabel} → обратно ${m.fromLabel}`);
    if (APPLY) {
      if (isLive) backup();
      await prisma.$transaction(async (tx) => {
        for (const m of j.moves) {
          const cur = await tx.stockMovement.findUnique({ where: { id: m.id }, select: { lotId: true } });
          if (cur?.lotId !== m.to) throw new Error(`Движение ${m.id} уже не в лоте «${m.toLabel}» — откат остановлен, ничего не изменено`);
          await tx.stockMovement.update({ where: { id: m.id }, data: { lotId: m.from } });
        }
      });
      writeFileSync(JOURNAL, JSON.stringify({ ...j, status: "rolled-back", at: new Date().toISOString() }, null, 1));
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: org.id, rawMaterial: { unit: { not: "PIECE" } } },
    include: { rawMaterial: { select: { name: true } }, purchase: { select: { number: true } }, stockMovements: true, usages: { select: { quantity: true } } },
  });
  const label = (l: (typeof lots)[number]) => `${l.rawMaterial.name} · ${l.purchase?.number ?? "—"}${l.lotNumber ? " · " + l.lotNumber : ""}`;
  const gapOf = (l: (typeof lots)[number], moved: Map<string, string>) => {
    let inn = 0, out = 0;
    for (const m of l.stockMovements) { if (moved.get(m.id) && moved.get(m.id) !== l.id) continue; (IN.includes(m.type) ? (inn += N(m.quantity)) : (out += N(m.quantity))); }
    for (const [mid, to] of moved) if (to === l.id && !l.stockMovements.some((m) => m.id === mid)) inn += N(allMoves.get(mid)!.quantity);
    return { inn: r3(inn), out: r3(out), gap: r3(inn - out - N(l.quantityRemaining)) };
  };
  const allMoves = new Map(lots.flatMap((l) => l.stockMovements.map((m) => [m.id, m] as const)));
  const none = new Map<string, string>();
  const before = new Map(lots.map((l) => [l.id, gapOf(l, none)]));
  const bad = lots.filter((l) => Math.abs(before.get(l.id)!.gap) > 0.0005);
  console.log(`\nЛотов не штучных материалов: ${lots.length}; с расхождением «журнал ≠ остаток»: ${bad.length}`);

  const plan = new Map<string, string>(); // movementId -> новый lotId
  const unresolved: string[] = [];
  for (const l of bad.filter((x) => before.get(x.id)!.gap > 0.0005)) {
    for (const m of l.stockMovements.filter((x) => x.type === "PURCHASE_IN" && x.purchaseId && x.purchaseId !== l.purchaseId)) {
      const cands = lots.filter((t) => t.id !== l.id && t.rawMaterialId === l.rawMaterialId && t.warehouseId === l.warehouseId && t.purchaseId === m.purchaseId
        && Math.abs(N(t.quantityReceived) - N(m.quantity)) < 0.0005 && Math.abs(before.get(t.id)!.gap + N(m.quantity)) < 0.0005 && Math.abs(N(t.unitCost) - N(m.unitCost)) < 0.01);
      if (cands.length === 1) plan.set(m.id, cands[0].id);
      else if (cands.length > 1) unresolved.push(`${label(l)}: приход ${N(m.quantity)} от ${m.date.toISOString().slice(0, 10)} — подходящих лотов ${cands.length} (неоднозначно)`);
    }
  }

  const after = new Map(lots.map((l) => [l.id, gapOf(l, plan)]));
  console.log("\n## Лот → было → стало (журнал: приход − расход − остаток лота)");
  console.log("| лот | получено | остаток | журнал было (приход/расход) | расхождение было | журнал стало (приход/расход) | расхождение стало |\n|---|---|---|---|---|---|---|");
  for (const l of bad) { const b = before.get(l.id)!, a = after.get(l.id)!; console.log(`| ${label(l)} (${l.id.slice(-6)}) | ${N(l.quantityReceived)} | ${N(l.quantityRemaining)} | ${b.inn}/${b.out} | ${b.gap} | ${a.inn}/${a.out} | ${a.gap} |`); }
  console.log("\n## Переносимые движения (меняется только lotId)");
  for (const [mid, to] of plan) { const m = allMoves.get(mid)!; const from = lots.find((l) => l.stockMovements.some((x) => x.id === mid))!, t = lots.find((l) => l.id === to)!; console.log(`  ${mid.slice(-8)} PURCHASE_IN ${N(m.quantity)} м × ${N(m.unitCost)}: «${label(from)}» → «${label(t)}»`); }
  const still = lots.filter((l) => Math.abs(after.get(l.id)!.gap) > 0.0005);
  for (const l of still) unresolved.push(`${label(l)}: расхождение ${after.get(l.id)!.gap} м осталось — однозначного переноса нет (остаток не правим, решение за владельцем)`);
  if (unresolved.length) { console.log("\n## Не исправлено (нужно решение)"); unresolved.forEach((s) => console.log("  - " + s)); }
  console.log(`\nИтог: перенесено движений ${plan.size}; лотов с расхождением останется ${still.length}${still.length ? ": " + still.map(label).join("; ") : ""}`);
  // Инвариант: суммы журнала по материалу и остатки лотов не меняются
  const byMat = (m: Map<string, { inn: number; out: number; gap: number }>) => new Map([...new Set(lots.map((l) => l.rawMaterialId))].map((id) => [id, r3(lots.filter((l) => l.rawMaterialId === id).reduce((a, l) => a + m.get(l.id)!.inn - m.get(l.id)!.out, 0))]));
  const b1 = byMat(before), b2 = byMat(after);
  const same = [...b1].every(([k, v]) => b2.get(k) === v);
  console.log(`Инвариант: журнальный остаток по каждому материалу не изменился — ${same ? "да" : "НЕТ"}; остатки/получено/стоимость лотов скрипт не трогает.`);
  if (!same) { process.exitCode = 1; await prisma.$disconnect(); return; }

  const prev: J | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
  if (prev?.status === "applied" && APPLY) { console.log("Журнал уже содержит применённое исправление — сначала --rollback --apply."); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (на боевую ещё --live)."); await prisma.$disconnect(); return; }
  if (!plan.size) { console.log("Нечего исправлять."); await prisma.$disconnect(); return; }

  if (isLive) backup();
  const journal: J = { script: "fix-lining-journal-2026-10-16.ts", status: "applied", at: new Date().toISOString(), moves: [] };
  for (const [mid, to] of plan) {
    const from = lots.find((l) => l.stockMovements.some((x) => x.id === mid))!, t = lots.find((l) => l.id === to)!;
    journal.moves.push({ id: mid, qty: N(allMoves.get(mid)!.quantity), from: from.id, to, fromLabel: label(from), toLabel: label(t) });
  }
  mkdirSync(INV, { recursive: true });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // журнал — до записи: при сбое откат пропускает неприменённое
  await prisma.$transaction(async (tx) => { for (const m of journal.moves) await tx.stockMovement.update({ where: { id: m.id }, data: { lotId: m.to } }); });
  console.log(`Исправлено: движений ${journal.moves.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
