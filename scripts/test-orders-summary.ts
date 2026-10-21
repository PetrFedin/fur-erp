// «Заказ и приход» на Главной: сводка по сезонам из листа Report файла «отчет по товарам фото и цены.xlsx».
// Правило владельца: FW25 и SS26 — ничего не ждём (заказано = поступило), FW26 — заказано = Conf, ждём = Conf − поступило.
// Без файла в Загрузках проверки пропускаются.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-orders-summary.ts
import "./stubs/server-only-shim";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FILE = join(homedir(), "Downloads", "отчет по товарам фото и цены.xlsx");
let fails = 0;
const eq = (what: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? "ОК " : "НЕТ"} ${what}: ${JSON.stringify(got)}${ok ? "" : ` (ожидалось ${JSON.stringify(want)})`}`); };

async function main() {
  const { ordersSummary } = await import("../src/app/(app)/dashboard/sales-block-data");
  const { classOfLevel2 } = await import("../src/lib/sales-receipts-core");
  const REC = [{ season: "FW 25/26", received: 5 }, { season: "SS 2026", received: 2 }, { season: "FW 26/27", received: 3 }];
  eq("нет полей сезонов → сводки нет", ordersSummary([{ acode: "A", color: "X", size: "42", modelCode: null, cls: "clothes", deliv: 1, sold: 0, stock: 1, nsRub: 0, nsRubEx: 0, conf: 2 }], "all", REC), null);
  const syn = [
    { acode: "A", color: "X", size: "42", modelCode: "A", cls: "clothes" as const, deliv: 7, sold: 0, stock: 7, nsRub: 0, nsRubEx: 0, conf: 10, fw26Conf: 4, fw26Deliv: 1, ss26Deliv: 2, fw25Deliv: 3 },
    { acode: "B", color: "X", size: "-", modelCode: "B", cls: "acc" as const, deliv: 3, sold: 0, stock: 3, nsRub: 0, nsRubEx: 0, conf: 3, fw26Conf: 0, fw26Deliv: 0, ss26Deliv: 0, fw25Deliv: 2 },
  ];
  const s = ordersSummary(syn, "all", REC)!;
  eq("синтетика: нет строки «прежние сезоны»", s.lines.map((l) => l.label), ["FW 25/26", "SS 2026", "FW 26/27"]);
  eq("синтетика: FW25 заказано = пришло", s.lines[0], { key: "FW 25/26", label: "FW 25/26", ordered: 5, delivered: 5, awaiting: 0 });
  eq("синтетика: FW26 заказано = пришло + ждём", s.lines[2], { key: "FW 26/27", label: "FW 26/27", ordered: 6, delivered: 3, awaiting: 3 });
  eq("синтетика: Всего", [s.total.ordered, s.total.delivered, s.total.awaiting], [13, 10, 3]);

  if (!existsSync(FILE)) { console.log("Файла отчёта нет — проверки по файлу пропущены."); process.exitCode = fails ? 1 : 0; return; }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets.find((w) => w.name === "Report")!;
  const num = (v: unknown) => { const x = v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v; return x == null || x === "" ? 0 : Number(x); };
  const rows: Parameters<typeof ordersSummary>[0] = [];
  ws.eachRow((row, rn) => {
    if (rn < 14) return;
    const v = (row.values as unknown[]).slice(1);
    if (v[6] === "Total" || v[2] !== 1 || !v[7]) return;
    rows.push({ acode: String(v[7]), color: String(v[17] ?? ""), size: String(v[14] ?? ""), modelCode: null, cls: classOfLevel2(String(v[10] ?? "")), deliv: num(v[20]), sold: num(v[28]), stock: num(v[31]), nsRub: 0, nsRubEx: 0, conf: num(v[18]), fw26Conf: num(v[38]), fw26Deliv: num(v[40]), ss26Deliv: num(v[71]), fw25Deliv: num(v[100]) });
  });
  const REAL = [{ season: "FW 25/26", received: 265 }, { season: "SS 2026", received: 92 }, { season: "FW 26/27", received: 260 }]; // как в плитке «Получено» (617)
  const f = ordersSummary(rows, "all", REAL)!;
  eq("отчёт: пришло всего (= «Получено» 617)", f.total.delivered, 617);
  eq("отчёт: FW 26/27 заказано / пришло / ждём (= Conf 470)", [f.lines[2].ordered, f.lines[2].delivered, f.lines[2].awaiting], [470, 260, 210]);
  eq("отчёт: FW25 и SS26 ждать нечего", [f.lines[0].awaiting, f.lines[1].awaiting], [0, 0]);
  eq("отчёт: общий заказ = 617 + 210", f.total.ordered, 827);
  eq("отчёт: ждём всего", f.total.awaiting, 210);
  eq("отчёт: Conf отчёта целиком", f.confReport, 832);
  const c = ordersSummary(rows, "clothes", [{ season: "FW 25/26", received: 164 }, { season: "SS 2026", received: 4 }, { season: "FW 26/27", received: 123 }])!, a = ordersSummary(rows, "acc", [{ season: "FW 25/26", received: 101 }, { season: "SS 2026", received: 88 }, { season: "FW 26/27", received: 137 }])!;
  eq("отчёт: Одежда + Аксессуары = Тотал (заказано/пришло/ждём)", [c.total.ordered + a.total.ordered, c.total.delivered + a.total.delivered, c.total.awaiting + a.total.awaiting], [f.total.ordered, f.total.delivered, f.total.awaiting]);
  console.log(`Одежда: заказано ${c.total.ordered}, пришло ${c.total.delivered}, ждём ${c.total.awaiting}; Аксессуары: заказано ${a.total.ordered}, пришло ${a.total.delivered}, ждём ${a.total.awaiting}`);
  console.log(fails ? `ПРОВАЛОВ: ${fails}` : "Все проверки пройдены");
  process.exitCode = fails ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
