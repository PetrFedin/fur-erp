// Ручная правка ячейки формулой со ссылками на другие ячейки и параметры (как в Excel): =S+500, =H3*2, =курс*10.
import "./stubs/server-only-shim";
import { getPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { calcAll, newId } from "../src/lib/supplier-calc";

const pr = getPreset("sp_0926")!;
const p = payloadFromPreset(pr);
p.params = p.params!.map((q) => (q.name === "курс" ? { ...q, value: "84.4075" } : q));
const mk = (E: string, H: string) => ({ _id: newId(), fur: "", size: "", lot: "", k_E: E, k_H: H, k_O: "20", k_Q: "0" });
p.rows = [mk("30", "360"), mk("40", "370")];
const sId = "k_T"; // итог по строке (столбец N): правим его, ссылаясь на себестоимость M
const tests: [string, string | undefined, number][] = [
  ["без правки (T = M×кол-во)", undefined, 1270288.52667],
  ["выражение =42000+342.95", "=42000+342.95", 42342.95],
  ["столбец =M+500", "=M+500", 42842.950889],
  ["ячейка =E1*2 (цена лота в строке 1)", "=E1*2", 720],
  ["ячейка и параметр =E2*курс", "=E2*курс", 370 * 84.4075],
  ["функция =ROUND(M;0)", "=ROUND(M;0)", 42343],
  ["сумма столбца =SUM(D)", "=SUM(D)", 70],
];
let bad = 0;
for (const [name, ov, want] of tests) {
  p.overrides = ov ? { [p.rows[0]._id!]: { [sId]: ov } } : {};
  const c = calcAll(p).sheet.cells[sId][0];
  const ok = c.v != null && Math.abs(c.v - want) < 0.005;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${c.v ?? c.err} (ожидалось ${want})`);
}
process.exit(bad ? 1 : 0);
