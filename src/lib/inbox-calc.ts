/**
 * Расчёт аукциона от поставщика (SupplierInbox, kind AUCTION_CALC) → данные мастера «Новая партия» (BatchPayload).
 * Чистая логика без базы: по ней приём во «Входящих» создаёт закупку тем же кодом, что и мастер.
 *
 * Принцип: себестоимость одной шкуры в закупке (costPlan) должна совпасть с расчётом поставщика (calcRow) до копейки.
 * Формулы СП/РП те же (computeCostPlan). SAGA и Fur Harvesters считаются по-другому, поэтому их статьи раскладываются
 * по столбцам мастера так, чтобы итог совпал: ставки НДС 0 (НДС этих форматов уже внутри сумм), суммы в рублях.
 */
import { computeCostPlan, roundRate } from "@/lib/cost-plan";
import { calcAll, effectiveRate, evalNum, resolveRow, rowFilled, type CalcPayload, type CalcRow } from "@/lib/supplier-calc";
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
  const eff = effectiveRate(h);
  if (!(eff > 0)) errors.push("В расчёте не указан курс");

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
  used.forEach(({ row: r, index }, k) => {
    const name = `строка ${k + 1}`;
    const base: IntakeRow = { n: k + 1, ...EMPTY_ROW, lot: r.lot.trim(), material: r.fur.trim(), grade: r.size.trim(), qty: t(n0(r.qty)), price: t(n0(r.price)) };
    if (!(n0(r.qty) > 0) || !(n0(r.price) > 0)) errors.push(`${name}: нет количества или цены`);
    const extra = all.extraRub;
    if (f === "SAGA") {
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
    const unit = computeCostPlan({
      quantity: n0(r.qty), price: n0(r.price), rate, vat: n0(vat),
      feePct: n0(base.fee), dressing: n0(base.dressing), transport: n0(base.transport) + n0(base.customs) + n0(base.packing),
      brokerPct: n0(base.broker), transit: n0(base.transit), serviceVatPct: n0(serviceVat),
    }).unitIncl;
    const want = all.calcs[index].unitRub;
    if (Math.abs(unit - want) > 0.05) errors.push(`${name} (лот ${r.lot || "—"}): при переносе в закупку себестоимость шкуры вышла ${unit.toFixed(2)} ₽, а в расчёте ${want.toFixed(2)} ₽`);
  });

  if (h.extras.length) warnings.push("Прочие расходы счёта (" + h.extras.map((e) => e.name || "без названия").join(", ") + ") разнесены по шкурам и записаны строкой «Упаковка и прочее».");
  if (used.some(({ row }) => filled(row.upd))) warnings.push("«Цена для УПД» поставщика в закупку не переносится: себестоимость считается по расчёту.");

  if (errors.length) return { payload: null, errors, warnings };
  const date = isoOk(h.invoiceDate) ? h.invoiceDate : ctx.today;
  const payload: BatchPayload = {
    key: `inbox-${ctx.inboxId}`.replace(/[^A-Za-z0-9-]/g, ""),
    header: {
      auctionId: ctx.auctionId ?? "",
      newAuction: ctx.auctionId ? null : { name: h.auction.replace(/\(.*$/, "").replace(/\s+/g, " ").trim(), date: "", house: "" },
      supplierId: ctx.supplierId, warehouseId: "", orderDate: date, currency: cur, exchangeRate: String(rate), vatDefault: vat,
      invoiceNumber: h.invoice.trim(), invoiceDate: isoOk(h.invoiceDate) ? h.invoiceDate : "", receiveNow: false,
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
