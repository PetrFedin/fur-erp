import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { shortAuctionName } from "@/lib/auction-names";
import { formatMoney, formatQty } from "@/lib/utils";
import { safeRatio } from "@/lib/weighted";
import { addLeaf, aggOf, emptyAgg, loadSummaryLeaves, type Agg, type Leaf } from "@/lib/purchase-summary";

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
        <span className={lab}>Закупка по цене лотов</span>
        <span>{money(f.price)}</span>
      </span>
      <span className={cell}>
        <span className={lab}>Полная стоимость</span>
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
      <span className={cell} title="Взвешено по количеству шкур: Σ цены лотов ÷ Σ шкур">
        <span className={lab}>Ср. цена шкуры</span>
        <span>{f.avgPrice == null ? "—" : money(f.avgPrice)}</span>
      </span>
      <span className={cell} title="Взвешено по количеству шкур: Σ полной стоимости ÷ Σ шкур">
        <span className={lab}>Ср. полная за шкуру</span>
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
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  a: Agg;
  mode: Mode;
  level: 0 | 1 | 2;
  open?: boolean;
  children: React.ReactNode;
}) {
  const indent = ["", "md:pl-4", "md:pl-8"][level];
  const tone = ["bg-neutral-50 font-semibold", "bg-white", "bg-white"][level];
  return (
    <details open={open} className="group border-t border-neutral-100 first:border-t-0">
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
      <div>{children}</div>
    </details>
  );
}

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
  searchParams,
}: {
  organizationId: string;
  searchParams: { year?: string; auction?: string; material?: string; vat?: string };
}) {
  const mode: Mode = searchParams.vat === "excl" ? "excl" : "incl";
  const all = await loadSummaryLeaves(organizationId);

  const years = [...new Set(all.map((l) => l.year))].sort((a, b) => b - a);
  const auctions = [...new Set(all.map((l) => l.auction))].sort(cmpRu);
  const materials = [...new Set(all.map((l) => l.material))].sort(cmpRu);
  const yearF = years.includes(Number(searchParams.year)) ? Number(searchParams.year) : null;
  const auctionF = auctions.includes(searchParams.auction ?? "") ? searchParams.auction! : "";
  const materialF = materials.includes(searchParams.material ?? "") ? searchParams.material! : "";

  const leaves = all.filter(
    (l) => (!yearF || l.year === yearF) && (!auctionF || l.auction === auctionF) && (!materialF || l.material === materialF),
  );
  const filtered = Boolean(yearF || auctionF || materialF);

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab: "summary" });
    if (yearF) p.set("year", String(yearF));
    if (auctionF) p.set("auction", auctionF);
    if (materialF) p.set("material", materialF);
    if (mode === "excl") p.set("vat", "excl");
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
    { name: "по аукционам", a: sumBy((l) => l.auction) },
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
  const converges = maxDiff.lessThan(0.01);

  const byYear = [...group(leaves, (l) => String(l.year)).entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
  const gf = figures(grand, mode);

  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="grid grid-cols-2 items-end gap-2 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-5">
        <input type="hidden" name="tab" value="summary" />
        {mode === "excl" && <input type="hidden" name="vat" value="excl" />}
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Год
          <Select name="year" defaultValue={yearF ? String(yearF) : ""}>
            <option value="">Все годы</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </label>
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
            <Link href={qs({ year: "", auction: "", material: "" })} className="text-sm text-neutral-500 hover:underline">
              Сбросить
            </Link>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="НДС">
        <span className="text-xs text-neutral-500">Суммы:</span>
        {(
          [
            ["incl", "С НДС"],
            ["excl", "Без НДС"],
          ] as const
        ).map(([m, text]) => (
          <Link
            key={m}
            href={qs({ vat: m === "excl" ? "excl" : "" })}
            aria-current={mode === m ? "page" : undefined}
            className={
              "rounded-md border px-3 py-1 text-sm " +
              (mode === m ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")
            }
          >
            {text}
          </Link>
        ))}
      </div>

      {leaves.length === 0 ? (
        <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">
          {filtered ? "По выбранным фильтрам закупок нет." : "Закупок пока нет."}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <div
            className={`hidden gap-x-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 md:grid ${COLS}`}
          >
            <span>Год / аукцион / сырьё / лот</span>
            <span className="text-right">Шкур</span>
            <span className="text-right">Закупка по цене лотов</span>
            <span className="text-right">Полная стоимость</span>
            <span className="text-right">Оплачено</span>
            <span className="text-right">Остаток</span>
            <span className="text-right" title="взвешено по количеству шкур">
              Ср. цена шкуры
            </span>
            <span className="text-right" title="взвешено по количеству шкур">
              Ср. полная за шкуру
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
              {[...group(yl, (l) => l.auction).entries()]
                .sort((a, b) => cmpRu(a[0], b[0]))
                .map(([auction, al]) => (
                  <Node key={auction} title={shortAuctionName(auction, 70)} sub={`${al.length} лот.`} a={aggOf(al)} mode={mode} level={1}>
                    {[...group(al, (l) => l.material).entries()]
                      .sort((a, b) => cmpRu(a[0], b[0]))
                      .map(([material, ml]) => (
                        <Node key={material} title={material} sub={`${ml.length} лот.`} a={aggOf(ml)} mode={mode} level={2}>
                          {ml.map((l) => (
                            <LotRow key={l.id} l={l} mode={mode} />
                          ))}
                        </Node>
                      ))}
                  </Node>
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
        <div
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (converges ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800")
          }
          data-convergence={converges ? "ok" : "mismatch"}
        >
          <div className="font-medium">
            {converges ? "Сходится" : `Расхождение ${money(maxDiff)}`}: сумма по годам = по аукционам = по типам сырья
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            {views.map((v) => (
              <li key={v.name}>
                {v.name}: {money(pick(v.a).full)}
              </li>
            ))}
            <li>итого: {money(gf.full)}</li>
          </ul>
        </div>
      )}

      <p className="text-xs text-neutral-500">
        Год — по дате закупки (для УПД-закупок тоже по дате закупки); отменённые закупки не входят. Средние считаются только
        взвешенно: Σ суммы ÷ Σ шкур. «Оплачено» ведётся на уровне закупки/аукциона; на уровне типа сырья и лота это
        распределение пропорционально полной стоимости. В режиме «Без НДС» оплаты пересчитаны той же долей.
      </p>
    </div>
  );
}
