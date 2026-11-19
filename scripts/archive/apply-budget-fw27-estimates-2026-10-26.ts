// Бюджет FW27: очень примерные значения (курсив, поле est) для категорий, по которым нет данных системы.
// В интернете расхода шкур на эти изделия найти не удалось, поэтому берём аналоги: файл Budget PCS и соседние категории бюджета.
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-budget-fw27-estimates-2026-10-26.ts [--write]
import { PrismaClient } from "@prisma/client";

(async () => {
  const prisma = new PrismaClient();
  const row = await prisma.budgetScenario.findFirst({ where: { name: "FW27" } });
  if (!row) throw new Error("нет FW27");
  const nodes = (row.lines as any[]).map((n) => ({ ...n }));
  const fur = (name: string) => nodes.find((n) => n.kind === "fur" && n.name === name);
  const cat = (f: string, c: string) => nodes.find((n) => n.kind === "cat" && n.name === c && n.parentId === fur(f)?.id);
  const set = (f: string, c: string, v: { hides: number; hidePrice: number; meters?: number; meterPrice?: number; work: number }, note: string) => {
    const n = cat(f, c); if (!n) throw new Error(`нет ${f} · ${c}`);
    if (n.base) { console.log("пропуск: есть данные системы", f, c); return; }
    Object.assign(n, { hides: v.hides, hidePrice: Math.round(v.hidePrice), meters: v.meters ?? 0, meterPrice: Math.round(v.meterPrice ?? 0), work: Math.round(v.work), est: note, src: "none", locked: false });
    console.log(`${f} · ${c}: ${n.pcs} шт. × (${v.hides} шк. × ${Math.round(v.hidePrice)} + работа ${Math.round(v.work)}) ≈ ${Math.round(n.pcs * (v.hides * v.hidePrice + v.work) * 1.04 / 1000)} тыс. ₽`);
  };
  // Средняя цена шкуры соболя по категориям бюджета (взвешено шкурами).
  const sab = nodes.filter((n) => n.kind === "cat" && n.parentId === fur("Соболь")?.id && n.hides > 0 && n.hidePrice > 0 && !n.est);
  const sabPrice = sab.reduce((s, n) => s + n.hides * n.pcs * n.hidePrice, 0) / sab.reduce((s, n) => s + n.hides * n.pcs, 0);
  set("Соболь", "Накидки и пончо", { hides: 60, hidePrice: sabPrice, work: cat("Соболь", "Кардиган меховой")!.work },
    "60 шк./изд. из файла Budget PCS FW27; цена шкуры — среднее по соболю; работа — как у кардигана; подкладка не заложена");
  set("Лиса", "Манжеты, муфты, варежки", { hides: cat("Норка", "Манжеты, муфты, варежки")!.hides, hidePrice: cat("Лиса", "Шарфы")!.hidePrice, work: cat("Норка", "Манжеты, муфты, варежки")!.work },
    "по аналогу: шкур и работа как у норки (варежки/муфты), цена шкуры — как у лисьих шарфов; в интернете расход не найден");
  set("Каракульча", "Шапка меховая", { hides: Math.round(cat("Норка", "Шапка меховая")!.hides * 1.5 * 10) / 10, hidePrice: cat("Каракульча", "Куртки меховые")!.hidePrice, work: cat("Норка", "Шапка меховая")!.work },
    "по аналогу: шкур у норковой шапки ×1,5 (шкурки каракульчи мельче), цена шкуры — как у курток из каракульчи, работа — как у норковой шапки; в интернете расход не найден");
  if (process.argv.includes("--write")) { await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: nodes as never } }); console.log("ЗАПИСАНО"); }
  process.exit(0);
})();
