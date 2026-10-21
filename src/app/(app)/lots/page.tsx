import { resolveAuctionValues } from "@/lib/auction-ref";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { furKindsOfOrder } from "@/lib/order-fur";
import { loadFurKinds } from "@/lib/fur-kinds-server";
import { purchaseIdsByAuction } from "@/lib/filter-options";
import { auctionName as auctionNameOf } from "@/lib/auction-names";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { YearsTable, RawTable } from "../dashboard/dynamics-tables";
import { orderFiltersOn, parseDashFilters } from "@/lib/dashboard-calc";
import { AuctionView, loadAuctions } from "./auction-view";
import { getYearFilter } from "@/lib/year-filter";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { YearNote } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { RawTab } from "@/components/raw-tabs";
import { FurSelectionTotal } from "@/components/fur-selection-total";
import { AuctionCompare } from "@/components/auction-compare";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, filterHref, parseFilters, pick } from "@/lib/filters";
import { auctionLabeler, getFilterOptions } from "@/lib/filter-options";
import { loadFurLots } from "@/lib/fur-table-server";
import { loadDashboard } from "@/lib/dashboard-data";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { RawCards } from "../dashboard/raw-block";
import { PriceCompositionBlock } from "../dashboard/price-composition-block";
import { priceComposition } from "@/lib/price-composition-server";
import { PayTiles } from "../dashboard/pay-tiles";
import { FurScope, ScopeEmpty, ScopeShow } from "@/components/fur-scope";

export const metadata = { title: "Сырьё" };

// Параметры страницы «Сырьё»: tab/view/vatmode — вид (не сбрасываются кнопкой «Сбросить всё»), остальное — фильтры.
// Фильтры внутри таблицы «Мех / Подкладка» (вид меха, цвет, размер, партия, остаток) хранятся там же в адресе (fur, color, size, batch, rest…).
const LOT_FILTERS = defineFilters({
  ...pick(["auction", "q", "material", "pyear", "attr", "tab", "view", "vatmode"], {
    tab: { allowed: ["fur", "lining", "summary"] },
    view: { allowed: ["invoices", "lots"] },
    vatmode: { aliases: ["vat"] },
    q: { label: "Поиск" },
  }),
});

export default async function RawStockPage({ searchParams }: PageProps<"/lots">) {
  const session = await requireSession();
  const sp = await searchParams;
  const year = await getYearFilter();
  const f = parseFilters(LOT_FILTERS, sp);
  const tab: "fur" | "lining" | "summary" = f.tab === "lining" ? "lining" : f.tab === "summary" ? "summary" : "fur";
  const q = tab === "summary" ? "" : f.q;
  // Вид режима «Аукцион»: по счетам (по умолчанию) или плоским списком лотов; сохраняется при фильтрах.
  const auctionView: "invoices" | "lots" = f.view === "lots" ? "lots" : "invoices";
  const orgId = session.user.organizationId;

  // Независимые загрузки идут одной пачкой (раньше — по очереди); результаты и расчёты те же.
  const [materials, auctions, aucOf, pyearOptionsAll, auctionValues, furIdx] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, unit: true, minStockLevel: true },
      orderBy: { name: "asc" },
    }),
    tab === "fur" ? loadAuctions(orgId, year) : Promise.resolve([]),
    auctionLabeler(orgId),
    getFilterOptions(orgId, year, ["pyear"]),
    tab === "fur" ? resolveAuctionValues(orgId, f.auction) : Promise.resolve([] as string[]),
    getFurIndex(orgId),
  ]);
  const pyearOptions = pyearOptionsAll.pyear;

  // Режим «Аукцион»: каждое выбранное значение — точное название, иначе вхождение в название (без учёта регистра).
  const auctionNames: string[] = [];
  const auctionMissing: string[] = [];
  for (const v of auctionValues) {
    const lower = v.toLowerCase();
    const exact = auctions.filter((a) => a.name.toLowerCase() === lower);
    const found = exact.length > 0 ? exact : auctions.filter((a) => a.name.toLowerCase().includes(lower));
    if (found.length === 0) auctionMissing.push(v);
    for (const a of found) if (!auctionNames.includes(a.name)) auctionNames.push(a.name);
  }
  const auctionMode = tab === "fur" && auctionValues.length > 0;
  // Старые ссылки /lots?auction=<партия подкладки> ведут на карточку партии подкладки (а не на страницу аукциона меха).
  if (auctionMode) {
    const ids = await purchaseIdsByAuction(orgId, auctionValues);
    if (ids.length) {
      const items = await prisma.purchaseItem.findMany({ where: { purchaseId: { in: ids } }, select: { rawMaterial: { select: { unit: true } }, purchase: { select: { auctionSession: true } } } });
      if (items.length > 0 && items.every((i) => i.rawMaterial.unit === "M")) redirect(`/lots/lining/${encodeURIComponent(auctionNameOf(items[0].purchase.auctionSession) ?? auctionValues[0])}`);
    }
  }
  const auctionLabel = auctionNames.length === 1 ? auctionNames[0] : `${auctionNames.length} партий закупки`;
  // Материал: id материала либо название вида меха («Лиса» включает «Лиса красная»).
  const canonOf = (name: string) => canonicalFur(name, furIdx)?.name ?? name;
  const materialIds = f.material.length
    ? materials.filter((m) => f.material.includes(m.id) || (m.unit !== "M" && f.material.includes(canonOf(m.name)))).map((m) => m.id)
    : [];

  const canEditDocs = ["OWNER", "ADMIN", "PURCHASER"].includes(session.user.role);
  // Весь раздел «Сырьё» внутри общего переключателя «Вся закупка / На аукционах / У поставщика» (как на Главной; ?fsrc= и sessionStorage).
  const scopeInfo = { year: year === "all" ? "все годы" : `${year} год`, filters: null };

  // Фильтры не теряются при смене вкладки: общие значения переносятся (у каждой вкладки свой набор).
  const tabLink = (t: "fur" | "lining" | "summary", label: string) => {
    const carry =
      t === "fur"
        ? { auction: f.auction, q: f.q, material: f.material, pyear: f.pyear, attr: f.attr, view: f.view, vatmode: "" }
        : t === "lining"
          ? { auction: [], q: f.q, material: [], pyear: [], attr: [], view: "", vatmode: "" }
          : { auction: f.auction, q: "", material: f.material, pyear: f.pyear, attr: f.attr, view: "", vatmode: f.vatmode };
    return (
      <Link
        href={filterHref(LOT_FILTERS, "/lots", { ...carry, tab: t === "fur" ? "" : t }, {})}
        aria-current={tab === t ? "page" : undefined}
        title={t === "summary" ? "Те же таблицы, что на Главной (динамика по годам и по сырью)" : undefined}
        className={
          "inline-flex items-center rounded-md px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-md:min-h-10 " +
          (tab === t ? "bg-neutral-900 text-white" : t === "summary" ? "ml-auto text-xs text-neutral-500 hover:bg-neutral-100" : "text-neutral-700 hover:bg-neutral-100")
        }
      >
        {label}
      </Link>
    );
  };

  if (tab === "summary") {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Сводка по годам" }]} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {/* «i» и метка года — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Сырьё О сводке». */}
            <div className="flex flex-wrap items-center">
              <h1 className="text-xl font-semibold">Сырьё</h1>
              <YearNote year={year} />
              <span className="ml-2 inline-flex">
                <InfoHint label="О сводке" wide>
                  <p>Сводка закупок по годам, аукционам и типам сырья. Год выбирается в шапке (Все / 2025 / 2026) и действует на всех страницах; год закупки — по дате заказа.</p>
                </InfoHint>
              </span>
            </div>
          </div>
        </div>
        <div role="navigation" aria-label="Разделы сырья" className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2">
          <RawTab href="/purchases" active={false}>
            Закупки
          </RawTab>
          {tabLink("fur", "Мех")}
          {tabLink("lining", "Подкладка")}
          {tabLink("summary", "Сводка по годам")}
        </div>
        <FurScope info={scopeInfo} section="raw">
        {await (async () => {
          // «Сводка по годам» — те же таблицы и подписи, что на Главной: динамика по годам и по сырью (год → мех / подкладка, вид → партия).
          const sf = parseDashFilters(sp);
          const c4 = await getCommission4Mode();
          const d = await loadDashboard(orgId, year, sf, c4);
          const info = { year: year === "all" ? "все годы" : `${year} год`, filters: null };
          return (
            <>
              <div className="print:hidden">
                <FilterBar
                  title="Фильтры сводки"
                  oneRow
                  hideChips
                  controls={[
                    { type: "multi", name: "auction", label: "Аукцион / закупка", aliases: ["auc"], options: d.options.auction, allLabel: "Все партии" },
                    { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: d.options.fur },
                    { type: "multi", name: "color", label: "Цвет", options: d.options.color, allLabel: "Все цвета" },
                    ...(d.options.attr.length > 0 ? [{ type: "multi" as const, name: "attr", label: "Признак меха", options: d.options.attr, allLabel: "Все признаки" }] : []),
                  ]}
                />
              </div>
              <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                Сводка по годам — на Главной:{" "}
                <Link href="/dashboard#years-table" className="text-blue-700 underline">Динамика по годам</Link>
                {" · "}
                <Link href="/dashboard#raw-table" className="text-blue-700 underline">Динамика по сырью</Link>
              </p>
              <details className="group">
                <summary className="cursor-pointer text-sm text-neutral-600 hover:text-neutral-900">Показать таблицы здесь</summary>
                <div className="mt-3 flex flex-col gap-4">
                  <YearsTable rows={d.years} bySrc={d.yearsFurBySrc} c4={c4} info={info} />
                  <RawTable auctionSrc={d.auctionSrc} rows={d.rawTable} total={d.rawTableTotal} money={d.rawMoneyTotal} c4={c4} info={info} orderFilters={orderFiltersOn(sf)} />
                </div>
              </details>
            </>
          );
        })()}
        </FurScope>
      </div>
    );
  }

  const furOptions = materials.filter((m) => m.unit !== "M").map((m) => ({ value: m.id, label: m.name }));
  // Основа — выпадающий список «Партия закупки» с мультивыбором (быстрых чипов партий нет). Годы закупки в режиме таблицы
  // выбираются в самой таблице (там же вид меха, цвет, размер, остаток): параметр один — pyear.
  const filtersBlockFor = (list: typeof auctions) => (
    <div className="print:hidden">
    <FilterBar
      title="Фильтры меха"
      oneRow
      hideChips
      controls={[
        { type: "multi", name: "auction", label: "Аукционы / закупки", options: list.map((a) => ({ value: a.name, label: aucOf(a.name).label, count: a.count, title: aucOf(a.name).title })), allLabel: "Все партии", hint: "Выберите одну или несколько партий — откроются их счета и лоты" },
        { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "№ лота, материал, цвет, сорт" },
        ...(auctionMode ? [{ type: "multi" as const, name: "material", label: "Материал", options: furOptions, allLabel: "Все материалы" }, { type: "multi" as const, name: "pyear", label: "Год закупки", aliases: ["py"], options: pyearOptions, hint: "Дополнительно к году в шапке: сужает выбор внутри него" }] : []),
      ]}
    />
    </div>
  );
  const filtersBlock = filtersBlockFor(auctions);

  if (auctionMode) {
    // Источник каждой партии (аукцион / поставщик) известен по закупкам; режим «На аукционах» / «У поставщика» оставляет только свои партии.
    const srcOf = (n: string) => auctions.find((a) => a.name === n)?.src ?? "supplier";
    const byName = { auction: auctionNames.filter((n) => srcOf(n) === "auction"), supplier: auctionNames.filter((n) => srcOf(n) === "supplier") };
    const onlySrc = byName.auction.length === 0 ? "supplier" : byName.supplier.length === 0 ? "auction" : null;
    const labelOf = (ns: string[]) => (ns.length === 1 ? ns[0] : `${ns.length} партий закупки`);
    const view = (ns: string[], lbl: string) => (
      <AuctionView organizationId={orgId} names={ns} label={lbl} q={q} materialIds={materialIds} pyear={f.pyear} canEdit={canEditDocs} view={auctionView} />
    );
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Мех", href: "/lots" }, { label: `Аукцион ${auctionLabel}` }]} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center">
              <h1 className="text-xl font-semibold">Сырьё</h1>
              <YearNote year={year} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEditDocs && (
              <Link href="/purchases/batch" className={buttonVariants({ variant: "outline" })}>
                + Закупка меха
              </Link>
            )}
            <Link href="/materials/new" className={`${buttonVariants()} max-md:order-first max-md:w-full`}>
              + Добавить материал
            </Link>
          </div>
        </div>
        <div role="navigation" aria-label="Разделы сырья" className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2">
          <RawTab href="/purchases" active={false}>
            Закупки
          </RawTab>
          {tabLink("fur", "Мех")}
          {tabLink("lining", "Подкладка")}
          {tabLink("summary", "Сводка по годам")}
        </div>
        <FurScope info={scopeInfo} section="raw">
        <ScopeShow src="all">{filtersBlock}</ScopeShow>
        <ScopeShow src="auction">{filtersBlockFor(auctions.filter((a) => a.src === "auction"))}</ScopeShow>
        <ScopeShow src="supplier">{filtersBlockFor(auctions.filter((a) => a.src === "supplier"))}</ScopeShow>
        {auctionMissing.length > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {auctionMissing.length === 1 ? "Аукцион" : "Аукционы"} «{auctionMissing.join("», «")}» не найден{auctionMissing.length === 1 ? "" : "ы"}
            {year === "all" ? "" : ` за ${year} год`}. Выберите название из списка или{" "}
            <Link href="/lots" className="underline">
              сбросьте фильтр
            </Link>
            .
          </p>
        )}
        {auctionNames.length > 0 && (
          <>
            {/* Одна партия — это либо аукцион, либо поставщик: в другом режиме её нет, и экран говорит об этом, а не молчит. */}
            <ScopeShow src={onlySrc ? ["all", onlySrc] : "all"}>{view(auctionNames, auctionLabel)}</ScopeShow>
            {!onlySrc && byName.auction.length > 0 ? <ScopeShow src="auction">{view(byName.auction, labelOf(byName.auction))}</ScopeShow> : null}
            {!onlySrc && byName.supplier.length > 0 ? <ScopeShow src="supplier">{view(byName.supplier, labelOf(byName.supplier))}</ScopeShow> : null}
            {onlySrc === "supplier" ? <ScopeShow src="auction"><ScopeEmpty title="Закупка не на аукционе" text={`${auctionLabel} — у поставщика. Выберите «У поставщика» или «Вся закупка».`} /></ScopeShow> : null}
            {onlySrc === "auction" ? <ScopeShow src="supplier"><ScopeEmpty title="Закупка на аукционе" text={`${auctionLabel} — на аукционе. Выберите «На аукционах» или «Вся закупка».`} /></ScopeShow> : null}
          </>
        )}
        </FurScope>
      </div>
    );
  }

  // Поиск и «?material=» (id материала либо название вида меха — «Лиса» включает и «Лиса красная») сужают сами лоты.
  const searchWhere = {
    ...(f.material.length ? { rawMaterialId: { in: materialIds.length > 0 ? materialIds : ["__none"] } } : {}),
  };
  // Таблицы «Мех» и «Подкладка»: строки-лоты, расчёт — src/lib/fur-table.ts (тот же, что на Сводке и в аналитике сырья).
  // Плитки и таблица «Мех» сходятся с Главной: считаются той же функцией (с общим годом и без фильтров панели); к лотам добавлены
  // заказанное, но не полученное (FH 06.26, СП 09.26) и шкуры подрядчика. Три независимых загрузки идут вместе.
  const c4AndDash = getCommission4Mode().then(async (c4) => ({ c4, dash: await loadDashboard(orgId, year, parseDashFilters({}), c4) }));
  const [tableLots, { c4: c4Mode, dash }, furKinds] = await Promise.all([
    loadFurLots(prisma, orgId, {
      kind: tab === "lining" ? "lining" : "fur",
      year,
      furIdx,
      extraWhere: tab === "lining" ? undefined : searchWhere,
    }),
    c4AndDash,
    loadFurKinds(orgId),
  ]);
  // Деньги по лотам (доля аукциона по стоимости лота) — для фильтра «Оплата» и плиток оплат при фильтрах таблицы.
  const withMoney = (l: (typeof tableLots)[number]) => ({ ...l, paid: dash.lotMoney[l.id]?.paid ?? 0, due: dash.lotMoney[l.id]?.due ?? 0 });
  const furTabLots = tab === "fur" ? [...tableLots.map(withMoney), ...dash.syntheticLots] : tableLots.map(withMoney);
  const kindTitle = tab === "lining" ? "Подкладка" : "Мех";
  // Один ряд виджетов: «Сырьё | Оплаты» — шесть плиток в строку на мониторе, тонкая линия между группами (как на Главной).
  const noLotsInfo = Object.fromEntries(furKinds.noLots.map((k) => {
    const os = furKinds.orders.filter((o) => furKindsOfOrder(o.fur).includes(k));
    return [k, { units: os.reduce((a, o) => a + o.qty, 0), orders: os.length, work: os.reduce((a, o) => a + o.work, 0) }];
  }));
  const tilesHeaderEnd = undefined; // ссылка «→ Оплаты» убрана: есть раздел «Оплаты» в меню
  const payTiles = <PayTiles bare d={dash} c4Mode={c4Mode} year={year} only={tab === "lining" ? "lining" : "fur"} />;
  const tiles = (
    <div key="raw-tiles" data-raw-tiles>
      <RawCards
        view={tab === "lining" ? "lining" : "fur"}
        rows={dash.rawTable}
        fur={dash.raw.fur}
        lining={dash.raw.lining}
        c4={c4Mode}
        headerEnd={tilesHeaderEnd}
        pay={payTiles}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: tab === "lining" ? "Подкладка" : "Мех" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {/* «i» и метка года — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Сырьё О странице…». */}
          <div className="flex flex-wrap items-center">
            <h1 className="text-xl font-semibold">Сырьё</h1>
            <YearNote year={year} />
            <span className="ml-2 inline-flex">
            <InfoHint label="О странице «Сырьё»" wide>
              <p>Куплено → использовано в ТЗ → остаток по видам меха (или тканям подкладки). Клик по названию раскрывает партии и лоты; галочка выбирает строку для итога.</p>
              <p className="mt-1">Год ({year === "all" ? "все годы" : year}): лоты закупок с датой заказа в этом году; «Год закупки» в таблице сужает выбор.</p>
              <p className="mt-1">Стоимость = Σ(количество × цена лота), цена — как в закупке (курс, НДС, расходы). Средняя цена = Σ ₽ ÷ Σ шт. (м). 4 % считается только при списании в ТЗ; «С 4 %» меняет «использовано».</p>
              <p className="mt-1">«Лиса красная» — вид «Лиса», цвет «Красный».</p>
            </InfoHint>
            </span>
          </div>
          <Link href="/analytics/raw" className="mt-1 inline-block text-sm text-neutral-600 underline hover:text-neutral-900">Аналитика сырья →</Link>
        </div>
        {/* Кнопки зависят от вкладки: «Подкладка» — одна «Купить подкладку» (вся закупка партии в одной форме); «Мех» — новая партия закупки и материал. */}
        <div className="flex flex-wrap gap-2">
          {tab === "lining" ? (
            canEditDocs && (
              <Link href="/purchases/lining/new" className={`${buttonVariants()} max-md:w-full`}>
                Купить подкладку
              </Link>
            )
          ) : (
            <>
              {canEditDocs && (
                <Link href="/purchases/batch" className={buttonVariants({ variant: "outline" })}>
                  + Закупка меха
                </Link>
              )}
              <Link href="/materials/new" className={`${buttonVariants()} max-md:order-first max-md:w-full`}>
                + Добавить материал
              </Link>
            </>
          )}
        </div>
      </div>

      <div role="navigation" aria-label="Разделы сырья" className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2">
        <RawTab href="/purchases" active={false}>
            Закупки
          </RawTab>
          {tabLink("fur", "Мех")}
        {tabLink("lining", "Подкладка")}
        {tabLink("summary", "Сводка по годам")}
      </div>

      <FurScope info={scopeInfo} section="raw">
      {tab === "fur" ? (
        <section aria-labelledby="raw-fur" className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 id="raw-fur" className="text-base font-semibold">{kindTitle}</h2>
            <InfoHint label="Как читать плитки сырья" wide>
              <p>Цифры те же, что на Главной: <b>Куплено = Использовано + Остаток</b> (без 4 %). Нажмите на плитку — цены по видам. Справа: Оплачено и К оплате по меху (с НДС).</p>
            </InfoHint>
          </div>
          <FurSelectionTotal noLotsKinds={furKinds.noLots} noLotsInfo={noLotsInfo} lots={furTabLots} kind="fur" globalYear={year} initialQuery={sp} widgets={<FurSelectionTotal variant="years" lots={furTabLots} kind="fur" globalYear={year} />} raw={{ tiles, c4: c4Mode, fur: dash.raw.fur, lining: dash.raw.lining, headerEnd: tilesHeaderEnd, rows: dash.rawTable, pay: payTiles }} />
          <PriceCompositionBlock lots={(await priceComposition(orgId, dash)).lots} href="/lots" />
          <AuctionCompare lots={furTabLots} />
        </section>
      ) : (
        <section aria-labelledby="raw-lining" className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 id="raw-lining" className="text-base font-semibold">{kindTitle}</h2>
            <InfoHint label="Как читать плитки подкладки" wide>
              <p>Цифры те же, что на Главной: <b>Куплено = Использовано + Остаток</b> (м и ₽, без 4 %). Справа: Оплачено и К оплате по подкладке (с НДС).</p>
            </InfoHint>
          </div>
          {/* Порядок: фильтры → ряд виджетов (плитки + формы подкладки) → таблица — это задаёт FurSelectionTotal. */}
          <FurSelectionTotal
            lots={furTabLots}
            kind="lining"
            globalYear={year}
            initialQuery={sp}
            raw={{
              tiles, c4: c4Mode, fur: dash.raw.fur, lining: dash.raw.lining, headerEnd: tilesHeaderEnd, rows: dash.rawTable, pay: payTiles,
            }}
          />
        </section>
      )}
      </FurScope>
    </div>
  );
}
