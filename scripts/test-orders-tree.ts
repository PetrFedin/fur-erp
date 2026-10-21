// «Заказ и приход»: разворот сезонов на тип меха / категории (деревья в SalesBlock.orderSummary). Живую БД только читаем.
// Размерные строки с категориями (l2–l5) берутся из листа Report файла «отчет по товарам фото и цены.xlsx» (как их вносит
// scripts/apply-report-orders-2026-10-21.ts). Без файла — проверки пропускаются.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-orders-tree.ts
import "./stubs/server-only-shim";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const FILE = join(homedir(), "Downloads", "отчет по товарам фото и цены.xlsx");
const prisma = new PrismaClient();
let fails = 0;
const ok = (what: string, cond: boolean, extra = "") => { if (!cond) fails++; console.log(`${cond ? "ОК " : "НЕТ"} ${what}${extra ? " — " + extra : ""}`); };

async function main() {
  if (!existsSync(FILE)) { console.log("Файла отчёта нет — проверки пропущены."); return; }
  const { loadSalesInput } = await import("../src/lib/sales-server");
  const { buildSalesBlock } = await import("../src/app/(app)/dashboard/sales-block-data");
  type Block = ReturnType<typeof buildSalesBlock>;
  const { classOfLevel2, modelCodeOfArticle } = await import("../src/lib/sales-receipts-core");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const data = await loadSalesInput(org, "off");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets.find((w) => w.name === "Report")!;
  const num = (v: unknown) => { const x = v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v; return x == null || x === "" ? 0 : Number(x); };
  const sizes: Parameters<typeof buildSalesBlock>[2] = [];
  ws.eachRow((row, rn) => {
    if (rn < 14) return;
    const v = (row.values as unknown[]).slice(1);
    if (v[6] === "Total" || v[2] !== 1 || !v[7]) return;
    sizes.push({ acode: String(v[7]), color: String(v[17] ?? ""), size: String(v[14] ?? ""), modelCode: modelCodeOfArticle(String(v[7])), cls: classOfLevel2(String(v[10] ?? "")), deliv: num(v[20]), sold: num(v[28]), stock: num(v[31]), nsRub: 0, nsRubEx: 0, conf: num(v[18]), fw26Conf: num(v[38]), fw26Deliv: num(v[40]), ss26Deliv: num(v[71]), fw25Deliv: num(v[100]), l2: String(v[10] ?? ""), l3: String(v[11] ?? ""), l4: String(v[12] ?? ""), l5: String(v[13] ?? "") });
  });
  const b: Block = buildSalesBlock(data.input, "all", sizes, []);
  type N = { label: string; ordered: number; delivered: number; awaiting: number; orderedRub: { in: number }; deliveredRub: { in: number }; awaitingRub: { in: number }; children: N[] };
  const sum = (ns: N[], f: (n: N) => number) => ns.reduce((a, n) => a + f(n), 0);
  const near = (a: number, c: number) => Math.abs(a - c) < 0.5;
  for (const c of ["all", "clothes", "acc"] as const) {
    const os = b.orderSummary[c]!;
    for (const l of os.lines) {
      for (const h of ["fur", "cls"] as const) {
        const tree = (l.tree?.[h] ?? []) as N[];
        ok(`${c} ${l.key} ${h}: дерево есть`, tree.length > 0 || l.ordered === 0);
        ok(`${c} ${l.key} ${h}: Σ пришло по узлам = ${l.delivered}`, near(sum(tree, (n) => n.delivered), l.delivered), `${sum(tree, (n) => n.delivered)}`);
        ok(`${c} ${l.key} ${h}: Σ ждём по узлам = ${l.awaiting}`, near(sum(tree, (n) => n.awaiting), l.awaiting), `${sum(tree, (n) => n.awaiting)}`);
        ok(`${c} ${l.key} ${h}: Σ заказано = пришло + ждём`, near(sum(tree, (n) => n.ordered), l.ordered));
        ok(`${c} ${l.key} ${h}: Σ рублей «пришло» по узлам ≈ строке (с НДС)`, Math.abs(sum(tree, (n) => n.deliveredRub.in) - l.deliveredRub.in) < 1000, `${Math.round(sum(tree, (n) => n.deliveredRub.in))} / ${Math.round(l.deliveredRub.in)}`);
        const bad: string[] = [];
        const walk = (ns: N[], path: string) => { for (const n of ns) { if (n.children.length && !near(sum(n.children, (x) => x.ordered), n.ordered)) bad.push(path + "/" + n.label); walk(n.children, path + "/" + n.label); } };
        walk(tree, l.key);
        ok(`${c} ${l.key} ${h}: у каждого узла Σ детей = узел`, bad.length === 0, bad.slice(0, 3).join("; "));
      }
    }
  }

  // График при наведении на строку таблицы: помесячный ряд узла (series) сходится с самой строкой.
  type R = { label: string; received: number; sold: number; stock: number; series?: { r: number[]; s: number[]; st: number[] }; children: R[] };
  const sumA = (a: number[]) => a.reduce((x, y) => x + y, 0);
  let nodes = 0; const bad: string[] = [];
  for (const [sk, sl] of Object.entries(b.slices)) for (const c of ["all", "clothes", "acc"] as const) for (const h of ["fur", "cls"] as const) {
    const axisLen = sl.months[c].length;
    const walk = (rs: R[], path: string) => { for (const r of rs) { if (r.series) { nodes++; const okLen = r.series.r.length === axisLen; const okR = near(sumA(r.series.r), r.received), okS = near(sumA(r.series.s), r.sold), okSt = near(r.series.st[axisLen - 1] ?? 0, r.stock); if (!(okLen && okR && okS && okSt)) bad.push(`${sk}/${c}/${h}/${path}/${r.label}: ${okLen ? "" : "длина "}${okR ? "" : "получено " + sumA(r.series.r) + "≠" + r.received + " "}${okS ? "" : "продано " + sumA(r.series.s) + "≠" + r.sold + " "}${okSt ? "" : "остаток " + r.series.st[axisLen - 1] + "≠" + r.stock}`); } walk(r.children, path + "/" + r.label); } };
    walk(sl.views[c][h].rows as unknown as R[], "");
  }
  ok(`ряд при наведении: ${nodes} узлов, Σ получено/продано и остаток на конец сходятся со строкой`, bad.length === 0 && nodes > 0, bad.slice(0, 4).join(" | "));
  const t = b.orderSummary.all!.lines.find((l) => l.key === "FW 26/27")!.tree!.fur;
  console.log("FW 26/27, тип меха → кат. 1:", t.map((n) => `${n.label} ${n.ordered}/${n.delivered}/${n.awaiting}`).join(" · "));
  console.log(fails ? `ПРОВАЛОВ: ${fails}` : "Все проверки пройдены");
  process.exitCode = fails ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
