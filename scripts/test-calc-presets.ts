// Проверка форматов расчёта (calc-presets.json): пересчёт по контрольным строкам из реальных файлов даёт ожидаемые цифры до копейки.
import "./stubs/server-only-shim";
import { PRESETS, checkPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { calcAll } from "../src/lib/supplier-calc";

let bad = 0;
for (const pr of PRESETS) {
  const r = checkPreset(pr);
  const c = calcAll(payloadFromPreset(pr));
  const errs = Object.entries(c.sheet.colErrors);
  if (errs.length) { bad++; console.log(`FAIL ${pr.id}: ошибки формул`, errs); }
  for (const l of r.lines) { if (l.startsWith("FAIL")) { bad++; console.log(l); } }
  console.log(`${r.ok && !errs.length ? "OK  " : "FAIL"} ${pr.id}: столбцов ${pr.columns.length}, параметров ${pr.params.length}, контрольных значений ${r.lines.filter((x) => x.startsWith("OK")).length}`);
}
console.log(bad ? `ПРОВАЛОВ: ${bad}` : `форматов проверено: ${PRESETS.length}, всё сходится до копейки`);
process.exit(bad ? 1 : 0);
