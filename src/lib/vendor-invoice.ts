import ExcelJS from "exceljs";
import { ruLongDate, rubWords, type InvoiceInput } from "@/lib/vendor-invoice-core";
import type { VendorReq } from "@/lib/vendor-requisites";

export * from "@/lib/vendor-invoice-core";
const money = "#,##0.00";
const dotted = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso; };

/** Счёт на оплату Веллмеха в Excel (вёрстка как у присланных PDF-счетов); описание — в vendor-invoice-core.ts. */
export async function buildPaymentInvoiceXlsx(inp: InvoiceInput, req: VendorReq): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "fur-erp";
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet("Счет на оплату", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1 } });
  [6, 12, 46, 8, 7, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const thin = { style: "thin" as const };
  const box = (r1: number, c1: number, r2: number, c2: number) => { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = { top: r === r1 ? thin : undefined, bottom: r === r2 ? thin : undefined, left: c === c1 ? thin : undefined, right: c === c2 ? thin : undefined }; };
  const put = (addr: string, v: ExcelJS.CellValue, o: Partial<ExcelJS.Style> = {}) => { const c = ws.getCell(addr); c.value = v; Object.assign(c, o); c.alignment = { wrapText: true, vertical: "top", ...(o.alignment ?? {}) }; };
  const b = req.bank;
  // банковский блок
  ws.mergeCells("A1:D1"); put("A1", b.name);
  put("E1", "БИК"); ws.mergeCells("F1:G1"); put("F1", b.bik);
  ws.mergeCells("A2:D2"); put("A2", "Банк получателя");
  put("E2", "Сч. №"); ws.mergeCells("F2:G2"); put("F2", b.corrAccount);
  put("A3", "ИНН"); ws.getCell("A3").alignment = { horizontal: "left" }; ws.mergeCells("B3:C3"); put("B3", req.seller.inn);
  put("D3", "КПП"); ws.mergeCells("E3:E3"); put("E3", req.seller.kpp); put("F3", "Сч. №"); put("G3", b.account);
  ws.mergeCells("A4:D4"); put("A4", req.seller.name); ws.mergeCells("A5:D5"); put("A5", "Получатель");
  ws.mergeCells("E4:G5");
  box(1, 1, 5, 7);
  ws.getColumn(7).width = 24;
  ws.mergeCells("A7:G7");
  put("A7", `Счет на оплату № ${inp.number} от ${ruLongDate(inp.date)}`, { font: { bold: true, size: 14 } });
  ws.mergeCells("A9:B9"); put("A9", "Поставщик\n(Исполнитель):", { font: { bold: true } });
  ws.mergeCells("C9:G9"); put("C9", `${req.seller.name}, ИНН ${req.seller.inn}, КПП ${req.seller.kpp}, ${req.seller.address}${req.seller.phone ? `, тел.: ${req.seller.phone}` : ""}`);
  ws.mergeCells("A10:B10"); put("A10", "Покупатель\n(Заказчик):", { font: { bold: true } });
  ws.mergeCells("C10:G10"); put("C10", `${req.buyer.name}, ИНН ${req.buyer.inn}, КПП ${req.buyer.kpp}, ${req.buyer.address}`);
  ws.mergeCells("A11:B11"); put("A11", "Основание:", { font: { bold: true } });
  ws.mergeCells("C11:G11"); put("C11", `${req.contract.title} №${req.contract.number} от ${req.contract.date}`);
  ws.getRow(9).height = 48; ws.getRow(10).height = 48; ws.getRow(11).height = 18;
  // таблица
  ["№", "Артикул", "Товары (работы, услуги)", "Кол-во", "Ед.", "Цена", "Сумма"].forEach((h, i) => { put(`${String.fromCharCode(65 + i)}13`, h, { font: { bold: true }, alignment: { horizontal: "center", vertical: "middle" } }); });
  put("A14", 1, { alignment: { horizontal: "center" } });
  put("C14", inp.description);
  put("D14", 1, { alignment: { horizontal: "center" } }); put("E14", "шт", { alignment: { horizontal: "center" } });
  put("F14", inp.amount, { numFmt: money }); put("G14", { formula: "ROUND(D14*F14,2)", result: Math.round(inp.amount * 100) / 100 }, { numFmt: money });
  ws.getRow(14).height = Math.max(32, Math.ceil(inp.description.length / 44) * 16);
  box(13, 1, 14, 7);
  const sum = Math.round(inp.amount * 100) / 100;
  const vat = Math.round((sum * inp.vatPct) / (100 + inp.vatPct) * 100) / 100;
  const tot = (r: number, label: string, v: ExcelJS.CellValue, bold = false) => { ws.mergeCells(`A${r}:F${r}`); put(`A${r}`, label, { font: { bold }, alignment: { horizontal: "right" } }); put(`G${r}`, v, { numFmt: money, font: { bold } }); };
  tot(16, "Итого:", { formula: "G14", result: sum }, true);
  tot(17, `В том числе НДС ${inp.vatPct}%:`, { formula: `ROUND(G16*${inp.vatPct}/${100 + inp.vatPct},2)`, result: vat }, true);
  tot(18, "Всего к оплате:", { formula: "G16", result: sum }, true);
  ws.mergeCells("A20:G20"); put("A20", { formula: `"Всего наименований 1, на сумму "&TEXT(G18,"# ##0,00")&" руб."`, result: `Всего наименований 1, на сумму ${sum.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} руб.` } as ExcelJS.CellValue);
  ws.mergeCells("A21:G21"); put("A21", rubWords(sum), { font: { bold: true } });
  let r = 23;
  if (inp.dueDate) { ws.mergeCells(`A${r}:G${r}`); put(`A${r}`, `Оплатить не позднее ${dotted(inp.dueDate)}`, { font: { bold: true } }); r++; }
  ws.mergeCells(`A${r}:G${r}`); put(`A${r}`, "Оплата данного счета означает согласие с условиями поставки товара.\nУведомление об оплате обязательно, в противном случае не гарантируется наличие товара на складе.\nТовар отпускается по факту прихода денег на р/с Поставщика, самовывозом, при наличии доверенности и паспорта.");
  ws.getRow(r).height = 48;
  r += 2;
  ws.mergeCells(`A${r}:B${r}`); put(`A${r}`, "Руководитель", { font: { bold: true } }); ws.mergeCells(`C${r}:G${r}`); put(`C${r}`, req.signer);
  r += 1;
  ws.mergeCells(`A${r}:B${r}`); put(`A${r}`, "Бухгалтер", { font: { bold: true } }); ws.mergeCells(`C${r}:G${r}`); put(`C${r}`, req.signer);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
