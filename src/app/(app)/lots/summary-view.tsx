import Link from "next/link";
import { cookies } from "next/headers";
import { Decimal } from "@prisma/client/runtime/library";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { NO_AUCTION_LABEL, isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { formatMoney, formatQty } from "@/lib/utils";
import { safeRatio } from "@/lib/weighted";
import { parseVatModeCookie } from "@/lib/vat-mode";
import { addLeaf, aggOf, emptyAgg, loadSummary, loadUnlinkedAdvances, type Agg, type Leaf } from "@/lib/purchase-summary";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { prisma } from "@/lib/prisma";
import { VatSync } from "./vat-sync";
import { LazyDetails } from "./lazy-details";
import type { YearFilter } from "@/lib/year-filter";
import { emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { loadSummaryAuction } from "./summary-node-action";

const UNIT: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };
const COLS = "md:min-w-[980px] md:grid-cols-[minmax(200px,2.2fr)_repeat(7,minmax(100px,1fr))]";

type Mode = "incl" | "excl";

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const a = m.get(k);
    if (a) a.push(it);
    else m.set(k, [it]);
  }
  return m;
}

const cmpRu = (a: string, b: string) => a.localeCompare(b, "ru", { numeric: true });

/** Ключ аукциона в сводке: служебные метки («Нет информации», «Не в реестре остатков…») — одна группа «Без аукциона». */
const aKey = (l: Leaf) => (isServiceAuction(l.auction) ? NO_AUCTION_LABEL : l.auction);
/** «Без аукциона» — в конец списков. */
const cmpAuction = (a: string, b: string) => Number(a === NO_AUCTION_LABEL) - Number(b === NO_AUCTION_LABEL) || cmpRu(a, b);

function figures(a: Agg, mode: Mode) {
  const price = mode === "excl" ? a.price.excl : a.price.incl;
  const full = mode === "excl" ? a.full.excl : a.full.incl;
  const paid = mode === "excl" ? a.paidExcl : a.paidIncl;
  return {
    price,
    full,
    paid,
    remaining: full.sub(paid),
    // Средние — только взвешенные по количеству шкур: Σ сумма ÷ Σ шкур.
    avgPrice: safeRatio(Number(price), Number(a.qty)),
    avgFull: safeRatio(Number(full), Number(a.qty)),
  };
}

const money = (d: Decimal | number) => formatMoney(d.toString());

/** Метрики строки: на md+ — колонки таблицы, на мобильном — пары «подпись: значение». */
function Metrics({ a, mode, unit }: { a: Agg; mode: Mode; unit?: string }) {
  const f = figures(a, mode);
  const cell = "flex items-baseline justify-between gap-2 md:block md:text-right";
  const lab = "text-xs text-neutral-400 md:hidden";
  return (
    <>
      <span className={cell}>
        <span className={lab}>Шкур</span>
        <span>
          {formatQty(a.qty.toString())}
          {unit ? ` ${unit}` : ""}
        </span>
      </span>
      <span className={cell}>
        <span className={lab}>Цена шкур по счетам</span>
        <span>{money(f.price)}</span>
      </span>
      <span className={cell}>
        <span className={lab}>С расходами</span>
        <span className="font-medium">{money(f.full)}</span>
      </span>
      <span className={cell}>
        <span className={lab}>Оплачено</span>
        <span>{money(f.paid)}</span>
      </span>
      <span className={cell}>
        <span className={lab}>Остаток</span>
        <span className={f.remaining.greaterThan(0.005) ? "text-amber-600" : f.remaining.lessThan(-0.005) ? "text-blue-600" : ""}>
          {money(f.remaining)}
        </span>
      </span>
      <span className={cell} title="Цена шкур по счетам ÷ число шкур">
        <span className={lab}>Ср. цена шкуры</span>
        <span>{f.avgPrice == null ? "—" : money(f.avgPrice)}</span>
      </span>
      <span className={cell} title="Стоимость с расходами ÷ число шкур">
        <span className={lab}>Ср. с расходами за шкуру</span>
        <span>{f.avgFull == null ? "—" : money(f.avgFull)}</span>
      </span>
    </>
  );
}

function Node({
  title,
  sub,
  a,
  mode,
  level,
  open,
  children,
  load,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  a: Agg;
  mode: Mode;
  level: 0 | 1 | 2;
  open?: boolean;
  children?: React.ReactNode;
  /** Серверное действие: содержимое строки подгружается при первом раскрытии (не рендерится вместе со страницей). */
  load?: () => Promise<React.ReactNode>;
}) {
  const indent = ["", "md:pl-4", "md:pl-8"][level];
  const tone = ["bg-neutral-50 font-semibold", "bg-white", "bg-white"][level];
  const summary = (
    <summary
      className={`grid cursor-pointer list-none grid-cols-1 gap-x-2 gap-y-1 px-3 py-2 text-sm hover:bg-neutral-100/60 ${COLS} ${tone} [&::-webkit-details-marker]:hidden`}
    >
      <span className={`min-w-0 ${indent}`}>
        <span className="mr-1 inline-block text-neutral-400 transition-transform group-open:rotate-90">›</span>
        {title}
        {sub && <span className="ml-2 text-xs font-normal text-neutral-400">{sub}</span>}
      </span>
      <Metrics a={a} mode={mode} />
    </summary>
  );
  const cls = "group border-t border-neutral-100 first:border-t-0";
  if (load) return <LazyDetails className={cls} summary={summary} load={load} />;
  return (
    <details open={open} className={cls}>
      {summary}
      <div>{children}</div>
    </details>
  );
}

/** Материалы и лоты одного аукциона внутри года (раскрытая строка аукциона). */
export function AuctionBody({ al, mode }: { al: Leaf[]; mode: Mode }) {
  return (
    <>
      {[...group(al, (l) => l.material).entries()]
        .sort((a, b) => cmpRu(a[0], b[0]))
        .map(([material, ml]) => (
          <Node key={material} title={material} sub={`${ml.length} лот.`} a={aggOf(ml)} mode={mode} level={2}>
            {ml.map((l) => (
              <LotRow key={l.id} l={l} mode={mode} />
            ))}
          </Node>
        ))}
    </>
  );
}

/** Фильтр сводки (как в адресной строке) — применяется и на странице, и в подгрузке строки. */
export type SummaryFilter = { year: number | null; auction: string; material: string };
export const filterLeaves = (all: Leaf[], f: SummaryFilter) =>
  all.filter((l) => (!f.year || l.year === f.year) && (!f.auction || aKey(l) === f.auction) && (!f.material || l.material === f.material));
export { aKey };

function LotRow({ l, mode }: { l: Leaf; mode: Mode }) {
  const a = emptyAgg();
  addLeaf(a, l);
  return (
    <div className={`grid grid-cols-1 gap-x-2 gap-y-1 border-t border-neutral-100 px-3 py-2 text-sm md:pl-12 ${COLS}`}>
      <span className="min-w-0">
        <Link href={`/purchases/${l.purchaseId}`} className="hover:underline">
          Лот {l.lotNumber ?? "без номера"}
        </Link>
        <span className="ml-2 text-xs text-neutral-400">
          {l.invoice ? `счёт ${l.invoice} · ` : ""}
          {l.purchaseNumber}
        </span>
      </span>
      <Metrics a={a} mode={mode} unit={UNIT[l.unit]} />
    </div>
  );
}

export async function PurchaseSummary({
  organizationId,
  year,
  searchParams,
}: {
  organizationId: string;
  /** Общий фильтр года из шапки. */
  year: YearFilter;
  searchParams: { auction?: string; material?: string; vat?: string };
}) {
  // Один источник правды — переключатель в шапке (cookie vatDisplay); ?vat= — только переопределение ссылкой.
  const vatOverride: Mode | null = searchParams.vat === "excl" ? "excl" : searchParams.vat === "incl" ? "incl" : null;
  const cookieMode: Mode = parseVatModeCookie((await cookies()).get("vatDisplay")?.value);
  const mode: Mode = vatOverride ?? cookieMode;
  const [{ leaves: all, purchaseTotals }, advances, debt] = await Promise.all([
    loadSummary(organizationId),
    loadUnlinkedAdvances(organizationId),
    loadSupplierDebt(prisma, organizationId),
  ]);

  const auctions = [...new Set(all.map(aKey))].sort(cmpAuction);
  const materials = [...new Set(all.map((l) => l.material))].sort(cmpRu);
  const yearF = year === "all" ? null : Number(year);
  const auctionF = auctions.includes(searchParams.auction ?? "") ? searchParams.auction! : "";
  const materialF = materials.includes(searchParams.material ?? "") ? searchParams.material! : "";

  const leaves = filterLeaves(all, { year: yearF, auction: auctionF, material: materialF });
  const filtered = Boolean(auctionF || materialF);

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab: "summary" });
    if (auctionF) p.set("auction", auctionF);
    if (materialF) p.set("material", materialF);
    if (vatOverride) p.set("vat", vatOverride);
    for (const [k, v] of Object.entries(over)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/lots?${p.toString()}`;
  };

  // Сходимость: три независимых разреза (по годам, аукционам, типам сырья) должны дать одну и ту же сумму.
  const sumBy = (key: (l: Leaf) => string) => {
    const total = emptyAgg();
    for (const items of group(leaves, key).values()) {
      const g = aggOf(items);
      total.qty = total.qty.add(g.qty);
      total.lots += g.lots;
      total.price.incl = total.price.incl.add(g.price.incl);
      total.price.excl = total.price.excl.add(g.price.excl);
      total.full.incl = total.full.incl.add(g.full.incl);
      total.full.excl = total.full.excl.add(g.full.excl);
      total.paidIncl = total.paidIncl.add(g.paidIncl);
      total.paidExcl = total.paidExcl.add(g.paidExcl);
    }
    return total;
  };
  const grand = aggOf(leaves);
  const views = [
    { name: "по годам", a: sumBy((l) => String(l.year)) },
    { name: "по аукционам", a: sumBy(aKey) },
    { name: "по типам сырья", a: sumBy((l) => l.material) },
  ];
  const pick = (a: Agg) => ({
    full: mode === "excl" ? a.full.excl : a.full.incl,
    price: mode === "excl" ? a.price.excl : a.price.incl,
    paid: mode === "excl" ? a.paidExcl : a.paidIncl,
  });
  const g0 = pick(grand);
  let maxDiff = new Decimal(0);
  for (const v of views) {
    const p = pick(v.a);
    for (const k of ["full", "price", "paid"] as const) {
      const d = p[k].sub(g0[k]).abs();
      if (d.greaterThan(maxDiff)) maxDiff = d;
    }
    const dq = v.a.qty.sub(grand.qty).abs();
    if (dq.greaterThan(maxDiff)) maxDiff = dq;
  }
  const converges = maxDiff.lessThanOrEqualTo(1);

  // Независимая проверка: Σ листьев = Σ итогов закупок (purchaseTotalInclVat/ExclVat — как на дашборде и в /payments).
  // При фильтре по сырью берётся часть позиций закупки — сравнивать с итогом закупки нельзя.
  const purchaseIds = [...new Set(leaves.map((l) => l.purchaseId))];
  const independent = purchaseIds.reduce((sum, id) => {
    const t = purchaseTotals.get(id);
    return t ? sum.add(mode === "excl" ? t.excl : t.incl) : sum;
  }, new Decimal(0));
  const independentDiff = g0.full.sub(independent).abs();
  const independentOk = independentDiff.lessThanOrEqualTo(1);
  // Расхождение в копейках (до 1 ₽) — округление, итоги считаем сошедшимися, но говорим об этом прямо.
  const roundingOnly = maxDiff.greaterThanOrEqualTo(0.005) || (!materialF && independentDiff.greaterThanOrEqualTo(0.005));

  const draftFull = leaves.filter((l) => l.draft).reduce((s, l) => s.add(mode === "excl" ? l.full.excl : l.full.incl), new Decimal(0));
  const draftCount = leaves.filter((l) => l.draft).length;
  const advancesTotal = advances.reduce((s, a) => s.add(a.amount), new Decimal(0));

  const byYear = [...group(leaves, (l) => String(l.year)).entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
  const gf = figures(grand, mode);

  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="grid grid-cols-2 items-end gap-2 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-4">
        <input type="hidden" name="tab" value="summary" />
        {vatOverride && <input type="hidden" name="vat" value={vatOverride} />}
        <label className="col-span-2 flex flex-col gap-1 text-xs text-neutral-500">
          Аукцион
          <Select name="auction" defaultValue={auctionF}>
            <option value="">Все аукционы</option>
            {auctions.map((a) => (
              <option key={a} value={a}>
                {shortAuctionName(a, 60)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Сырьё
          <Select name="material" defaultValue={materialF}>
            <option value="">Всё сырьё</option>
            {materials.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline">
            Показать
          </Button>
          {filtered && (
            <Link href={qs({ auction: "", material: "" })} className="text-sm text-neutral-500 hover:underline">
              Сбросить
            </Link>
          )}
        </div>
      </form>

      {!vatOverride && <VatSync serverMode={cookieMode} />}
      <p className="text-xs text-neutral-500" data-vat-mode={mode}>
        Суммы: <b>{mode === "excl" ? "без НДС" : "с НДС"}</b>
        {vatOverride ? (
          <>
            {" "}
            (задано ссылкой ?vat={vatOverride}; <Link href={qs({ vat: "" })} className="underline">использовать переключатель в шапке</Link>)
          </>
        ) : (
          " — переключатель «С НДС / Без НДС» в шапке страницы."
        )}
      </p>

      {leaves.length === 0 ? (
        <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">
          {filtered ? "По выбранным фильтрам закупок нет." : emptyForYear(year, "закупок", "Закупок пока нет.")}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <div
            className={`hidden gap-x-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 md:grid ${COLS}`}
          >
            <span>Год / аукцион / сырьё / лот</span>
            <span className="text-right">Шкур</span>
            <span className="text-right">Цена шкур по счетам</span>
            <span className="text-right">С расходами</span>
            <span className="text-right">Оплачено</span>
            <span className="text-right">Остаток</span>
            <span className="text-right">
              Ср. цена шкуры
              <InfoHint label="Как считается средняя цена шкуры" align="right">
                Цена шкур по счетам ÷ число шкур — средневзвешенная: общая сумма делится на общее число шкур, а не среднее из средних.
                {grand.qty.greaterThan(0) && (
                  <p className="mt-1">Сейчас: {money(gf.price)} ÷ {formatQty(grand.qty.toString())} шк. = {money(new Decimal(gf.price).div(grand.qty))}.</p>
                )}
              </InfoHint>
            </span>
            <span className="text-right">
              Ср. с расходами
              <InfoHint label="Как считается средняя с расходами" align="right">
                Стоимость с расходами ÷ число шкур (средневзвешенная).
                {grand.qty.greaterThan(0) && (
                  <p className="mt-1">Сейчас: {money(gf.full)} ÷ {formatQty(grand.qty.toString())} шк. = {money(new Decimal(gf.full).div(grand.qty))}.</p>
                )}
              </InfoHint>
            </span>
          </div>
          {byYear.map(([year, yl], yi) => (
            <Node
              key={year}
              title={`${year} год`}
              sub={`${yl.length} лот.`}
              a={aggOf(yl)}
              mode={mode}
              level={0}
              open={yi === 0 || byYear.length === 1}
            >
              {[...group(yl, aKey).entries()]
                .sort((a, b) => cmpAuction(a[0], b[0]))
                .map(([auction, al]) => (
                  <Node
                    key={auction}
                    title={shortAuctionName(auction, 70)}
                    sub={`${al.length} лот.`}
                    a={aggOf(al)}
                    mode={mode}
                    level={1}
                    load={loadSummaryAuction.bind(null, Number(year), auction, yearF ?? 0, auctionF, materialF, mode)}
                  />
                ))}
            </Node>
          ))}
          <div
            className={`grid grid-cols-1 gap-x-2 gap-y-1 border-t-2 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-semibold ${COLS}`}
          >
            <span>Итого{filtered ? " по фильтру" : ""}</span>
            <Metrics a={grand} mode={mode} />
          </div>
        </div>
      )}

      {leaves.length > 0 && (
        <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm" data-supplier-debt>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">Долг поставщику (с НДС, по всей организации)</span>
            <span className="font-semibold">{money(debt.debt)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
            Откуда цифра
            <InfoHint label="Как считается долг поставщику" wide>
              <p>
                Остаток по закупкам {money(debt.total.sub(debt.paid))} − авансы без привязки {money(debt.unlinkedAdvances)}
                {debt.total.sub(debt.paid).sub(debt.unlinkedAdvances).lessThan(0) ? " (авансы больше остатка — долг не ниже нуля)" : ""}.
              </p>
              <p className="mt-1">Стоимость закупок {money(debt.total)}, оплачено {money(debt.paid)} — те же суммы, что на Сводке и в «Оплатах».</p>
              <p className="mt-1">Год и другие фильтры на это число не влияют; 4% на долг не влияет (4% — только наценка на сырьё и подкладку в ТЗ).</p>
            </InfoHint>
          </div>
          {!filtered && mode === "incl" && grand.paidIncl.sub(debt.paid).abs().greaterThan(0.005) && (
            <div className="mt-0.5 text-xs text-neutral-500">
              В таблице «Оплачено» {money(grand.paidIncl)} — фактически внесено, включая переплату по отдельным закупкам ({money(grand.paidIncl.sub(debt.paid))}); в долге переплата одной закупки не гасит остаток другой.
            </div>
          )}
        </div>
      )}

      {leaves.length > 0 && (draftCount > 0 || advances.length > 0) && (
        <div className="flex flex-col gap-0.5 text-xs text-neutral-600" data-summary-notes>
          {draftCount > 0 && (
            <div>
              Из них не принято на склад: {money(draftFull)} ({draftCount} поз.) — расчётная стоимость.
            </div>
          )}
          {advances.length > 0 && (
            <div className="text-amber-700">
              Авансы без аукциона: {money(advancesTotal)} ({advances.length} п/п) — в «Оплачено» не входят.{" "}
              <Link href="/payments" className="underline">
                Распределить в «Оплатах»
              </Link>
            </div>
          )}
        </div>
      )}

      {leaves.length > 0 && (
        <div data-convergence={converges && (materialF || independentOk) ? "ok" : "mismatch"}>
          {converges && (materialF || independentOk) ? (
            <details className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
                <span aria-hidden>✓ </span>Итоги по годам, аукционам и типам сырья сходятся{roundingOnly ? " (в пределах округления 1 ₽)" : ""}
                <span className="ml-2 text-xs font-normal text-emerald-700 underline">как проверено</span>
              </summary>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                {views.map((v) => (
                  <li key={v.name}>
                    {v.name}: {money(pick(v.a).full)}
                  </li>
                ))}
                <li>итого: {money(gf.full)}</li>
              </ul>
              <div className="mt-1 text-xs text-emerald-800">
                {materialF
                  ? "Сверка с суммами закупок не делается при выборе сырья: в закупке учтена только часть позиций."
                  : `Совпадает и с суммами закупок: ${money(independent)}.`}
              </div>
            </details>
          ) : (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <div className="font-medium">Итоги не сходятся: расхождение {money(converges ? independentDiff : maxDiff)}</div>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                {views.map((v) => (
                  <li key={v.name}>
                    {v.name}: {money(pick(v.a).full)}
                  </li>
                ))}
                <li>итого: {money(gf.full)}</li>
                {!materialF && <li data-independent-check="mismatch">суммы закупок: {money(independent)}</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 text-xs text-neutral-500">
        Пояснения к таблице
        <InfoHint label="Как читать сводку" wide>
          <p>Год — по дате заказа закупки (выбирается в шапке); отменённые закупки не входят.</p>
          <p className="mt-1">«Цена шкур по счетам» — цена лотов по курсу (с НДС); «С расходами» — полная стоимость: плюс сборы аукциона, выделка, транспорт, брокер.</p>
          <p className="mt-1">Оплаты ведутся по закупке и аукциону; по сырью и лотам показаны пропорционально стоимости (в режиме «Без НДС» — той же долей).</p>
        </InfoHint>
      </div>
    </div>
  );
}
