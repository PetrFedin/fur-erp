// Служебный генератор для scripts/test-demo-sanitize.ts: вызывает функции, которые порождают документы и тексты из кода
// (счёт на оплату Excel, Word ТЗ всех образцов, расчёт Excel, реквизиты, каталог задач, пресеты, известные случаи),
// и печатает JSON { texts, formulas }. Запускается в обычной рабочей копии и в копии, обезличенной demo-sanitize.mjs.
import "./stubs/server-only-shim";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildPaymentInvoiceXlsx } from "../src/lib/vendor-invoice";
import { WELLMEKH_REQ } from "../src/lib/vendor-requisites";
import { buildTzDocx, tzPreviewHtml } from "../src/lib/tz-docx-vendor";
import { emptyTz } from "../src/lib/tz-vendor";
import { DECISIONS, DOC_TASKS, OWNER_HINT, OWNER_LABEL, buildLetter } from "../src/lib/task-docs-catalog";
import { PRESETS, getPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { buildCalcWorkbook } from "../src/lib/calc-xlsx";
import { PAYER_NAME } from "../src/lib/payment-parties";
import { INVOICES_FOR_DRAFTS } from "../src/lib/supplier-debt";
import { OVERPAY_NOTE } from "../src/lib/overpay-notes";
import { KNOWN_RULES } from "../src/lib/integrity/known";

const texts: Record<string, string> = {};
const formulas: string[] = [];

async function sheetOut(name: string, wb: ExcelJS.Workbook) {
  const parts: string[] = [];
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value as unknown;
    if (v && typeof v === "object" && "formula" in (v as object)) formulas.push(`${name}!${ws.name}!${c.address}=${(v as { formula: string }).formula}`);
    else parts.push(String(v ?? ""));
  }));
  texts[name] = parts.join("\n");
}

async function main() {
  texts.requisites = JSON.stringify(WELLMEKH_REQ);
  const inv = await buildPaymentInvoiceXlsx({ kind: "Аванс", number: "141", date: "2026-05-15", specNumber: "5", specDate: "2026-05-01", description: "Тест", amount: 1000000, vatPct: 22, dueDate: "2026-05-20" }, WELLMEKH_REQ);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(inv as unknown as ArrayBuffer);
  await sheetOut("invoice", wb);
  for (const tpl of ["wide", "work", "repair", "extra"] as const) {
    const p = emptyTz(tpl === "repair" ? "REPAIR" : "WORK", "9", "2026-01-01");
    p.layout = { tpl };
    const buf = await buildTzDocx(p);
    const zip = await JSZip.loadAsync(buf);
    let t = "";
    for (const f of Object.keys(zip.files)) if (/\.xml$/.test(f)) t += (await zip.file(f)!.async("string")).replace(/<[^>]+>/g, " ") + "\n";
    texts[`tz-docx-${tpl}`] = t;
    texts[`tz-preview-${tpl}`] = await tzPreviewHtml(p);
  }
  texts.catalog = JSON.stringify({ DOC_TASKS, DECISIONS, OWNER_HINT, OWNER_LABEL, mm: buildLetter("mm", [], "2026-10-15"), vellmex: buildLetter("vellmex", [], "2026-10-15") });
  texts.presets = JSON.stringify(PRESETS);
  texts.parties = PAYER_NAME + JSON.stringify(INVOICES_FOR_DRAFTS) + JSON.stringify(OVERPAY_NOTE) + JSON.stringify(KNOWN_RULES.map((r) => [r.reason, r.decision]));
  for (const id of ["sp_2026", "saga_03_26"]) {
    const preset = getPreset(id);
    if (!preset) continue;
    const { wb: calcWb } = buildCalcWorkbook(payloadFromPreset(preset), "Расчёт");
    await sheetOut(`calc-${id}`, calcWb);
  }
  process.stdout.write("@@JSON@@" + JSON.stringify({ texts, formulas }) + "\n");
}
main().then(() => process.stdout.write("", () => process.exit(0)), (e) => { console.error(e); process.exit(1); });
