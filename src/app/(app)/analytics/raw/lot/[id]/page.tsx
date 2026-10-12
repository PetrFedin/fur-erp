import Link from "next/link";
import { vatPeriodLabel, vatRateForDate } from "@/lib/vat-by-date";
import { WidgetRow } from "@/components/widget-row";
import { IntegrityBanner } from "@/components/integrity-banner";
import { cleanNote } from "@/lib/note-tags";
import { notFound } from "next/navigation";
import { Decimal } from "@prisma/client/runtime/library";
import { requireSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { InfoHint } from "@/components/info-hint";
import { Money } from "@/components/money";
import { Ref4, Mode4Badge } from "@/components/c4-note";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { formatCurrency, formatDate, formatMoney, formatQty } from "@/lib/utils";
import { ageText, daysSince, lotBalances, lotIssues, loadLotUsage, pctText } from "@/lib/raw-analytics";
import { CostCell } from "../../cost-cell";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { getColorOptions } from "@/lib/colors";
import { rowVersion, LOT_V } from "@/lib/concurrency";
import { LotEditButton } from "@/components/lot-edit";
import { TILE_BOX, TileHead, TileValue, TileList } from "../../../../dashboard/tile";
import { TotalLabel } from "@/components/total-label";
import { LotUsageViz, type UsageSeg } from "@/components/lot-usage-bar";

export const metadata = { title: "Карточка лота" };

const q2 = (d: Decimal) => d.toFixed(2);

export default async function LotCardPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const c4 = await getCommission4Mode();
  const card = await loadLotUsage(id, session.user.organizationId);
  if (!card) notFound();
  const { lot: l, passport: p, orders } = card;
  // Правка безопасных полей лота (цвет, размер, сорт, номер, примечание).
  const canEditLot = hasRole(session.user.role, ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"]);
  const lotRow = canEditLot
    ? await prisma.rawMaterialLot.findFirst({
        where: { id, organizationId: session.user.organizationId },
        select: { lotNumber: true, grade: true, sizeGrade: true, color: true, colorRefId: true, notes: true },
      })
    : null;
  // Состав цены единицы: материал и доля расходов закупки (без НДС) — для блока «Из чего состоит цена лота».
  const lotCost = await prisma.rawMaterialLot.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { materialCostExclVat: true, expenseCostExclVat: true, costBreakdown: true },
  });
  const lotColorOptions = lotRow ? await getColorOptions(session.user.organizationId) : [];

  const lining = l.unit === "M";
  const unit = lining ? "м" : "шт.";
  const qty = (d: Decimal) => `${formatQty(d.toString())} ${unit}`;
  const issues = lotIssues(l);
  const bal = lotBalances(l);
  const k4 = new Decimal(0.04);
  const remIncl = l.rem.mul(l.unitIncl);
  const remExcl = l.rem.mul(l.unitExcl);
  const usedPctV = l.recv.greaterThan(0) ? l.used.div(l.recv).mul(100).toNumber() : null;

  const tot = orders.reduce(
    (a, o) => ({
      qty: a.qty.add(o.qty), incl: a.incl.add(o.incl), excl: a.excl.add(o.excl), ei: a.ei.add(o.extraIncl), ee: a.ee.add(o.extraExcl),
      units: o.unitsFromLot ? a.units.add(o.unitsFromLot) : a.units, produced: a.produced.add(o.produced),
    }),
    { qty: new Decimal(0), incl: new Decimal(0), excl: new Decimal(0), ei: new Decimal(0), ee: new Decimal(0), units: new Decimal(0), produced: new Decimal(0) },
  );
  // Схема расхода: сегменты — ТЗ (по списаниям), «прочее списание» (получено − остаток − ТЗ, не через ТЗ) и остаток; Σ сегментов = куплено.
  const zeroD = new Decimal(0);
  const usageSegs: UsageSeg[] = [
    ...orders.map((o): UsageSeg => ({
      key: `tz-${o.orderId}`, kind: "order", label: `ТЗ ${o.number}`, sku: o.sku ?? o.modelName, href: `/production/${o.orderId}`,
      qty: o.qty.toNumber(), date: o.orderDate ? formatDate(o.orderDate) : null,
      cost: <CostCell incl={o.incl} excl={o.excl} extraIncl={o.extraIncl} extraExcl={o.extraExcl} c4={c4} />,
    })),
    ...(l.otherOut.greaterThan(0)
      ? [{ key: "other", kind: "other", label: "Прочее списание", qty: l.otherOut.toNumber(), cost: <Money incl={q2(l.otherOut.mul(l.unitIncl))} excl={q2(l.otherOut.mul(l.unitExcl))} /> } as UsageSeg]
      : []),
    { key: "rem", kind: "rem", label: "Остаток", qty: Decimal.max(l.rem, zeroD).toNumber(), cost: <Money incl={q2(remIncl)} excl={q2(remExcl)} /> },
  ];
  const idle = l.usages.length === 0 && l.rem.greaterThan(0);

  const ok = (a: Decimal, b: Decimal) => a.equals(b);
  const cmp = (label: string, journal: Decimal | null, lotV: Decimal | null, third: Decimal | null, good: boolean, note?: string) => ({ label, journal, lotV, third, good, note });
  const rows = [
    cmp("Получено (куплено)", l.jIn, l.recv, l.itemsQty.greaterThan(0) ? l.itemsQty : null, ok(l.jIn, l.recv) && (l.itemsQty.isZero() || ok(l.itemsQty, l.recv)), "третья колонка — количество в позициях закупки"),
    cmp("Использовано в ТЗ", l.jProdOut, null, l.used, ok(l.jProdOut, l.used), "третья колонка — Σ списаний в ТЗ"),
    cmp("Списано иначе", l.jOtherOut, l.otherOut, null, ok(l.jOtherOut, l.otherOut), "по лоту: получено − остаток − ТЗ"),
    cmp("Остаток", bal.journal, bal.lot, bal.calc, ok(bal.journal, bal.lot) && ok(bal.lot, bal.calc), "третья колонка — получено − Σ ТЗ"),
  ];
  const cell = (d: Decimal | null) => (d ? qty(d) : <span className="text-neutral-300">—</span>);

  const dl = (label: string, value: React.ReactNode) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="min-w-0">
        <dt className="text-xs text-neutral-500">{label}</dt>
        <dd className="break-words text-sm">{value}</dd>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <IntegrityBanner kind="lot" id={id} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/analytics/raw${lining ? "?scope=lining" : ""}`} className="text-neutral-500 hover:underline">← Аналитика сырья</Link>
        <Link href="/analytics/raw/recon" className="text-neutral-500 hover:underline">· Сверка лотов</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Режим 4% и «i» — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Лот … О карточке». */}
        <h1 className="text-xl font-semibold">{lining ? "Подкладка" : "Лот"} {l.lotNumber}</h1>
        <Mode4Badge mode={c4} />
        <span className="inline-flex">
          <InfoHint label="О карточке" wide>
            <p>Всё про один лот: откуда он (аукцион, закупка), сколько куплено, в каких изделиях использован, сколько осталось и сходится ли учёт.</p>
            <p className="mt-1">«В учёте» — журнал движений склада (приходы и списания). «По лоту» — сам лот (получено и остаток). «Σ ТЗ» — сумма списаний в техзаданиях. Если три источника не равны, строка подсвечивается красным.</p>
            <p className="mt-1">Карточка показывает лот целиком, не зависит от года в шапке. Деньги — «С НДС / Без НДС» из шапки; 4% (режим в шапке) добавляется только к списаниям, где оно применяется.</p>
          </InfoHint>
        </span>
        <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (issues.length === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
          {issues.length === 0 ? "учёт сходится" : "расхождение учёта"}
        </span>
        {lotRow && (
          <LotEditButton
            lotId={id}
            version={rowVersion(lotRow, LOT_V)}
            defaults={{ lotNumber: lotRow.lotNumber ?? "", grade: lotRow.grade ?? "", sizeGrade: lotRow.sizeGrade ?? "", color: lotRow.color ?? "", colorRefId: lotRow.colorRefId, notes: lotRow.notes ?? "" }}
            colorOptions={lotColorOptions}
            canAddColor={hasRole(session.user.role, ACCESS.colors)}
          />
        )}
        {idle && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">не использован, лежит {ageText(daysSince(l.date))}</span>}
      </div>

      {/* Паспорт */}
      <Card>
        <CardHeader>
          <CardTitle>Паспорт лота</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            {dl("Партия закупки (аукцион)", <span title={l.auction}>
              {l.auction !== "__none" ? <Link href={`/lots?auction=${encodeURIComponent(l.auction)}`} className="text-blue-700 hover:underline">{l.auctionLabel}</Link> : l.auctionLabel}
              {l.auction !== "__none" && l.auction !== l.auctionLabel ? <span className="block text-xs text-neutral-500">{l.auction}</span> : null}
              {l.auction !== "__none" ? <Link href={`/payments?auction=${encodeURIComponent(l.auction)}#auction-block`} className="block text-xs text-blue-700 hover:underline">оплаты партии ›</Link> : null}
            </span>)}
            {dl("Закупка", l.purchaseId ? <Link href={`/purchases/${l.purchaseId}`} className="text-blue-700 hover:underline">{l.purchaseNumber}</Link> : "—")}
            {dl("Поставщик", p.supplier)}
            {dl("Накладная / инвойс", p.invoiceNumber)}
            {dl("Номер лота", l.lotNumber)}
            {dl(lining ? "Ткань" : "Вид меха", p.materialName)}
            {dl("Сорт / описание", p.grade)}
            {dl("Цвет", p.colorRef ? (p.color && p.color !== p.colorRef ? `${p.colorRef} (в закупке: ${p.color})` : p.colorRef) : p.color)}
            {!lining && dl("Размер", l.size === "Не указан" ? "не указан" : l.size)}
            {dl("Дата закупки", p.purchaseDate ? formatDate(p.purchaseDate) : null)}
            {dl("Дата прихода", formatDate(p.receivedDate))}
            {dl("Склад", p.warehouse)}
            {dl("НДС", `${formatQty(p.vatRate.toString())}% · ${vatPeriodLabel(p.purchaseDate ?? p.receivedDate)}${Number(p.vatRate) !== vatRateForDate(p.purchaseDate ?? p.receivedDate) ? ` (по дате должна быть ${vatRateForDate(p.purchaseDate ?? p.receivedDate)}%)` : ""}`)}
            {dl(
              "Цена за единицу",
              <span className="tabular-nums">
                <Money incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} /> за {lining ? "м" : "шт."}
                <Ref4 mode={c4} incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} />
                <InfoHint label="Цена лота" wide>
                  <p>Себестоимость единицы на момент прихода: цена позиции + доля расходов закупки (аукционный сбор, выделка, доставка…), с НДС. «Без НДС» — та же цена без налога.</p>
                  <p className="mt-1">Расчёт «+4%»: {formatMoney(q2(l.unitIncl))} × 1,04 = {formatMoney(q2(l.unitIncl.mul(new Decimal(1).add(k4))))} — применяется к строкам списания, где 4% включено.</p>
                </InfoHint>
              </span>,
            )}
            {p.itemPrice && p.currency && p.currency !== "RUB"
              ? dl("Цена в закупке (без НДС)", `${formatCurrency(p.itemPrice.toString(), p.currency)}${p.exchangeRate ? ` · курс ${formatQty(p.exchangeRate.toString())}` : ""}`)
              : null}
            {p.hammer.length > 0 &&
              dl(
                "Молоток",
                <span className="tabular-nums">
                  {formatMoney(p.hammer.find((h) => /за ед/i.test(h.label) && /без НДС/i.test(h.label))?.value ?? p.hammer[0].value)}
                  <InfoHint label="Молоток" wide>
                    <p>Цена «молотка» (без аукционного сбора и расходов) из расчёта лота:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {p.hammer.map((h) => (
                        <li key={h.label}>{h.label}: {formatMoney(h.value)}</li>
                      ))}
                    </ul>
                  </InfoHint>
                </span>,
              )}
          </dl>
          {cleanNote(p.notes) && <p className="mt-3 text-xs text-neutral-500">Примечание: {cleanNote(p.notes)}</p>}
        </CardContent>
      </Card>

      {/* Итоги движения: те же плитки и подписи, что на Главной (Куплено = Использовано + Остаток) */}
      <WidgetRow id="lot" title="Лот — движение">
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className={TILE_BOX}>
          <TileHead>Куплено</TileHead>
          <TileValue>{qty(l.recv)}</TileValue>
          <TileList items={[
            { k: "Сумма", v: <Money incl={q2(l.recv.mul(l.unitIncl))} excl={q2(l.recv.mul(l.unitExcl))} /> },
            { k: `Цена за ${lining ? "м" : "шт."}`, v: <Money incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} /> },
          ]} />
        </div>
        <div className={TILE_BOX}>
          <TileHead>Использовано</TileHead>
          <TileValue>{qty(l.used)}</TileValue>
          <TileList items={[
            { k: "Сумма без 4%", v: <Money incl={q2(l.usedIncl)} excl={q2(l.usedExcl)} />, share: usedPctV != null ? usedPctV / 100 : null },
            { k: "с 4%", v: <Money incl={q2(l.usedIncl.add(l.usedExtraIncl))} excl={q2(l.usedExcl.add(l.usedExtraExcl))} />, sub: true },
            { k: "надбавка 4%", v: <Money incl={q2(l.usedExtraIncl)} excl={q2(l.usedExtraExcl)} />, sub: true },
            { k: "ТЗ", v: String(orders.length) },
          ]} />
        </div>
        <div className={TILE_BOX}>
          <TileHead>Остаток</TileHead>
          <TileValue>{qty(l.rem)}</TileValue>
          <TileList items={[
            { k: "Сумма", v: <Money incl={q2(remIncl)} excl={q2(remExcl)} />, share: l.recv.greaterThan(0) ? l.rem.div(l.recv).toNumber() : null },
            { k: `Цена за ${lining ? "м" : "шт."}`, v: <Money incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} /> },
          ]} />
        </div>
        <div className={TILE_BOX}>
          <TileHead>Списано иначе</TileHead>
          <TileValue className={l.otherOut.isZero() ? "" : "text-red-700"}>{qty(l.otherOut)}</TileValue>
          <div className="mt-3 text-xs text-neutral-500">корректировки, потери — не через ТЗ</div>
        </div>
      </div>
      </WidgetRow>

      {/* Расход лота по ТЗ: схема + линия остатка + остаток по времени */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Расход лота по ТЗ
            <InfoHint label="Расход лота по ТЗ" wide>
              <p>Полоса равна количеству лота при закупке ({qty(l.recv)}). Каждый цветной сегмент — одно ТЗ, ширина пропорциональна списанному из этого лота; последний сегмент с пунктиром — остаток. Оранжевая линия — граница «использовано | остаток».</p>
              <p className="mt-1">«Прочее списание» — убыль не через ТЗ (корректировки, потери): получено − остаток − Σ ТЗ. Сумма сегментов всегда равна «Куплено». Деньги — «С НДС / Без НДС» из шапки; цвет не единственный признак — все данные есть в таблице под полосой.</p>
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LotUsageViz
            unit={unit}
            recv={l.recv.toNumber()}
            startDate={formatDate(l.date)}
            segs={usageSegs}
            totalCost={<Money incl={q2(l.recv.mul(l.unitIncl))} excl={q2(l.recv.mul(l.unitExcl))} />}
          />
        </CardContent>
      </Card>

      {/* Из чего состоит цена лота */}
      {(() => {
        const unitIncl = l.unitIncl, unitExcl = l.unitExcl;
        let material = lotCost?.materialCostExclVat ?? new Decimal(0);
        let expenses = lotCost?.expenseCostExclVat ?? new Decimal(0);
        const noSplit = material.add(expenses).isZero();
        if (noSplit) { material = unitExcl; expenses = new Decimal(0); }
        const vat = unitIncl.sub(unitExcl);
        const sheet = ((lotCost?.costBreakdown as { items?: { label: string; value: number }[] } | null)?.items ?? []).filter((x) => x && typeof x.label === "string" && Number.isFinite(x.value));
        const num = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(v);
        // Расчётный лист лота: строки «молоток, услуги аукциона, выделка, перевозка, комиссия» складываются в «Итого за готовое сырьё».
        // Если итог листа сходится с ценой лота — показываем состав по листу (и долю каждой статьи), иначе — общий состав (материал, расходы, НДС).
        const lotTotal = unitIncl.mul(l.recv);
        const sheetTotal = sheet.find((x) => /итого за готовое сырь/i.test(x.label));
        const sheetOk = sheetTotal != null && lotTotal.greaterThan(0) && Math.abs(sheetTotal.value - lotTotal.toNumber()) / lotTotal.toNumber() < 0.01;
        type RowC = { k: string; total: Decimal; unit: Decimal; share: boolean; strong?: boolean; note?: string };
        const mk = (k: string, total: Decimal, o: Partial<RowC> = {}): RowC => ({ k, total, unit: l.recv.greaterThan(0) ? total.div(l.recv) : new Decimal(0), share: true, ...o });
        let rowsC: RowC[];
        if (sheetOk) {
          const picks = [/молоток.*лот/i, /услуги аукцион/i, /выделк/i, /перевозк/i, /комисси/i];
          const found = picks.map((rx) => sheet.find((x) => rx.test(x.label))).filter((x): x is { label: string; value: number } => x != null && x.value !== 0);
          const sumFound = found.reduce((a, x) => a + x.value, 0);
          const rest = lotTotal.toNumber() - sumFound;
          rowsC = [
            ...found.map((x) => mk(x.label, new Decimal(x.value))),
            ...(Math.abs(rest) > 1 ? [mk("Прочее до итога расчётного листа (упаковка, брокерский %, округления)", new Decimal(rest))] : []),
            mk("Цена лота: итого за готовое сырьё, с НДС", lotTotal, { strong: true, share: false }),
          ];
        } else {
          rowsC = [
            mk("Материал: цена лота без НДС", material.mul(l.recv), { note: p.itemPrice && p.currency && p.currency !== "RUB" ? `в закупке ${formatCurrency(p.itemPrice.toString(), p.currency)}${p.exchangeRate ? ` · курс ${formatQty(p.exchangeRate.toString())}` : ""}` : undefined }),
            ...(expenses.isZero() ? [] : [mk("Расходы закупки (доля): аукционный сбор, выделка, перевозка, комиссия", expenses.mul(l.recv))]),
            mk(`НДС ${formatQty(p.vatRate.toString())}%`, vat.mul(l.recv)),
            mk("Цена лота за единицу, с НДС", lotTotal, { strong: true, share: false }),
          ];
        }
        const shareOf = (v: Decimal) => (lotTotal.greaterThan(0) ? v.div(lotTotal).toNumber() : null);
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Из чего состоит цена лота
                <InfoHint label="Из чего состоит цена лота" wide>
                  <p>Цена за единицу на момент прихода: материал (цена лота без НДС) плюс доля расходов закупки (аукционный сбор, выделка, перевозка, комиссия), плюс НДС. Расходы закупки распределяются по лотам пропорционально их стоимости. Сумма лота = цена × куплено; «Куплено» на Главной и в «Сырьё» — Σ таких сумм по лотам, всегда без 4%.</p>
                  <p className="mt-1">4% сюда не входит: оно начисляется только при списании в ТЗ — {formatMoney(q2(l.unitIncl.mul(k4)))} на единицу, по лоту уже начислено {formatMoney(q2(l.usedExtraIncl))} (с НДС).</p>
                </InfoHint>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="table-scroll scroll-hint overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                      <th className="px-2 py-1.5 text-left font-medium">Статья</th>
                      <th className="px-1.5 py-1.5 text-right font-medium">За {lining ? "м" : "шт."}</th>
                      <th className="px-1.5 py-1.5 text-right font-medium">За лот ({qty(l.recv)})</th>
                      <th className="px-1.5 py-1.5 text-right font-medium">Доля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsC.map((r) => (
                      <tr key={r.k} className={r.strong ? "border-y-2 border-neutral-300 bg-neutral-50 font-semibold" : "border-b border-neutral-100"}>
                        <td className="px-2 py-1.5">{r.k}{r.note ? <div className="text-xs font-normal text-neutral-500">{r.note}</div> : null}</td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{formatMoney(q2(r.unit))}</td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{formatMoney(q2(r.total))}</td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right font-normal tabular-nums text-neutral-500">{r.share ? pctText((shareOf(r.total) ?? 0) * 100) : "100%"}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-neutral-100 text-xs text-neutral-500">
                      <td className="px-2 py-1.5">4% при списании в ТЗ — в цену лота не входит</td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{formatMoney(q2(unitIncl.mul(k4)))}</td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">начислено по лоту {formatMoney(q2(l.usedExtraIncl))}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
              {sheet.length > 0 ? (
                <details className="rounded-md border border-neutral-200">
                  <summary className="cursor-pointer px-3 py-2 text-sm text-neutral-700">Расчётный лист лота ({sheet.length} строк)</summary>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 border-t border-neutral-100 px-3 py-2 text-sm sm:max-w-2xl">
                    {sheet.map((b, i) => (
                      <div key={i} className="contents">
                        <dt className={/итого/i.test(b.label) ? "font-medium text-neutral-800" : "text-neutral-600"}>{b.label}</dt>
                        <dd className="text-right tabular-nums">{num(b.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </CardContent>
          </Card>
        );
      })()}

      {/* Учёт */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Сходится ли учёт
            <InfoHint label="Сверка учёта" wide>
              <p>Три источника по одному лоту: журнал движений склада («в учёте»), сам лот и списания в ТЗ. В норме цифры в каждой строке равны.</p>
              <p className="mt-1">Сейчас: журнал — остаток {formatQty(bal.journal.toString())}, лот — {formatQty(bal.lot.toString())}, «получено − Σ ТЗ» — {formatQty(bal.calc.toString())} {unit}.</p>
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="py-1 pr-3 font-medium"> </th>
                  <th className="py-1 pr-3 font-medium">В учёте (журнал склада)</th>
                  <th className="py-1 pr-3 font-medium">По лоту</th>
                  <th className="py-1 pr-3 font-medium">Закупка / Σ ТЗ</th>
                  <th className="py-1 font-medium">Сверка</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className={"border-t border-neutral-100 " + (r.good ? "" : "bg-red-50")}>
                    <td className="py-1.5 pr-3 font-medium">{r.label}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{cell(r.journal)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{cell(r.lotV)}</td>
                    <td className="py-1.5 pr-3 tabular-nums" title={r.note}>{cell(r.third)}</td>
                    <td className={"py-1.5 text-xs font-bold " + (r.good ? "text-emerald-700" : "text-red-600")}>{r.good ? "✓ сходится" : "✗ расходится"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issues.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-red-700">
              {issues.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Изделия */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            В каких изделиях участвует
            <InfoHint label="Изделия лота" wide>
              <p>Каждая строка — одно ТЗ, в котором списан этот лот: артикул (модель), категория, партия, дата, сколько произведено, сколько {lining ? "метров" : "шкур"} списано из лота и во сколько это обошлось.</p>
              <p className="mt-1"><b>≈ из лота, шт.</b> = произведено в ТЗ × доля лота. Доля = списано из этого лота ÷ всего списано в ТЗ того же материала (в ТЗ может идти несколько лотов), поэтому число приблизительное. <b>На 1 изделие</b> = списано из лота ÷ произведено в ТЗ.</p>
              <p className="mt-1">Деньги — по цене лота; в режиме «С 4%» ниже добавляется итог с надбавкой.</p>
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-500">Лот ещё не использован ни в одном ТЗ{l.rem.greaterThan(0) ? ` — на складе ${qty(l.rem)} (${formatMoney(q2(remIncl))} с НДС)` : ""}.</p>
          ) : (
            <ResponsiveRows
              table={
                <Table>
                  <Thead>
                    <Tr>
                      <Th>ТЗ</Th>
                      <Th>Артикул / модель</Th>
                      <Th>Категория</Th>
                      <Th>Партия</Th>
                      <Th>Дата</Th>
                      <Th className="text-right">Произведено в ТЗ</Th>
                      <Th className="text-right">≈ из лота, шт.</Th>
                      <Th className="text-right">Списано, {unit}</Th>
                      <Th className="text-right">На 1 изделие, {unit}</Th>
                      <Th className="text-right">Стоимость списания</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {orders.map((o) => (
                      <Tr key={o.orderId}>
                        <Td><Link href={`/production/${o.orderId}`} className="text-blue-700 hover:underline">№ {o.number}</Link></Td>
                        <Td>
                          <Link href={`/models/${o.modelId}`} className="underline">{o.modelName}</Link>
                          {o.sku && <span className="block text-xs text-neutral-500">{o.sku}</span>}
                        </Td>
                        <Td>{o.category}</Td>
                        <Td>{o.batchNumber != null ? <Link href={`/production/batches/${o.batchNumber}`} className="underline">{o.batchNumber}</Link> : "—"}</Td>
                        <Td className="whitespace-nowrap">{o.orderDate ? formatDate(o.orderDate) : "—"}</Td>
                        <Td className="text-right tabular-nums">{formatQty(o.produced.toString())}{o.produced.isZero() && <span className="block text-xs text-neutral-500">план {formatQty(o.planned.toString())}</span>}</Td>
                        <Td className="text-right tabular-nums">{o.unitsFromLot ? `≈ ${formatQty(o.unitsFromLot.toFixed(1))}` : "—"}{o.orderLots > 1 && <span className="block text-xs text-neutral-500">лотов в ТЗ: {o.orderLots}</span>}</Td>
                        <Td className="text-right font-medium tabular-nums">{formatQty(o.qty.toString())}</Td>
                        <Td className="text-right tabular-nums">{o.produced.greaterThan(0) ? formatQty(o.qty.div(o.produced).toFixed(2)) : "—"}</Td>
                        <Td className="text-right tabular-nums"><CostCell incl={o.incl} excl={o.excl} extraIncl={o.extraIncl} extraExcl={o.extraExcl} c4={c4} /></Td>
                      </Tr>
                    ))}
                    <Tr className="row-total">
                      <Td colSpan={5}><TotalLabel extra={`${orders.length} ТЗ`} /></Td>
                      <Td className="text-right tabular-nums">{formatQty(tot.produced.toString())}</Td>
                      <Td className="text-right tabular-nums">≈ {formatQty(tot.units.toFixed(1))}</Td>
                      <Td className="text-right tabular-nums">{formatQty(tot.qty.toString())}</Td>
                      <Td className="text-right tabular-nums">{tot.produced.greaterThan(0) ? formatQty(tot.qty.div(tot.produced).toFixed(2)) : "—"}</Td>
                      <Td className="text-right tabular-nums"><CostCell incl={tot.incl} excl={tot.excl} extraIncl={tot.ei} extraExcl={tot.ee} c4={c4} /></Td>
                    </Tr>
                    <Tr className="font-semibold">
                      <Td colSpan={7}>Остаток лота</Td>
                      <Td className="text-right tabular-nums">{formatQty(l.rem.toString())}</Td>
                      <Td />
                      <Td className="text-right tabular-nums"><Money incl={q2(remIncl)} excl={q2(remExcl)} /></Td>
                    </Tr>
                  </Tbody>
                </Table>
              }
            >
              {orders.map((o) => (
                <RowCard
                  key={o.orderId}
                  title={`ТЗ № ${o.number}`}
                  href={`/production/${o.orderId}`}
                  subtitle={<><Link href={`/models/${o.modelId}`} className="underline">{o.modelName}</Link> · {o.category}</>}
                  fields={[
                    { label: "Списано", value: `${formatQty(o.qty.toString())} ${unit}`, strong: true },
                    { label: "Стоимость", value: <CostCell incl={o.incl} excl={o.excl} extraIncl={o.extraIncl} extraExcl={o.extraExcl} c4={c4} /> },
                    { label: "Произведено в ТЗ", value: `${formatQty(o.produced.toString())} шт.${o.produced.isZero() ? ` (план ${formatQty(o.planned.toString())})` : ""}` },
                    { label: "≈ из лота", value: o.unitsFromLot ? `≈ ${formatQty(o.unitsFromLot.toFixed(1))} шт.` : "—" },
                  ]}
                  details={[
                    { label: "Партия", value: o.batchNumber != null ? String(o.batchNumber) : "—" },
                    { label: "Дата", value: o.orderDate ? formatDate(o.orderDate) : "—" },
                    { label: `На 1 изделие, ${unit}`, value: o.produced.greaterThan(0) ? formatQty(o.qty.div(o.produced).toFixed(2)) : "—" },
                    { label: "Артикул", value: o.sku ?? "—" },
                  ]}
                />
              ))}
              <div className="row-total rounded-lg p-3 text-sm">
                <TotalLabel unit={unit} />: {formatQty(tot.qty.toString())} {unit} · <CostCell incl={tot.incl} excl={tot.excl} extraIncl={tot.ei} extraExcl={tot.ee} c4={c4} />
                <div className="mt-1 text-xs font-normal text-neutral-600">
                  Произведено в ТЗ: {formatQty(tot.produced.toString())} шт., ≈ из лота {formatQty(tot.units.toFixed(1))} шт. Остаток лота: {qty(l.rem)} · <Money incl={q2(remIncl)} excl={q2(remExcl)} />
                </div>
              </div>
            </ResponsiveRows>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
