// Проверка расчёта поставщика на реальных файлах Веллмеха (m_research) и формул. Ничего не пишет.
import "./stubs/server-only-shim";
import { readFile } from "node:fs/promises";
import { parseTableFile } from "../src/lib/table-file";
import { calcAll, evalNum, payloadFromTable } from "../src/lib/supplier-calc";

const DIR = "/private/tmp/claude-501/-Users-petr-Documents-claude/d078d416-b2d7-4795-b3e7-4401793187b6/scratchpad/m_research/";
let bad = 0;
const ok = (name: string, got: number, want: number, tol = 0.02) => {
  const pass = Math.abs(got - want) <= tol;
  if (!pass) bad++;
  console.log(`${pass ? "OK " : "FAIL"} ${name}: ${got.toFixed(4)} (ожидалось ${want})`);
};
async function load(f: string) {
  const t = await parseTableFile(await readFile(DIR + f), f);
  const r = payloadFromTable(t);
  if ("error" in r) throw new Error(f + ": " + r.error);
  return r.payload;
}
(async () => {
  ok("evalNum", evalNum("(3,9+6)*1,156+250/91,89"), (3.9 + 6) * 1.156 + 250 / 91.89, 1e-9);
  const sp = await load("12__расчет закупки СП 09-26.xlsx");
  const c = calcAll(sp);
  const i4 = sp.rows.findIndex((r) => r.lot === "4");
  ok("СП 09-26 лот 4, ₽/шкуру", c.calcs[i4].unitRub, 42342.95, 0.05);
  ok("СП 09-26 лот 4, шт", Number(sp.rows[i4].qty), 30, 0);
  const rp = await load("134__закупка РП 04-2026.xlsx");
  const cr = calcAll(rp);
  const j1 = rp.rows.findIndex((r) => r.lot === "1");
  ok("РП 04-2026 лот 1, ₽/шкуру", cr.calcs[j1].unitRub, 32642.69, 0.05);
  const sg = await load("228__Закупка ММ SAGA 03-26.xlsx");
  console.log("SAGA формат:", sg.format, "строк", sg.rows.length);
  const k = sg.rows.findIndex((r) => r.lot === "355159");
  // лист «предварительный расчет» — полный; $ за шкуру со всеми статьями
  console.log("SAGA лот 355159: $", calcAll(sg).calcs[k].unitUsd);
  // Только коэффициент, сбор, упаковка, брокер, корректировка → 93,66 $ (лист invoices)
  const bare = { ...sg, rows: [{ ...sg.rows[k], dressing: "0", customs: "0", air: "0", interestPct: "0" }] };
  ok("SAGA лот 355159, $/шкуру (без выделки/аванса/авиа/интереса)", calcAll(bare).calcs[0].unitUsd ?? 0, 93.66, 0.01);
  const fh = await load("182__расчет закупки.xlsx");
  console.log("FH формат:", fh.format, "строк", fh.rows.length, "первая ₽/шкуру", calcAll(fh).calcs[0].unitRub.toFixed(2));
  console.log(bad ? `ПРОВАЛОВ: ${bad}` : "всё сходится");
  process.exit(bad ? 1 : 0);
})();
