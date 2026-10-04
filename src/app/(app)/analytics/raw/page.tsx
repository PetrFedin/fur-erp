import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { YearNote } from "@/components/year-note";
import { Ref4 } from "@/components/c4-note";
import { Mode4Badge } from "@/components/c4-note";
import { formatMoney, formatQty } from "@/lib/utils";
import { isServiceAuction, shortAuctionName, NO_AUCTION_LABEL } from "@/lib/auction-names";
import {
  GROUPS, NO_AUCTION_KEY, aggOf, applyFilters, avgPrice, groupLots, groupUsage, isUsageBy, loadRawData, loadUsageRows, lotIssues, parseFilters, pctText, usedPct,
  type Agg, type Group, type GroupBy, type LotGroupBy, type RawFilters, type RawLot, type UsageGroup,
} from "@/lib/raw-analytics";
import { prisma } from "@/lib/prisma";
import { LazyDetails } from "../../lots/lazy-details";
import { loadGroupLots, loadUsageGroupLots } from "./lots-action";
import { LOT_COLS } from "./lot-rows";
import { USAGE_COLS, perUnit } from "./usage-rows";
import { CostCell } from "./cost-cell";
import { MonthlyChart, type MonthPoint } from "./monthly-chart";
import { COMMISSION_RATE } from "@/lib/commission4-const";

export const metadata = { title: "Аналитика сырья" };

const q2 = (d: Decimal) => d.toFixed(2);
const qty = (d: Decimal, unit: string) => `${formatQty(d.toString())} ${unit}`;
const rub = (d: Decimal) => formatMoney(q2(d));

export default async function RawAnalyticsPage({ searchParams }: PageProps<"/analytics/raw">) {
  const session = await requireSession();
  const sp = await searchParams;
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const { f, by } = parseFilters(sp);
  const [data, usage] = await Promise.all([
    loadRawData(session.user.organizationId, year),
    isUsageBy(by) ? loadUsageRows(session.user.organizationId, year) : Promise.resolve([] as Awaited<ReturnType<typeof loadUsageRows>>),
  ]);
  const unit = f.scope === "lining" ? "м" : "шт.";

  const scoped = data.lots.filter((l) => (f.scope === "lining") === (l.unit === "M"));
  const lots = applyFilters(data.lots, f);
  const total = aggOf(lots);
  const groups = isUsageBy(by) ? [] : groupLots(lots, by as LotGroupBy);
  const usageGroups: UsageGroup[] = isUsageBy(by)
    ? (() => {
        const ids = new Set(lots.map((l) => l.id));
        return groupUsage(usage.filter((r) => ids.has(r.lotId)), by);
      })()
    : [];
  const modelName = f.model ? (await prisma.productModel.findFirst({ where: { id: f.model, organizationId: session.user.organizationId }, select: { name: true } }))?.name ?? null : null;
  const otherQty = lots.reduce((s, l) => s.add(l.otherOut), new Decimal(0));
  const otherIncl = lots.reduce((s, l) => s.add(l.otherOut.mul(l.unitIncl)), new Decimal(0));
  const otherExcl = lots.reduce((s, l) => s.add(l.otherOut.mul(l.unitExcl)), new Decimal(0));
  const k4 = new Decimal(1).add(COMMISSION_RATE);

  const auctionOpts = Array.from(new Map(scoped.map((l) => [l.auction, l.auctionLabel])).entries()).sort((a, b) =>
    a[1].localeCompare(b[1], "ru", { numeric: true }),
  );
  const kindOpts = Array.from(new Set(scoped.map((l) => l.kind))).sort((a, b) => a.localeCompare(b, "ru"));

  const params = new URLSearchParams();
  params.set("g", by);
  if (f.scope === "lining") params.set("scope", "lining");
  if (f.auction) params.set("auction", f.auction);
  if (f.kind) params.set("kind", f.kind);
  if (f.onlyRem) params.set("rest", "1");
  if (f.q) params.set("q", f.q);
  if (f.model) params.set("m", f.model);
  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(over)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    return `/analytics/raw?${p.toString()}`;
  };

  // ───── графики ─────
  const byKind = groupLots(lots, "kind");
  const byAuction = groupLots(lots, "auction").sort((a, b) => b.agg.recv.comparedTo(a.agg.recv)).slice(0, 12);
  const months = new Map<string, MonthPoint>();
  for (const l of lots) {
    const m = months.get(l.month) ?? { month: l.month, qty: 0, incl: 0, excl: 0 };
    m.qty += l.recv.toNumber();
    m.incl += l.recv.mul(l.unitIncl).toNumber();
    m.excl += l.recv.mul(l.unitExcl).toNumber();
    months.set(l.month, m);
  }
  const monthPoints = Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month));
  const byYear = groupLots(lots, "year");

  // ───── качество данных (по всем лотам выбранного года, без фильтров таблицы) ─────
  const all = aggOf(data.lots);
  const noGrade = data.lots.filter((l) => l.gradeEmpty);
  const noSize = data.lots.filter((l) => l.unit !== "M" && l.size === "Не указан");
  const noAuction = data.lots.filter((l) => l.auction === NO_AUCTION_KEY || isServiceAuction(l.auction));
  const otherOutLots = data.lots.filter((l) => !l.otherOut.isZero());
  const gapLots = data.lots.filter((l) => !l.movementGap.isZero());
  const reconLots = data.lots.filter((l) => lotIssues(l).length > 0);
  const purchasedDiff = all.recv.sub(data.purchasedByItems);
  const usageDiff = all.used.sub(data.usageTotal);
  const issues =
    noGrade.length + otherOutLots.length + gapLots.length + data.movementsWithoutLot.count + data.receivedItemsWithoutLot +
    (purchasedDiff.isZero() ? 0 : 1) + (usageDiff.isZero() ? 0 : 1);

  const lotLink = (l: RawLot) => (
    <Link href={`/analytics/raw/lot/${l.id}`} className="underline hover:text-neutral-900">
      {l.lotNumber}
    </Link>
  );
  const lotList = (arr: RawLot[], extra?: (l: RawLot) => string) => (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {arr.slice(0, 40).map((l) => (
        <li key={l.id}>
          {lotLink(l)}
          {extra ? <span className="text-neutral-500"> ({extra(l)})</span> : null}
        </li>
      ))}
      {arr.length > 40 && <li className="text-neutral-500">…и ещё {arr.length - 40}</li>}
    </ul>
  );

  const pctAll = usedPct(total);
  const ex = (l: Decimal) => formatQty(l.toString());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Аналитика сырья
          <YearNote year={year} />
          <Mode4Badge mode={c4} />
          <InfoHint label="О странице" wide>
            <p>Куплено → использовано в ТЗ → остаток по аукционам, годам, видам меха, лотам, сортам и размерам. Источник — лоты склада: каждая принятая закупка создаёт лот, списания в ТЗ ссылаются на лот.</p>
            <p className="mt-1">Год — общий, из шапки (по дате заказа закупки). Для выбранного года считаются лоты закупок этого года и всё, что из них списано в ТЗ (в любом году).</p>
            <p className="mt-1">Деньги — по цене лота за единицу (с учётом курса, НДС и расходов закупки); «Без НДС» переключается в шапке. Среднее везде средневзвешенное: Σ(цена × кол-во) ÷ Σ кол-во. 4% (режим в шапке) показан справочной строкой «с 4%» и в самой цене лота не учтён.</p>
            <p className="mt-1">Мех (шт.) и подкладка (м) считаются отдельно — единицы разные.</p>
          </InfoHint>
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/analytics/raw/recon" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Сверка лотов{reconLots.length > 0 ? ` (${reconLots.length})` : ""}
          </Link>
          <a href={`/analytics/raw/export?${params.toString()}&part=groups`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            CSV: таблица
          </a>
          <a href={`/analytics/raw/export?${params.toString()}&part=lots`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            CSV: по лотам
          </a>
        </div>
      </div>

      {/* Мех / подкладка */}
      <div className="flex gap-1">
        {(["fur", "lining"] as const).map((s) => (
          <Link
            key={s}
            href={href({ scope: s === "fur" ? null : "lining", auction: null, kind: null })}
            className={"rounded-full border px-3 py-1 text-xs max-md:min-h-8 max-md:inline-flex max-md:items-center " + (f.scope === s ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")}
          >
            {s === "fur" ? "Мех (шт.)" : "Подкладка (м)"}
          </Link>
        ))}
      </div>

      {f.model && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Показаны лоты, из которых сделано изделие «{modelName ?? "—"}».
          <Link href={href({ m: null })} className="underline">Показать все</Link>
        </div>
      )}

      {/* Итоги */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile unit={unit} c4={c4}
          title="Куплено"
          q={total.recv}
          incl={total.recvIncl}
          excl={total.recvExcl}
          hint={
            <>
              <p>Σ «получено» по лотам. Стоимость = Σ(кол-во лота × цена лота за единицу).</p>
              <p className="mt-1">Сейчас: {qty(total.recv, unit)} в {lots.length} лотах. Сверка с закупками в статусе «Принята» — в блоке «Качество данных».</p>
            </>
          }
        />
        <Tile unit={unit} c4={c4}
          title="Использовано в ТЗ"
          q={total.used}
          incl={total.usedIncl}
          excl={total.usedExcl}
          extra={{ incl: total.usedExtraIncl, excl: total.usedExtraExcl }}
          hint={
            <>
              <p>Σ списаний сырья в ТЗ по этим лотам; стоимость — по цене лота на момент списания.</p>
              <p className="mt-1">Сейчас: {qty(total.used, unit)} = {pctText(pctAll)} от купленного.</p>
              <p className="mt-1">4% начисляется только на списания, где оно применяется (флаг строки), — строка «с 4%».</p>
            </>
          }
        />
        <Tile unit={unit} c4={c4}
          title="Списано иначе"
          q={otherQty}
          incl={otherIncl}
          excl={otherExcl}
          hint={
            <>
              <p>Получено − остаток − использовано в ТЗ. Это ручные корректировки остатка, потери и пр. — то, что ушло с лота не через ТЗ.</p>
              <p className="mt-1">Сейчас: {ex(total.recv)} − {ex(total.rem)} − {ex(total.used)} = <b>{ex(otherQty)}</b> {unit}. Должно быть 0, пока остаток меняется только ТЗ.</p>
            </>
          }
          sub={!otherQty.isZero() ? <div className="text-xs text-amber-700">есть расхождение — см. качество данных</div> : null}
        />
        <Tile unit={unit} c4={c4}
          title="Остаток"
          q={total.rem}
          incl={total.remIncl}
          excl={total.remExcl}
          extra={{ incl: total.remIncl.mul(k4.sub(1)), excl: total.remExcl.mul(k4.sub(1)) }}
          hint={
            <>
              <p>Σ остатков лотов. Стоимость = Σ(остаток лота × цена лота за единицу) — так же считает карточка «Итого стоимость остатков» на странице «Сырьё».</p>
              <p className="mt-1">Сейчас: {qty(total.rem, unit)} × средняя цена {avgPrice(total) ? rub(avgPrice(total)!.incl) : "—"} ≈ {rub(total.remIncl)} (средняя цена остатка может отличаться от средней закупки — остаток лежит в других лотах).</p>
            </>
          }
        />
        <div className="col-span-2 rounded-lg border border-neutral-200 bg-white p-3 lg:col-span-1">
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            % использовано
            <InfoHint label="% использовано">
              <p>Использовано ÷ куплено × 100.</p>
              <p className="mt-1">Сейчас: {ex(total.used)} ÷ {ex(total.recv)} = {pctText(pctAll)}.</p>
            </InfoHint>
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{pctText(pctAll)}</div>
          <div className="mt-2 flex h-2 overflow-hidden rounded bg-neutral-100" role="img" aria-label={`Использовано ${pctText(pctAll)}`}>
            <div className="bg-slate-500" style={{ width: `${Math.min(100, pctAll ?? 0)}%` }} />
          </div>
        </div>
      </div>

      {/* Фильтры */}
      <details className="rounded-md border border-neutral-200 bg-white" open>
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Фильтры</summary>
        <form method="get" className="grid grid-cols-2 items-end gap-2 border-t border-neutral-100 p-3 sm:grid-cols-5">
          <input type="hidden" name="g" value={by} />
          {f.model && <input type="hidden" name="m" value={f.model} />}
          {f.scope === "lining" && <input type="hidden" name="scope" value="lining" />}
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block text-xs text-neutral-500">Аукцион</label>
            <Select name="auction" defaultValue={f.auction}>
              <option value="">Все аукционы</option>
              {auctionOpts.map(([key, lab]) => (
                <option key={key} value={key}>{lab === NO_AUCTION_LABEL ? lab : key === NO_AUCTION_KEY ? lab : shortAuctionName(key, 60)}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Вид меха</label>
            <Select name="kind" defaultValue={f.kind}>
              <option value="">Все</option>
              {kindOpts.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Поиск по лоту / сорту</label>
            <Input name="q" defaultValue={f.q} placeholder="напр. 15016" title="Номер лота ищется в любом написании: без пробелов и дефисов, в любом регистре, кириллица = латиница" />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="rest" value="1" defaultChecked={f.onlyRem} className="size-4" />
            только с остатком
          </label>
          <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
            <Button type="submit" variant="outline">Применить</Button>
            <Link href={href({ auction: null, kind: null, rest: null, q: null, m: null })} className="text-sm text-neutral-500 hover:underline">Сбросить</Link>
          </div>
        </form>
      </details>

      {/* Сводная таблица */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Сводная таблица
            <InfoHint label="О таблице" wide>
              <p>Группируйте по аукциону, году закупки, виду меха, лоту, сорту/цвету или размеру. Строку можно развернуть: внутри — лоты с остатком, ценой и ТЗ, где использован лот.</p>
              <p className="mt-1"><b>Изделие (артикул)</b> и <b>ТЗ</b> — другой разрез: что ушло на каждое изделие или ТЗ (шкур или метров, ₽, на 1 изделие); строка раскрывается в лоты. У каждого лота есть карточка «Где использован» — в какие изделия он ушёл, учёт и остаток.</p>
              <p className="mt-1">Сорт/цвет и размер берутся из поля «сорт» лота: размер — это XXL, XL, L, M, S (если есть в тексте), сорт — остальной текст до размера. Не распознано — «Не указан».</p>
              <p className="mt-1"><b>Средняя цена</b> = Σ(кол-во × цена лота) ÷ Σ кол-во по лотам группы. <b>Стоимость остатка</b> = Σ(остаток × цена лота). Строка «с 4%» — справочно (режим в шапке).</p>
              {groups[0] && avgPrice(groups[0].agg) && (
                <p className="mt-1">Пример — «{groups[0].label}»: куплено {qty(groups[0].agg.recv, unit)} на {rub(groups[0].agg.recvIncl)} → {rub(groups[0].agg.recvIncl)} ÷ {ex(groups[0].agg.recv)} = {rub(avgPrice(groups[0].agg)!.incl)} за единицу.</p>
              )}
            </InfoHint>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-neutral-500">группировать по:</span>
            {GROUPS.map((g) => (
              <Link
                key={g.key}
                href={href({ g: g.key })}
                className={"rounded-full border px-3 py-1 max-md:min-h-8 max-md:inline-flex max-md:items-center " + (by === g.key ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")}
              >
                {g.label}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {isUsageBy(by) ? (
            <UsageTable groups={usageGroups} by={by} f={f} unit={unit} c4={c4} lots={lots.length} year={year} />
          ) : (
            <>
              <div className={`hidden gap-2 border-b border-neutral-200 px-3 pb-2 text-xs font-medium text-neutral-500 md:grid ${LOT_COLS}`}>
                <span>{GROUPS.find((g) => g.key === by)!.label}</span>
                <span>Куплено</span>
                <span>Использовано</span>
                <span className="inline-flex items-center gap-1">
                  В учёте
                  <InfoHint label="В учёте" wide>
                    <p>Остаток по журналу движений склада: приход − списания в ТЗ − прочие списания. Должен совпадать с колонкой «Остаток» (остаток самого лота). Расхождение подсвечивается красным, подробности — в карточке лота и в «Сверке лотов».</p>
                  </InfoHint>
                </span>
                <span>Остаток</span>
                <span>% исп.</span>
                <span>Ср. цена закупки</span>
                <span>Стоимость остатка</span>
              </div>
              {groups.length === 0 && <p className="py-6 text-center text-sm text-neutral-400">{year === "all" ? "Нет лотов по выбранным фильтрам" : `За ${year} год лотов по выбранным фильтрам нет`}</p>}
              {groups.map((g) => (
                <GroupRow key={g.key} g={g} by={by} f={f} unit={unit} c4={c4} />
              ))}
              {groups.length > 0 && (
                <div className={`grid grid-cols-2 gap-2 border-t-2 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-semibold ${LOT_COLS}`}>
                  <span className="col-span-2 md:col-span-1">Σ Итого ({lots.length} лотов)</span>
                  <Cells a={total} unit={unit} c4={c4} />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Графики */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Остаток по видам меха
              <InfoHint label="Остаток по видам" wide>
                <p>Длина полосы — сколько куплено; тёмная часть — использовано, зелёная — остаток. Видно, какого меха осталось больше всего.</p>
                {byKind[0] && <p className="mt-1">Например, «{byKind[0].label}»: куплено {ex(byKind[0].agg.recv)}, использовано {ex(byKind[0].agg.used)}, остаток {ex(byKind[0].agg.rem)} {unit}.</p>}
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Legend />
            <div className="mt-2 flex flex-col gap-2">
              {byKind.map((g) => {
                const max = Math.max(...byKind.map((x) => x.agg.recv.toNumber()), 1);
                return <StackBar key={g.key} label={g.label} agg={g.agg} max={max} unit={unit} />;
              })}
              {byKind.length === 0 && <p className="text-sm text-neutral-400">Нет данных.</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Использование по аукционам
              <InfoHint label="Использование по аукционам" wide>
                <p>Для каждого аукциона (до 12 крупнейших по объёму закупки) — доля купленного, уже ушедшая в ТЗ. Длина полосы — объём закупки.</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Legend />
            <div className="mt-2 flex flex-col gap-2">
              {byAuction.map((g) => {
                const max = Math.max(...byAuction.map((x) => x.agg.recv.toNumber()), 1);
                return <StackBar key={g.key} label={g.label} title={g.title} agg={g.agg} max={max} unit={unit} showPct />;
              })}
              {byAuction.length === 0 && <p className="text-sm text-neutral-400">Нет данных.</p>}
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Динамика закупок по месяцам
              <InfoHint label="Динамика закупок" wide>
                <p>Сколько принято в сырьё в каждом месяце (по дате заказа закупки): в {unit} или в ₽ (с учётом режима НДС из шапки). Переключатель — над графиком.</p>
                {byYear.length > 0 && (
                  <p className="mt-1">По годам: {byYear.map((y) => `${y.label} — ${ex(y.agg.recv)} ${unit} на ${rub(y.agg.recvIncl)}`).join("; ")}.</p>
                )}
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyChart points={monthPoints} unit={unit} />
            {byYear.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {byYear.map((y) => (
                  <span key={y.key}>
                    <b>{y.label}:</b> {qty(y.agg.recv, unit)}, <Money incl={q2(y.agg.recvIncl)} excl={q2(y.agg.recvExcl)} />
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Качество данных */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Качество данных
            <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (issues === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
              {issues === 0 ? "всё сходится" : `замечаний: ${issues}`}
            </span>
            <InfoHint label="О контроле" wide>
              <p>Проверки по всем лотам выбранного года (мех и подкладка вместе, без фильтров таблицы): сходятся ли «куплено» с закупками, «использовано» со списаниями, остаток с журналом движений.</p>
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <Check ok={purchasedDiff.isZero()} text={`Куплено по лотам = количество в принятых закупках: ${ex(all.recv)} и ${ex(data.purchasedByItems)}${purchasedDiff.isZero() ? "" : ` (разница ${ex(purchasedDiff)})`}. Мех и подкладка вместе.`} />
          <Check ok={usageDiff.isZero()} text={`Использовано по лотам = Σ списаний в ТЗ: ${ex(all.used)} и ${ex(data.usageTotal)}${usageDiff.isZero() ? "" : ` (разница ${ex(usageDiff)})`}.`} />
          <Check ok={otherOutLots.length === 0} text={otherOutLots.length === 0 ? "Остаток лота = получено − списано в ТЗ: у всех лотов." : `У ${otherOutLots.length} лотов остаток ≠ получено − списано в ТЗ (ушло не через ТЗ):`}>
            {otherOutLots.length > 0 && lotList(otherOutLots, (l) => `${ex(l.otherOut)}`)}
          </Check>
          <Check ok={gapLots.length === 0} text={gapLots.length === 0 ? "Остаток склада = Σ лотов: журнал движений сходится с остатком у всех лотов." : `У ${gapLots.length} лотов остаток склада расходится с журналом движений:`}>
            {gapLots.length > 0 && lotList(gapLots, (l) => `журнал − остаток = ${ex(l.movementGap)}`)}
          </Check>
          <Check ok={data.movementsWithoutLot.count === 0} text={data.movementsWithoutLot.count === 0 ? "Списаний и приходов без лота нет." : `Движений склада без лота: ${data.movementsWithoutLot.count} (на ${ex(data.movementsWithoutLot.qty)}).`} />
          <Check ok={data.receivedItemsWithoutLot === 0} text={data.receivedItemsWithoutLot === 0 ? "У каждой позиции принятой закупки есть лот." : `Позиций принятых закупок без лота: ${data.receivedItemsWithoutLot}.`} />
          <Check ok={noGrade.length === 0} warn text={noGrade.length === 0 ? "У всех лотов указан сорт или цвет." : `Лотов без сорта и цвета: ${noGrade.length} из ${data.lots.length} — их нельзя разнести по «Сорт / цвет»:`}>
            {noGrade.length > 0 && lotList(noGrade)}
          </Check>
          <Check ok={noSize.length === 0} warn text={noSize.length === 0 ? "У всех лотов меха распознан размер." : `Лотов меха без распознанного размера: ${noSize.length} — попадают в «Не указан» (размер ищется в тексте сорта: XXL, XL, L, M…).`} />
          <Check ok={noAuction.length === 0} warn text={noAuction.length === 0 ? "Все лоты привязаны к аукциону." : `Лотов без реального аукциона («Нет информации», доп. закупки и т. п.): ${noAuction.length}.`} />
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ title, hint, q, incl, excl, extra, sub, unit, c4 }: { unit: string; c4: "on" | "off"; title: string; hint: React.ReactNode; q: Decimal; incl: Decimal; excl: Decimal; extra?: { incl: Decimal; excl: Decimal } | null; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-1 text-xs text-neutral-500">
        {title}
        <InfoHint label={title} wide>{hint}</InfoHint>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{qty(q, unit)}</div>
      <div className="text-sm text-neutral-700 tabular-nums">
        <Money incl={q2(incl)} excl={q2(excl)} />
      </div>
      {extra && c4 === "on" && (
        <div className="text-xs text-neutral-500">
          с 4%: <Money incl={q2(incl.add(extra.incl))} excl={q2(excl.add(extra.excl))} />
        </div>
      )}
      {sub}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-4 text-xs text-neutral-600">
      <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-slate-500" /> использовано</span>
      <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-teal-700" /> остаток</span>
    </div>
  );
}

function StackBar({ label, title, agg, max, unit, showPct }: { label: string; title?: string; agg: Agg; max: number; unit: string; showPct?: boolean }) {
  const recv = agg.recv.toNumber();
  const used = agg.used.toNumber();
  const rem = agg.rem.toNumber();
  const w = (recv / max) * 100;
  return (
    <div title={`${title ?? label}: куплено ${formatQty(recv)}, использовано ${formatQty(used)}, остаток ${formatQty(rem)} ${unit}`}>
      <div className="flex justify-between gap-2 text-xs">
        <span className="truncate font-medium text-neutral-800">{label}</span>
        <span className="shrink-0 tabular-nums text-neutral-600">
          {showPct ? `${pctText(usedPct(agg))} · ` : ""}ост. {formatQty(rem)} {unit}
        </span>
      </div>
      <div className="mt-0.5 flex h-3 gap-0.5" style={{ width: `${Math.max(w, 1)}%` }}>
        {used > 0 && <div className="rounded-sm bg-slate-500" style={{ flexGrow: used }} />}
        {rem > 0 && <div className="rounded-sm bg-teal-700" style={{ flexGrow: rem }} />}
        {used <= 0 && rem <= 0 && <div className="flex-1 rounded-sm bg-neutral-200" />}
      </div>
    </div>
  );
}

function Check({ ok, warn, text, children }: { ok: boolean; warn?: boolean; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className={"mt-0.5 shrink-0 text-xs font-bold " + (ok ? "text-emerald-600" : warn ? "text-amber-600" : "text-red-600")} aria-label={ok ? "в порядке" : "замечание"}>
        {ok ? "✓" : warn ? "!" : "✗"}
      </span>
      <div>
        <span className={ok ? "text-neutral-700" : "text-neutral-900"}>{text}</span>
        {children}
      </div>
    </div>
  );
}

function Cells({ a, unit, c4 }: { a: Agg; unit: string; c4: "on" | "off" }) {
  const p = avgPrice(a);
  const lab = "block text-xs font-normal text-neutral-500 md:hidden";
  return (
    <>
      <span className="tabular-nums"><span className={lab}>Куплено</span>{qty(a.recv, unit)}</span>
      <span className="tabular-nums"><span className={lab}>Использовано</span>{qty(a.used, unit)}</span>
      <span className={"tabular-nums " + (a.jrem.equals(a.rem) ? "text-neutral-600" : "font-medium text-red-700")} title={a.jrem.equals(a.rem) ? undefined : "Остаток по журналу склада не равен остатку лотов"}>
        <span className={lab}>В учёте</span>{qty(a.jrem, unit)}
      </span>
      <span className="font-medium tabular-nums"><span className={lab}>Остаток</span>{qty(a.rem, unit)}</span>
      <span className="tabular-nums"><span className={lab}>% исп.</span>{pctText(usedPct(a))}</span>
      <span className="tabular-nums">
        <span className={lab}>Ср. цена закупки</span>
        {p ? <><Money incl={q2(p.incl)} excl={q2(p.excl)} /><Ref4 mode={c4} incl={q2(p.incl)} excl={q2(p.excl)} /></> : "—"}
      </span>
      <span className="tabular-nums">
        <span className={lab}>Стоимость остатка</span>
        <Money incl={q2(a.remIncl)} excl={q2(a.remExcl)} />
        <Ref4 mode={c4} incl={q2(a.remIncl)} excl={q2(a.remExcl)} />
      </span>
    </>
  );
}

function GroupRow({ g, by, f, unit, c4 }: { g: Group; by: GroupBy; f: RawFilters; unit: string; c4: "on" | "off" }) {
  return (
    <LazyDetails
      className="group border-b border-neutral-100"
      load={loadGroupLots.bind(null, by, g.key, f)}
      summary={
        <summary
          className={`grid cursor-pointer list-none grid-cols-2 gap-2 px-3 py-2 hover:bg-neutral-50 ${LOT_COLS} [&::-webkit-details-marker]:hidden`}
          title={g.title}
        >
          <span className="col-span-2 font-medium md:col-span-1">
            <span className="mr-1 inline-block text-neutral-400 transition-transform group-open:rotate-90">›</span>
            {g.label}
            <span className="ml-1 text-xs font-normal text-neutral-400">· {g.agg.lots} лот.</span>
          </span>
          <Cells a={g.agg} unit={unit} c4={c4} />
        </summary>
      }
    />
  );
}

function UsageTable({ groups, by, f, unit, c4, lots, year }: { groups: UsageGroup[]; by: "article" | "order"; f: RawFilters; unit: string; c4: "on" | "off"; lots: number; year: string }) {
  const lab = "block text-xs font-normal text-neutral-500 md:hidden";
  const tot = groups.reduce(
    (a, g) => ({ qty: a.qty.add(g.qty), incl: a.incl.add(g.incl), excl: a.excl.add(g.excl), ei: a.ei.add(g.extraIncl), ee: a.ee.add(g.extraExcl), produced: a.produced.add(g.produced) }),
    { qty: new Decimal(0), incl: new Decimal(0), excl: new Decimal(0), ei: new Decimal(0), ee: new Decimal(0), produced: new Decimal(0) },
  );
  const cells = (g: { orders: number; lots: number; produced: Decimal; qty: Decimal; incl: Decimal; excl: Decimal; extraIncl: Decimal; extraExcl: Decimal }, single: boolean) => {
    const pu = perUnit(g.qty, g.produced);
    return (
      <>
        <span className="tabular-nums"><span className={lab}>{single ? "Лотов" : "ТЗ / лотов"}</span>{single ? g.lots : `${g.orders} / ${g.lots}`}</span>
        <span className="tabular-nums"><span className={lab}>Произведено</span>{formatQty(g.produced.toString())} шт.</span>
        <span className="font-medium tabular-nums"><span className={lab}>Списано</span>{qty(g.qty, unit)}</span>
        <span className="tabular-nums"><span className={lab}>На 1 изделие</span>{pu ? `${formatQty(pu.toFixed(2))} ${unit}` : "—"}</span>
        <span className="tabular-nums"><span className={lab}>Стоимость списания</span><CostCell incl={g.incl} excl={g.excl} extraIncl={g.extraIncl} extraExcl={g.extraExcl} c4={c4} /></span>
        <span className="tabular-nums">
          <span className={lab}>Стоимость на 1 изделие</span>
          {g.produced.greaterThan(0) ? <Money incl={q2(g.incl.div(g.produced))} excl={q2(g.excl.div(g.produced))} /> : "—"}
        </span>
      </>
    );
  };
  return (
    <>
      <div className={`hidden gap-2 border-b border-neutral-200 px-3 pb-2 text-xs font-medium text-neutral-500 md:grid ${USAGE_COLS}`}>
        <span>{by === "article" ? "Изделие (артикул)" : "ТЗ"}</span>
        <span>{by === "article" ? "ТЗ / лотов" : "Лотов"}</span>
        <span>Произведено</span>
        <span>Списано</span>
        <span className="inline-flex items-center gap-1">
          На 1 изделие
          <InfoHint label="На 1 изделие" wide>
            <p>Списано ÷ произведено — средневзвешенно: Σ списано ÷ Σ произведено по всем ТЗ изделия, а не среднее из средних. Если в ТЗ идёт несколько лотов, цифра — общая по ним.</p>
          </InfoHint>
        </span>
        <span>Стоимость списания</span>
        <span>Стоимость на 1 изделие</span>
      </div>
      {groups.length === 0 && <p className="py-6 text-center text-sm text-neutral-400">{year === "all" ? "Нет списаний по выбранным фильтрам" : `За ${year} год списаний по выбранным фильтрам нет`}</p>}
      {groups.map((g) => (
        <LazyDetails
          key={g.key}
          className="group border-b border-neutral-100"
          load={loadUsageGroupLots.bind(null, by, g.key, f)}
          summary={
            <summary className={`grid cursor-pointer list-none grid-cols-2 gap-2 px-3 py-2 hover:bg-neutral-50 ${USAGE_COLS} [&::-webkit-details-marker]:hidden`}>
              <span className="col-span-2 font-medium md:col-span-1">
                <span className="mr-1 inline-block text-neutral-400 transition-transform group-open:rotate-90">›</span>
                {g.label}
                <span className="block pl-3 text-xs font-normal text-neutral-500">{g.sub}</span>
              </span>
              {cells(g, by === "order")}
            </summary>
          }
        />
      ))}
      {groups.length > 0 && (
        <div className={`grid grid-cols-2 gap-2 border-t-2 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-semibold ${USAGE_COLS}`}>
          <span className="col-span-2 md:col-span-1">Σ Итого ({groups.length} · лотов в выборке: {lots})</span>
          <span />
          <span className="tabular-nums"><span className={lab}>Произведено</span>{formatQty(tot.produced.toString())} шт.</span>
          <span className="tabular-nums"><span className={lab}>Списано</span>{qty(tot.qty, unit)}</span>
          <span className="tabular-nums"><span className={lab}>На 1 изделие</span>{tot.produced.greaterThan(0) ? `${formatQty(tot.qty.div(tot.produced).toFixed(2))} ${unit}` : "—"}</span>
          <span className="tabular-nums"><span className={lab}>Стоимость списания</span><CostCell incl={tot.incl} excl={tot.excl} extraIncl={tot.ei} extraExcl={tot.ee} c4={c4} /></span>
          <span />
        </div>
      )}
    </>
  );
}
