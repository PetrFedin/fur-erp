// Бюджет FW27: примерная оценка (курсив, поле est) для новых позиций из «MVST W FURS ACC - Budget PCS FW27» (27.10): Лиса · Шапка меховая (100 шт.)
// и Лиса · Капюшон (10 шт.). Лисьих шапок и капюшонов в данных системы нет, поэтому по аналогам (как apply-budget-fw27-estimates-2026-10-26):
// шкур — как у лисьих варежек/муфт (1 шк.), цена шкуры — как у лисьих шарфов, работа — как у норковой шапки / норкового капюшона.
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-budget-fw27-fox-acc-est-2026-10-30.ts [--write]
import { PrismaClient } from "@prisma/client";

(async () => {
  const prisma = new PrismaClient();
  const row = await prisma.budgetScenario.findFirst({ where: { name: "FW27" } });
  if (!row) throw new Error("нет FW27");
  const nodes = (row.lines as any[]).map((n) => ({ ...n }));
  const fur = (name: string) => nodes.find((n) => n.kind === "fur" && n.name === name);
  const cat = (f: string, c: string) => nodes.find((n) => n.kind === "cat" && n.name === c && n.parentId === fur(f)?.id);
  const foxScarf = cat("Лиса", "Шарфы"), foxMitt = cat("Лиса", "Манжеты, муфты, варежки");
  const set = (c: string, workFrom: any, note: string) => {
    const n = cat("Лиса", c); if (!n) throw new Error(`нет Лиса · ${c}`);
    if (n.base) { console.log("пропуск: есть данные системы", c); return; }
    Object.assign(n, { hides: foxMitt.hides, hidePrice: Math.round(foxScarf.hidePrice), meters: 0, meterPrice: 0, work: Math.round(workFrom.work), est: note, src: "none", locked: false });
    console.log(`Лиса · ${c}: ${n.pcs} шт. × (${n.hides} шк. × ${n.hidePrice} + работа ${n.work}) ≈ ${Math.round(n.pcs * (n.hides * n.hidePrice + n.work) * 1.04 / 1000)} тыс. ₽`);
  };
  set("Шапка меховая", cat("Норка", "Шапка меховая"), "по аналогу: 1 шк. как у лисьих варежек, цена шкуры — как у лисьих шарфов, работа — как у норковой шапки; данных системы нет");
  set("Капюшон", cat("Норка", "Капюшон"), "по аналогу: 1 шк. как у лисьих варежек, цена шкуры — как у лисьих шарфов, работа — как у норкового капюшона; данных системы нет");
  if (process.argv.includes("--write")) { await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: nodes as never } }); console.log("ЗАПИСАНО"); }
  process.exit(0);
})();
