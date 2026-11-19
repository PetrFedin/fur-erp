/**
 * Одноразовый (04.11.2026): нормализация `fur` в сохранённом отчёте «заказ и продажи» (SystemState).
 * У 20 строк в файле в «Analog Code» повторён артикул (с «/») вместо вида меха — в БД ушло как есть.
 * Ставим вид меха из самого артикула тем же правилом, что furKeyOfReportRow (SABLE > MINK > FOX > SWAKARA > LYNX).
 * Сухой прогон: node --env-file=.env node_modules/.bin/tsx scripts/fix-report-fur-2026-11-04.ts
 * Применить:  ... --apply
 * Откат:      ... --rollback scripts/fix-report-fur-2026-11-04.journal.json
 */
import { prisma } from "@/lib/prisma";
import { SIZES_PREFIX } from "@/lib/import-keys";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const JOURNAL = "scripts/fix-report-fur-2026-11-04.journal.json";
const FUR: [RegExp, string][] = [[/SABLE/, "SABLE"], [/MINK/, "MINK"], [/FOX/, "FOX"], [/SWAKARA|KARAKUL|BROADTAIL/, "SWAKARA"], [/LYNX/, "LYNX"]];
const furOf = (acode: string) => FUR.find(([re]) => re.test(acode.toUpperCase()))?.[1] ?? null;

async function main() {
  const apply = process.argv.includes("--apply");
  const rollbackIdx = process.argv.indexOf("--rollback");
  const org = await prisma.organization.findFirstOrThrow();

  if (rollbackIdx >= 0) {
    const path = process.argv[rollbackIdx + 1];
    if (!existsSync(path)) throw new Error(`нет журнала ${path}`);
    const j = JSON.parse(readFileSync(path, "utf8")) as { key: string; before: { acode: string; color: string; size: string; fur: string }[] };
    const st = await prisma.systemState.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: j.key } } });
    const rows = (st.value as { rows: Record<string, unknown>[] }).rows;
    const back = new Map(j.before.map((b) => [`${b.acode}|${b.color}|${b.size}`, b.fur]));
    let n = 0;
    for (const r of rows) { const k = `${r.acode}|${r.color}|${r.size}`; if (back.has(k)) { r.fur = back.get(k); n++; } }
    await prisma.systemState.update({ where: { organizationId_key: { organizationId: org.id, key: j.key } }, data: { value: JSON.parse(JSON.stringify({ ...(st.value as object), rows })) } });
    console.log(`откат: вернули fur у ${n} строк в ${j.key}`);
    return;
  }

  // Текущая версия по указателю (или последняя по дате).
  const ptr = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: `${SIZES_PREFIX}current` } } });
  const key = (ptr?.value as { key?: string } | null)?.key ?? (await prisma.systemState.findMany({ where: { organizationId: org.id, key: { startsWith: SIZES_PREFIX } }, select: { key: true } })).map((x) => x.key).filter((k) => /\d{4}-\d{2}-\d{2}$/.test(k)).sort().pop();
  if (!key) throw new Error("нет версии отчёта");
  const st = await prisma.systemState.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key } } });
  const rows = (st.value as { rows: { acode: string; color: string; size: string; fur?: string }[] }).rows;

  const KNOWN = new Set(["SABLE", "MINK", "FOX", "SWAKARA", "LYNX", "BEAVER", "CHINCHILLA", "SABLE+MINK"]);
  const bad = rows.filter((r) => r.fur && !KNOWN.has(r.fur));
  console.log(`версия ${key}: строк ${rows.length}, с артикулом в fur: ${bad.length}`);
  const before = bad.map((r) => ({ acode: r.acode, color: r.color, size: r.size, fur: r.fur ?? "" }));
  const unmapped = bad.filter((r) => !furOf(r.acode));
  if (unmapped.length) console.log("не удалось определить мех:", unmapped.map((r) => r.acode));
  for (const r of bad) { const f = furOf(r.acode); console.log(` ${r.acode} · ${r.color} · ${r.size}: ${r.fur} → ${f ?? "?"}`); }
  if (!apply) { console.log("сухой прогон — добавьте --apply для записи"); return; }

  for (const r of bad) { const f = furOf(r.acode); if (f) r.fur = f; }
  await prisma.systemState.update({ where: { organizationId_key: { organizationId: org.id, key } }, data: { value: JSON.parse(JSON.stringify({ ...(st.value as object), rows })) } });
  writeFileSync(JOURNAL, JSON.stringify({ key, at: new Date().toISOString(), before }, null, 2));
  console.log(`записано: fur исправлен у ${bad.filter((r) => furOf(r.acode)).length} строк; журнал ${JOURNAL}`);
}
void main().finally(() => prisma.$disconnect());
