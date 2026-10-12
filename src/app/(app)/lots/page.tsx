import { resolveAuctionValues } from "@/lib/auction-ref";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
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
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, filterHref, parseFilters, pick } from "@/lib/filters";
import { auctionLabeler, getFilterOptions } from "@/lib/filter-options";
import { loadFurLots } from "@/lib/fur-table-server";
import { loadDashboard } from "@/lib/dashboard-data";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { RawCards } from "../dashboard/raw-block";
import { PayTiles } from "../dashboard/pay-tiles";

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

  const [materials, auctions] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, unit: true, minStockLevel: true },
      orderBy: { name: "asc" },
    }),
    tab === "fur" ? loadAuctions(orgId, year) : Promise.resolve([]),
  ]);
  const aucOf = await auctionLabeler(orgId);
  const pyearOptions = (await getFilterOptions(orgId, year, ["pyear"])).pyear;

  // Режим «Аукцион»: каждое выбранное значение — точное название, иначе вхождение в название (без учёта регистра).
  const auctionValues = tab === "fur" ? await resolveAuctionValues(orgId, f.auction) : [];
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
  const furIdx = await getFurIndex(orgId);
  const canonOf = (name: string) => canonicalFur(name, furIdx)?.name ?? name;
  const materialIds = f.material.length
    ? materials.filter((m) => f.material.includes(m.id) || (m.unit !== "M" && f.material.includes(canonOf(m.name)))).map((m) => m.id)
    : [];
  const materialNames = f.material.map((v) => materials.find((m) => m.id === v)?.name ?? v);

  const canEditDocs = ["OWNER", "ADMIN", "PURCHASER"].includes(session.user.role);

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
        className={
          "inline-flex items-center rounded-md px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-md:min-h-10 " +
          (tab === t ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
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
        {await (async () => {
          // «Сводка по годам» — те же таблицы и подписи, что на Главной: динамика по годам и по сырью (год → мех / подкладка, вид → партия).
          const sf = parseDashFilters(sp);
          const c4 = await getCommission4Mode();
          const d = await loadDashboard(orgId, year, sf, c4);
          const info = { year: year === "all" ? "все годы" : `${year} год`, filters: null };
          return (
            <>
              <FilterBar
                title="Фильтры сводки"
                oneRow
                hideChips
                controls={[
                  { type: "multi", name: "auction", label: "Партия закупки (аукцион)", aliases: ["auc"], options: d.options.auction, allLabel: "Все партии" },
                  { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: d.options.fur },
                  { type: "multi", name: "color", label: "Цвет", options: d.options.color, allLabel: "Все цвета" },
                  ...(d.options.attr.length > 0 ? [{ type: "multi" as const, name: "attr", label: "Признак меха", options: d.options.attr, allLabel: "Все признаки" }] : []),
                ]}
              />
              <YearsTable rows={d.years} c4={c4} info={info} />
              <RawTable rows={d.rawTable} total={d.rawTableTotal} money={d.rawMoneyTotal} c4={c4} info={info} orderFilters={orderFiltersOn(sf)} />
            </>
          );
        })()}
      </div>
    );
  }

  const furOptions = materials.filter((m) => m.unit !== "M").map((m) => ({ value: m.id, label: m.name }));
  // Основа — выпадающий список «Партия закупки» с мультивыбором (быстрых чипов партий нет). Годы закупки в режиме таблицы
  // выбираются в самой таблице (там же вид меха, цвет, размер, остаток): параметр один — pyear.
  const filtersBlock = (
    <FilterBar
      title="Фильтры меха"
      controls={[
        { type: "multi", name: "auction", label: "Партии закупки (аукционы)", options: auctions.map((a) => ({ value: a.name, label: aucOf(a.name).label, count: a.count, title: aucOf(a.name).title })), allLabel: "Все партии", hint: "Выберите одну или несколько партий — откроются их счета и лоты" },
        { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "№ лота, материал, цвет, сорт" },
        ...(auctionMode ? [{ type: "multi" as const, name: "material", label: "Материал", options: furOptions, allLabel: "Все материалы" }, { type: "multi" as const, name: "pyear", label: "Год закупки", aliases: ["py"], options: pyearOptions, hint: "Дополнительно к году в шапке: сужает выбор внутри него" }] : []),
      ]}
    />
  );

  if (auctionMode) {
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
                Новая партия закупки
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
        {filtersBlock}
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
          <AuctionView
            organizationId={orgId}
            names={auctionNames}
            label={auctionLabel}
            q={q}
            materialIds={materialIds}
            pyear={f.pyear}
            canEdit={canEditDocs}
            view={auctionView}
          />
        )}
      </div>
    );
  }

  // Поиск и «?material=» (id материала либо название вида меха — «Лиса» включает и «Лиса красная») сужают сами лоты.
  const searchWhere = {
    ...(f.material.length ? { rawMaterialId: { in: materialIds.length > 0 ? materialIds : ["__none"] } } : {}),
  };
  // Таблицы «Мех» и «Подкладка»: строки-лоты, расчёт — src/lib/fur-table.ts (тот же, что на Сводке и в аналитике сырья).
  const tableLots = await loadFurLots(prisma, orgId, {
    kind: tab === "lining" ? "lining" : "fur",
    year,
    furIdx,
    extraWhere: tab === "lining" ? undefined : searchWhere,
  });

  // Плитки и таблица «Мех» сходятся с Главной: считаются той же функцией (с общим годом и без фильтров панели); к лотам добавлены
  // заказанное, но не полученное (FH 06.26, СП 09.26) и шкуры подрядчика.
  const c4Mode = await getCommission4Mode();
  const dash = await loadDashboard(orgId, year, parseDashFilters({}), c4Mode);
  // Деньги по лотам (доля аукциона по стоимости лота) — для фильтра «Оплата» и плиток оплат при фильтрах таблицы.
  const withMoney = (l: (typeof tableLots)[number]) => ({ ...l, paid: dash.lotMoney[l.id]?.paid ?? 0, due: dash.lotMoney[l.id]?.due ?? 0 });
  const furTabLots = tab === "fur" ? [...tableLots.map(withMoney), ...dash.syntheticLots] : tableLots.map(withMoney);
  const kindTitle = tab === "lining" ? "Подкладка" : "Мех";
  // Один ряд виджетов: «Сырьё | Оплаты» — шесть плиток в строку на мониторе, тонкая линия между группами (как на Главной).
  const tilesHeaderEnd = <Link href="/payments" className="text-xs text-blue-700 hover:underline print:hidden">→ Оплаты</Link>;
  const tiles = (
    <div key="raw-tiles" data-raw-tiles>
      <RawCards
        view={tab === "lining" ? "lining" : "fur"}
        rows={dash.rawTable}
        fur={dash.raw.fur}
        lining={dash.raw.lining}
        c4={c4Mode}
        headerEnd={tilesHeaderEnd}
        pay={<PayTiles bare d={dash} c4Mode={c4Mode} year={year} only={tab === "lining" ? "lining" : "fur"} />}
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
              <p>Куплено → использовано в ТЗ → остаток по видам меха (или по тканям подкладки). Клик по названию раскрывает строку до партий (аукционов) и лотов; галочка слева выбирает строку для тотала.</p>
              <p className="mt-1">
                Год ({year === "all" ? "все годы" : year}): в таблице только лоты закупок с датой заказа в выбранном году. Фильтр «Год закупки» в таблице сужает выбор внутри него.
              </p>
              <p className="mt-1">
                Стоимость = Σ(количество лота × цена лота за единицу); цена лота — как в закупке (по курсу, с НДС и расходами). Средневзвешенная цена = Σ ₽ ÷ Σ шт. (м). 4% не начисляется на «куплено» и «остаток»: оно считается только при списании сырья и подкладки в ТЗ — переключатель «С 4%» меняет «использовано».
              </p>
              <p className="mt-1">«Лиса красная» — это вид «Лиса» цвета «Красный».</p>
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
                  Новая партия закупки
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

      {tab === "fur" ? (
        <section aria-labelledby="raw-fur" className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 id="raw-fur" className="text-base font-semibold">{kindTitle}</h2>
            <InfoHint label="Как читать плитки сырья" wide>
              <p>Те же цифры, что в блоке «Сырьё» на Главной: <b>Куплено = Использовано + Остаток</b> (без 4%). 4% начисляется только при списании в ТЗ и показано в «Использовано» отдельной строкой «с 4%». Нажмите на плитку — цены по видам. Справа за тонкой линией: Оплачено и К оплате по меху (с НДС, 4% отдельно не добавляются).</p>
            </InfoHint>
          </div>
          <FurSelectionTotal noLotsKinds={(await loadFurKinds(orgId)).noLots} lots={furTabLots} kind="fur" globalYear={year} initialQuery={sp} raw={{ tiles, c4: c4Mode, fur: dash.raw.fur, lining: dash.raw.lining, headerEnd: tilesHeaderEnd, rows: dash.rawTable }} />
        </section>
      ) : (
        <section aria-labelledby="raw-lining" className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 id="raw-lining" className="text-base font-semibold">{kindTitle}</h2>
            <InfoHint label="Как читать плитки подкладки" wide>
              <p>Те же цифры, что в блоке «Сырьё» на Главной: <b>Куплено = Использовано + Остаток</b> (в метрах и в ₽, без 4%). 4% начисляется только при списании в ТЗ. Справа за тонкой линией: Оплачено и К оплате по подкладке (с НДС).</p>
            </InfoHint>
          </div>
          {/* Порядок: фильтры → ряд виджетов (плитки + формы подкладки) → таблица — это задаёт FurSelectionTotal. */}
          <FurSelectionTotal
            lots={furTabLots}
            kind="lining"
            globalYear={year}
            initialQuery={sp}
            raw={{
              tiles, c4: c4Mode, fur: dash.raw.fur, lining: dash.raw.lining, headerEnd: tilesHeaderEnd, rows: dash.rawTable,
            }}
          />
        </section>
      )}
    </div>
  );
}
