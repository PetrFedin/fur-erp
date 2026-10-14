// Вставка таблицы из Excel в «Свою таблицу»: СП 09-26 из реального файла Веллмеха, итог T32 и «к оплате аванс 1» совпадают с файлом.
// Файл лежит у владельца в ~/Downloads; если его нет — проверка читает копию клипбордного текста, собранную из тех же цифр.
import "./stubs/server-only-shim";
import fs from "fs";
import os from "os";
import { getPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { applySheetTable, parseClipboardTable } from "../src/lib/sheet-paste";
import { calcAll } from "../src/lib/supplier-calc";
import { calcToBatchPayload } from "../src/lib/inbox-calc";
import { parseTableFile } from "../src/lib/table-file";

const FILE = `${os.homedir()}/Downloads/расчет закупки СП 09-26.xlsx`;
const T32 = 64458150.402630106;
const AVANS1 = 60831063.86684011;
let bad = 0;
const eq = (name: string, got: number, want: number, tol = 0.01) => { const ok = Math.abs(got - want) <= tol; if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${got} (в файле ${want})`); };

async function run() {
  if (!fs.existsSync(FILE)) { console.log("файл СП 09-26 не найден в ~/Downloads — проверка пропущена"); return; }
  const table = await parseTableFile(fs.readFileSync(FILE), "x.xlsx");
  const base = payloadFromPreset(getPreset("sp_0926")!);
  // 1) файл .xlsx как есть
  const r = applySheetTable(base, table);
  if ("error" in r) { console.log("FAIL", r.error); process.exit(1); }
  const c = calcAll(r.payload);
  const sh = c.sheet;
  const sumOf = (title: string) => { const col = sh.cols.find((x) => x.title.startsWith(title))!; return sh.sums[col.id]?.v ?? NaN; };
  eq("лотов", r.added, 29, 0);
  eq("количество", c.qty, 1326, 0);
  eq("T32 себестоимость общая", sumOf("Себестоимость общая"), T32, 0.005);
  eq("к оплате аванс 1", sumOf("К оплате: аванс 1"), AVANS1, 0.005);
  console.log("свои значения строк:", r.rowParams.join("; ") || "нет", "· вручную ячеек:", r.manualCells, "· сверка:", r.checks.map((x) => `${x.title} ${x.ok ? "ок" : "РАСХОЖДЕНИЕ"}`).join(", "));
  if (r.manualCells > 0) { bad++; console.log("FAIL: остались ячейки «вручную»"); }
  if (r.payload.header.auction !== "СП 09-26") { bad++; console.log("FAIL название аукциона:", r.payload.header.auction); } else console.log("OK   название аукциона приведено к справочнику: СП 09-26");
  // приём: у каждой строки свой счёт — закупок будет по числу счетов (8), а не одна на «3017, 3018, …»
  const m = calcToBatchPayload(r.payload, { inboxId: "t", supplierId: "s", auctionId: null, title: "t", today: "2026-10-15" });
  const invs = m.payload ? new Set(m.payload.rows.map((x) => x.invoice)).size : 0;
  eq("счетов в приёме (по одной закупке на счёт)", invs, 8, 0);
  // 2) то же через буфер обмена Excel (значения округлены до копеек, как на экране)
  const clip = table.map((row, ri) => row.map((cell, ci) => { const n = Number(cell); return ri >= 2 && cell !== "" && Number.isFinite(n) && !/^\d+$/.test(cell) ? n.toFixed(ci === 12 ? 4 : 2).replace(".", ",") : /[\r\n]/.test(cell) ? `"${cell}"` : cell; }).join("\t")).join("\n");
  const r2 = applySheetTable(base, parseClipboardTable(clip));
  if ("error" in r2) { console.log("FAIL", r2.error); process.exit(1); }
  const sh2 = calcAll(r2.payload).sheet;
  const t2 = sh2.sums[sh2.cols.find((x) => x.title.startsWith("Себестоимость общая"))!.id]!.v!;
  eq("через буфер: T32", t2, T32, 0.5);
  console.log("через буфер: вручную ячеек", r2.manualCells, "свои значения:", r2.rowParams.join("; "));
  // 3) вставка без заголовков не принимается молча
  const e = applySheetTable(base, [["1", "2"]]);
  if (!("error" in e)) { bad++; console.log("FAIL: таблица без заголовков должна давать ошибку"); }
  else console.log("OK   без заголовков:", e.error.slice(0, 50));
}
run().then(() => { console.log(bad ? `ПРОВАЛОВ: ${bad}` : "вставка таблицы: всё сходится"); process.exit(bad ? 1 : 0); });
