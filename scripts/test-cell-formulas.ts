// Ручная правка ячейки формулой со ссылками на другие ячейки и параметры (как в Excel): =S+500, =H3*2, =курс*10.
import "./stubs/server-only-shim";
import { getPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { calcAll, newId } from "../src/lib/supplier-calc";
import { explicitRowRefs, shiftFormula } from "../src/lib/calc-formula";

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

// «Протянуть вниз»: смещение адресов ячеек, $ закрепляет, столбцы без номера/параметры/SUM(D) не меняются
const shifts: [string, number, string][] = [
  ["=E1*2", 1, "=E2*2"],
  ["=E1*2", 3, "=E4*2"],
  ["=M3+500", -2, "=M1+500"],
  ["=$E$1*2", 5, "=$E$1*2"],
  ["=E$1+$H3", 2, "=E$1+$H5"],
  ["=M+500", 4, "=M+500"],
  ["=E2*курс", 1, "=E3*курс"],
  ["=SUM(D)+E1", 1, "=SUM(D)+E2"],
  ["=ROUND(E1;0)+D3:I4", 1, "=ROUND(E2;0)+D4:I5"],
  ["E1*2", 1, "E2*2"],
];
for (const [src, d, want] of shifts) {
  const got = shiftFormula(src, d);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} сдвиг ${src} на ${d}: ${got} (ожидалось ${want})`);
}
try { shiftFormula("=E1", -1); bad++; console.log("FAIL сдвиг выше первой строки не отклонён"); } catch { console.log("OK   сдвиг выше первой строки отклонён"); }
const isCol = (l: string) => /^[A-Z]$/.test(l);
const expl: [string, number, string][] = [
  ["=M+500", 3, "=M3+500"],
  ["=M*курс+E1", 2, "=M2*курс+E1"],
  ["=SUM(D)+M", 4, "=SUM(D)+M4"],
  ["=SUM(D:I)", 2, "=SUM(D:I)"],
  ["=ROUND(M;0)", 5, "=ROUND(M5;0)"],
];
for (const [src, row, want] of expl) {
  const got = explicitRowRefs(src, row, isCol);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} адреса ${src} в строке ${row}: ${got} (ожидалось ${want})`);
}
// протянутая формула даёт то же, что ввод вручную в каждой строке: =E1*2 из строки 1 → =E2*2 во 2-й
{
  p.rows = [mk("30", "360"), mk("40", "370")];
  p.overrides = {
    [p.rows[0]._id!]: { [sId]: "=E1*2" },
    [p.rows[1]._id!]: { [sId]: shiftFormula("=E1*2", 1) },
  };
  const c = calcAll(p).sheet.cells[sId];
  const ok = c[0].v === 720 && c[1].v === 740;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} протяжка =E1*2 вниз: ${c[0].v}, ${c[1].v} (ожидалось 720, 740)`);
  p.overrides = { [p.rows[0]._id!]: { [sId]: "=$E$1*2" }, [p.rows[1]._id!]: { [sId]: shiftFormula("=$E$1*2", 1) } };
  const c2 = calcAll(p).sheet.cells[sId];
  const ok2 = c2[0].v === 720 && c2[1].v === 720;
  if (!ok2) bad++;
  console.log(`${ok2 ? "OK  " : "FAIL"} протяжка с $: ${c2[0].v}, ${c2[1].v} (ожидалось 720, 720)`);
}
process.exit(bad ? 1 : 0);
