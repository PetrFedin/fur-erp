/**
 * Расчёт аукциона от поставщика (SupplierInbox, kind AUCTION_CALC) → данные мастера «Новая партия» (BatchPayload).
 * Чистая логика без базы: по ней приём во «Входящих» создаёт закупку тем же кодом, что и мастер.
 *
 * Принцип: себестоимость одной шкуры в закупке (costPlan) должна совпасть с расчётом поставщика (calcRow) до копейки.
 * Формулы СП/РП те же (computeCostPlan). SAGA и Fur Harvesters считаются по-другому, поэтому их статьи раскладываются
 * по столбцам мастера так, чтобы итог совпал: ставки НДС 0 (НДС этих форматов уже внутри сумм), суммы в рублях.
 */
import { computeCostPlan, roundRate } from "@/lib/cost-plan";
import { calcAll, calcMonth, calcYear, effectiveRate, evalNum, resolveRow, rowFilled, type CalcPayload, type CalcRow } from "@/lib/supplier-calc";
import { EMPTY_ROW, type BatchPayload, type IntakeRow } from "@/lib/batch-intake";

const n0 = (s: string | undefined) => { const v = evalNum(s); return Number.isFinite(v) ? v : 0; };
const filled = (s: string | undefined) => (s ?? "").trim() !== "";
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const t = (n: number) => (n === 0 ? "" : String(r6(n)));
const isoOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export type CalcMapCtx = {
  inboxId: string;
  supplierId: string;
  /** Аукцион из справочника (id) либо null — тогда создаётся новый с именем из шапки. */
  auctionId: string | null;
  title: string;
  /** Дата закупки по умолчанию (дата отправки), ГГГГ-ММ-ДД. */
  today: string;
};

export type CalcMapResult = { payload: BatchPayload | null; errors: string[]; warnings: string[] };

/** Ненулевые строки расчёта (пустые строки формы пропускаются, как и при отправке). */
export function usedRows(p: CalcPayload): { row: CalcRow; index: number }[] {
  return p.rows.map((row, index) => ({ row: resolveRow(p.format, p.header, row), index })).filter(({ row }) => rowFilled(row));
}

export function calcToBatchPayload(p: CalcPayload, ctx: CalcMapCtx): CalcMapResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const h = p.header;
  const f = p.format;
  const used = usedRows(p);
  if (used.length === 0) errors.push("В расчёте нет ни одного лота");
  const all = calcAll(p);
  const isSheet = f === "SHEET";
  const eff = isSheet ? all.rate : effectiveRate(h);
  if (!(eff > 0)) errors.push(isSheet ? "В расчёте нет параметра «курс» со значением" : "В расчёте не указан курс");
  if (isSheet && !p.priceColumn) errors.push("Не выбран столбец «Закупка за шкуру (молоток)»");
  const sheetPrice = (i: number) => {
    const col = p.priceColumn;
    if (!col) return 0;
    const c = all.sheet.cells[col]?.[i];
    if (c) return c.v ?? 0;
    return n0(p.rows[i]?.[col]);
  };

  // курс закупки и ставки НДС
  let rate = eff;
  let vat = "0";
  let serviceVat = "0";
  if (f === "SP_RP" || f === "OTHER") {
    vat = String(n0(h.vat) || (filled(h.vat) ? 0 : 22));
    serviceVat = vat;
    const rates = used.map(({ row }) => (filled(row.rate) ? n0(row.rate) : eff));
    const first = rates[0] ?? eff;
    if (rates.some((x) => Math.abs(x - first) > 1e-9)) errors.push("В расчёте разные курсы по строкам — в закупке курс один. Попросите поставщика указать единый курс");
    rate = first;
  } else if (f === "SAGA") {
    const coefs = used.map(({ row }) => (filled(row.coef) ? n0(row.coef) : 1));
    const c0 = coefs[0] ?? 1;
    if (coefs.some((x) => Math.abs(x - c0) > 1e-9)) errors.push("В расчёте разные курсы EUR→USD по строкам — в закупке курс один. Попросите поставщика указать единый");
    rate = eff * c0;
  }
  rate = roundRate(rate);

  const cur = (h.currency || "USD").trim().toUpperCase();
  const rows: IntakeRow[] = [];
  const sh = all.sheet;
  // «свой» расчёт: есть свои столбцы, выбран не встроенный столбец себестоимости или есть ручные значения цены
  const customMode = (p.customColumns?.length ?? 0) > 0 || sh.unitCol !== "unit" || Object.values(p.overrides ?? {}).some((o) => o.unit !== undefined && o.unit.trim() !== "");
  const diffs: number[] = [];
  used.forEach(({ row: r, index }, k) => {
    const priceN = isSheet ? sheetPrice(index) : n0(r.price);
    const name = `строка ${k + 1}`;
    const base: IntakeRow = { n: k + 1, ...EMPTY_ROW, invoice: (r.invoice ?? "").trim(), lot: r.lot.trim(), material: r.fur.trim(), grade: r.size.trim(), qty: t(all.qtys[index]), price: t(priceN) };
    if (!(all.qtys[index] > 0) || !(priceN > 0)) errors.push(`${name}: нет количества или цены`);
    const extra = all.extraRub;
    if (isSheet) {
      // свободная таблица: всё сверх «цена × курс» (сборы, выделка, транспорт, свои столбцы) приходит одной разницей в «транспорт» ниже
    } else if (f === "SAGA") {
      const price = n0(r.price);
      const coef = filled(r.coef) ? n0(r.coef) : 1;
      const feePct = n0(r.feePct) + (price > 0 ? (n0(r.feeFixed) / price) * 100 : 0);
      Object.assign(base, {
        fee: t(feePct), broker: t(n0(r.brokerPct) + n0(r.interestPct)),
        packing: t(n0(r.packing) * coef * eff + extra), dressing: t(n0(r.dressing) * eff),
        customs: t(n0(r.customs) * eff), transport: t((n0(r.adj) + n0(r.air)) * eff),
      });
    } else if (f === "FH") {
      Object.assign(base, {
        fee: t(n0(r.feePct)), broker: t(n0(r.brokerPct) + n0(r.commPct)),
        packing: t(n0(r.packing) * eff + extra), dressing: t(n0(r.dressingUsd) * eff),
        customs: t(n0(r.base22) * (n0(r.vatPct) / 100) + n0(r.base5) * (n0(r.dutyPct) / 100)), transport: t((n0(r.trans1) + n0(r.trans2)) * eff),
      });
    } else {
      Object.assign(base, {
        fee: t(n0(r.feePct)), broker: t(n0(r.brokerPct)), dressing: t(n0(r.dressing)), transport: t(n0(r.transport)),
        transit: t(n0(r.transit)), packing: t(extra),
      });
    }
    rows.push(base);

    // контроль: себестоимость шкуры после раскладки совпадает с расчётом поставщика
    let unit = computeCostPlan({
      quantity: all.qtys[index], price: priceN, rate, vat: n0(vat),
      feePct: n0(base.fee), dressing: n0(base.dressing), transport: n0(base.transport) + n0(base.customs) + n0(base.packing),
      brokerPct: n0(base.broker), transit: n0(base.transit), serviceVatPct: n0(serviceVat),
    }).unitIncl;
    const want = all.calcs[index].unitRub;
    if (customMode && Math.abs(unit - want) > 0.005) {
      // выбранный столбец себестоимости считает не по стандартной раскладке: разница записывается отдельной статьёй без НДС
      const delta = want - unit;
      base.transport = t(n0(base.transport) + delta);
      diffs.push(Math.abs(delta));
      unit = computeCostPlan({
        quantity: all.qtys[index], price: priceN, rate, vat: n0(vat),
        feePct: n0(base.fee), dressing: n0(base.dressing), transport: n0(base.transport) + n0(base.customs) + n0(base.packing),
        brokerPct: n0(base.broker), transit: n0(base.transit), serviceVatPct: n0(serviceVat),
      }).unitIncl;
    }
    if (customMode) base.planItems = planItemsFor(p, all, index, cur, rate, want, priceN);
    if (Math.abs(unit - want) > 0.05) errors.push(`${name} (лот ${r.lot || "—"}): при переносе в закупку себестоимость шкуры вышла ${unit.toFixed(2)} ₽, а в расчёте ${want.toFixed(2)} ₽`);
  });

  if (diffs.length) warnings.push(`Себестоимость по выбранному столбцу «${sh.cols.find((c) => c.id === sh.unitCol)?.title ?? ""}» отличается от стандартной раскладки (до ${Math.max(...diffs).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽ за шкуру): разница записана в состав цены.`);
  if (h.extras.length) warnings.push("Прочие расходы счёта (" + h.extras.map((e) => e.name || "без названия").join(", ") + ") разнесены по шкурам и записаны строкой «Упаковка и прочее».");
  if (used.some(({ row }) => filled(row.upd))) warnings.push("«Цена для УПД» поставщика в закупку не переносится: себестоимость считается по расчёту.");

  if (errors.length) return { payload: null, errors, warnings };
  // Год, выбранный Веллмехом (или «09-26» из названия), важнее сегодняшней даты: закупка и новый аукцион попадают в нужный год
  const yr = calcYear(h);
  const baseDate = isoOk(h.invoiceDate) ? h.invoiceDate : ctx.today;
  const date = yr && Number(baseDate.slice(0, 4)) !== yr ? `${yr}-${calcMonth(h)}-01` : baseDate;
  // В одном расчёте может быть несколько аукционных счетов (по одному на закупку): у каждой строки свой счёт, закупок создаётся по числу счетов.
  const rowInvoices = [...new Set(rows.map((x) => x.invoice).filter(Boolean))];
  const invoiceFallback = rowInvoices.length > 1 ? rowInvoices[0] : h.invoice.trim();
  const payload: BatchPayload = {
    key: `inbox-${ctx.inboxId}`.replace(/[^A-Za-z0-9-]/g, ""),
    header: {
      auctionId: ctx.auctionId ?? "",
      newAuction: ctx.auctionId ? null : { name: h.auction.replace(/\(.*$/, "").replace(/\s+/g, " ").trim(), date: "", house: "" },
      supplierId: ctx.supplierId, warehouseId: "", orderDate: date, currency: cur, exchangeRate: String(rate), vatDefault: vat,
      invoiceNumber: invoiceFallback, invoiceDate: isoOk(h.invoiceDate) ? h.invoiceDate : "", receiveNow: false,
      notes: `Из кабинета поставщика: ${ctx.title}`.slice(0, 1000), serviceVat,
    },
    rows,
    decisions: { fur: {}, color: {} },
    pct: { fee: true, broker: true },
    docs: [],
    ackMismatch: false,
  };
  return { payload, warnings, errors };
}

/** Состав цены лота для окна «Цена лота»: цена, курс, стандартная раскладка формата, свои столбцы и итог — одним набором строк. */
function planItemsFor(p: CalcPayload, all: ReturnType<typeof calcAll>, index: number, cur: string, rate: number, want: number, price: number): { label: string; value: number }[] {
  const sh = all.sheet;
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const items: { label: string; value: number }[] = [
    { label: `Цена за ед., ${cur === "EUR" ? "€" : "$"}`, value: r6(price) },
    { label: "Курс для расчёта", value: r6(rate) },
  ];
  const std = sh.cells.unit?.[index]?.v;
  if (sh.unitCol !== "unit" && std != null) items.push({ label: "По стандартной формуле формата, ₽", value: r6(std) });
  for (const c of sh.cols) {
    if (c.kind !== "custom") continue;
    const v = sh.cells[c.id]?.[index]?.v;
    if (v != null) items.push({ label: `${c.title}${c.unit && !c.title.includes(c.unit) ? `, ${c.unit}` : ""}`, value: r6(v) });
  }
  items.push({ label: "Итого себестоимость за единицу, ₽", value: r6(want) });
  return items;
}
