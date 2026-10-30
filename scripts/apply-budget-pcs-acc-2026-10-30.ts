// «Бюджет FW27 + статистика» (SystemState budget-pcs:fw27-mvst): штуки аксессуаров (блок Acc) по «2026-10-27 MVST W FURS ACC - Budget PCS FW27.pdf» (905 шт.).
// Статистика (st) в PDF та же, что в файле 22.10, — меняется только pcs. Прежние строки — в docs-inventory/budget-pcs-acc-before-2026-10-30.json.
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-budget-pcs-acc-2026-10-30.ts [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const NEW: Record<string, number> = {
  "Норка|Шапка меховая": 170, "Норка|Повязка меховая": 80, "Норка|Косынка": 35, "Норка|Берет": 30, "Норка|Капюшон": 20, "Норка|Шарфы": 65, "Норка|Манжеты, муфты, варежки": 40,
  "Соболь|Шапка меховая": 100, "Соболь|Повязка меховая": 30, "Соболь|Косынка": 5, "Соболь|Шарфы": 40, "Соболь|Манжеты, муфты, варежки": 20,
  "Лиса|Шапка меховая": 100, "Лиса|Капюшон": 10, "Лиса|Шарфы": 25, "Лиса|Манжеты, муфты, варежки": 10,
  "Норка+Соболь|Шапка меховая": 65, "Норка+Соболь|Косынка": 5, "Норка+Соболь|Манжеты, муфты, варежки": 10,
  "Каракульча|Шапка меховая": 30, "Рысь|Шапка меховая": 10, "Рысь|Шарфы": 5,
};
(async () => {
  const prisma = new PrismaClient();
  const st = await prisma.systemState.findFirstOrThrow({ where: { key: "budget-pcs:fw27-mvst" } });
  const v = st.value as any;
  const seen = new Set<string>(); let before = 0, after = 0;
  for (const r of v.rows) {
    if (r.block !== "Acc") continue;
    const k = `${r.fur}|${r.cat}`; const n = NEW[k] ?? 0; seen.add(k);
    before += r.pcs ?? 0; after += n;
    if ((r.pcs ?? 0) !== n) console.log(`${k.padEnd(40)} ${r.pcs ?? 0} → ${n}`);
  }
  const missing = Object.keys(NEW).filter((k) => !seen.has(k));
  if (missing.length) { console.log("НЕТ СТРОК В ФАЙЛЕ:", missing); process.exit(1); }
  console.log(`Аксессуары: ${before} → ${after} шт.`);
  if (process.argv.includes("--write")) {
    writeFileSync("docs-inventory/budget-pcs-acc-before-2026-10-30.json", JSON.stringify(st.value));
    for (const r of v.rows) if (r.block === "Acc") r.pcs = NEW[`${r.fur}|${r.cat}`] ?? 0;
    v.asOf = { ...v.asOf, Acc: "2026-10-27" }; v.updatedBy = "Claude (файл 27.10)";
    await prisma.systemState.update({ where: { id: st.id }, data: { value: v } });
    console.log("ЗАПИСАНО");
  }
  process.exit(0);
})();
