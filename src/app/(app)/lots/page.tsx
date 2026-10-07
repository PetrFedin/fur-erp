import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { LiningPurchaseForm } from "./lining-purchase-form";
import { PurchaseSummary } from "./summary-view";
import { AuctionView, auctionStatusText, loadAuctions, pluralPurchases } from "./auction-view";
import { getYearFilter } from "@/lib/year-filter";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { YearNote } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { loadAuctionPanels } from "@/lib/auction-doc-checklist";
import { TONE_DOT, overallTone, payShort } from "@/lib/doc-panel";
import { FurSelectionTotal } from "@/components/fur-selection-total";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, filterHref, parseFilters, pick } from "@/lib/filters";
import { getFilterOptions } from "@/lib/filter-options";
import { loadFurLots } from "@/lib/fur-table-server";

export const metadata = { title: "Сырьё" };

// Параметры страницы «Сырьё»: tab/view/vatmode — вид (не сбрасываются кнопкой «Сбросить всё»), остальное — фильтры.
// Фильтры внутри таблицы «Мех / Подкладка» (вид меха, цвет, размер, партия, остаток) хранятся там же в адресе (fur, color, size, batch, rest…).
const LOT_FILTERS = defineFilters({
  ...pick(["auction", "q", "material", "pyear", "tab", "view", "vatmode"], {
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
  const pyearOptions = (await getFilterOptions(orgId, year, ["pyear"])).pyear;

  // Режим «Аукцион»: каждое выбранное значение — точное название, иначе вхождение в название (без учёта регистра).
  const auctionValues = tab === "fur" ? f.auction : [];
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
  const auctionLabel = auctionNames.length === 1 ? auctionNames[0] : `${auctionNames.length} партий закупки`;
  // Материал: id материала либо название вида меха («Лиса» включает «Лиса красная»).
  const furIdx = await getFurIndex(orgId);
  const canonOf = (name: string) => canonicalFur(name, furIdx)?.name ?? name;
  const materialIds = f.material.length
    ? materials.filter((m) => f.material.includes(m.id) || (m.unit !== "M" && f.material.includes(canonOf(m.name)))).map((m) => m.id)
    : [];
  const materialNames = f.material.map((v) => materials.find((m) => m.id === v)?.name ?? v);

  const canEditDocs = ["OWNER", "ADMIN", "PURCHASER"].includes(session.user.role);
  // Индикатор у чипа аукциона: цветная точка (нет документов / не оплачено — красная, частично или нет платёжки — жёлтая, всё есть — зелёная).
  const docInfo = new Map<string, { dot: string; text: string }>();
  if (tab === "fur") {
    for (const d of await loadAuctionPanels(prisma, session.user.organizationId, { canUpload: false, canMark: false })) {
      const tone = overallTone(d.panel.missingCount, d.panel.pay, d.panel.proofMissing);
      const parts = [d.panel.missingCount > 0 ? `нет документов: ${d.panel.missingCount}` : "документы есть", payShort(d.panel.pay)];
      if (d.panel.proofMissing > 0) parts.push(`платёжек нет: ${d.panel.proofMissing}`);
      docInfo.set(d.key, { dot: TONE_DOT[tone], text: parts.join(", ") });
    }
  }

  // Фильтры не теряются при смене вкладки: общие значения переносятся (у каждой вкладки свой набор).
  const tabLink = (t: "fur" | "lining" | "summary", label: string) => {
    const carry =
      t === "fur"
        ? { auction: f.auction, q: f.q, material: f.material, pyear: f.pyear, view: f.view, vatmode: "" }
        : t === "lining"
          ? { auction: [], q: f.q, material: [], pyear: [], view: "", vatmode: "" }
          : { auction: f.auction, q: "", material: f.material, pyear: f.pyear, view: "", vatmode: f.vatmode };
    return (
      <Link
        href={filterHref(LOT_FILTERS, "/lots", { ...carry, tab: t === "fur" ? "" : t }, {})}
        className={
          "rounded-md px-3 py-1.5 text-sm " +
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">
              Сырьё
              <YearNote year={year} />
              <InfoHint label="О сводке" wide>
                <p>Сводка закупок по годам, аукционам и типам сырья. Год выбирается в шапке (Все / 2025 / 2026) и действует на всех страницах; год закупки — по дате заказа.</p>
              </InfoHint>
            </h1>
          </div>
        </div>
        <div className="flex gap-1 border-b border-neutral-200 pb-2">
          {tabLink("fur", "Мех")}
          {tabLink("lining", "Подкладка")}
          {tabLink("summary", "Сводка по годам")}
        </div>
        <PurchaseSummary
          organizationId={orgId}
          year={year}
          filters={{ auction: f.auction, material: materialNames, pyear: f.pyear, vatmode: f.vatmode as "incl" | "excl" | "" }}
          yearOptions={pyearOptions}
        />
      </div>
    );
  }

  const CHIPS_SHOWN = 6;
  // Служебные записи («Нет информации», «Не в реестре остатков…») — отдельной группой «Прочее» в конце.
  const realAuctions = auctions.filter((a) => !isServiceAuction(a.name));
  const serviceAuctions = auctions.filter((a) => isServiceAuction(a.name));
  const auctionChips = realAuctions.slice(0, CHIPS_SHOWN);
  const moreAuctions = realAuctions.slice(CHIPS_SHOWN);
  const isActiveName = (name: string) => auctionNames.includes(name);
  // Быстрый выбор одной партии кликом (ссылка остаётся `/lots?auction=…`); поиск, материал, год и вид сохраняются.
  const carryHere = { auction: [] as string[], q: f.q, material: f.material, pyear: f.pyear, view: f.view, tab: "", vatmode: "" };
  const auctionChip = (a: (typeof auctions)[number]) => {
    const only = auctionNames.length === 1 && auctionNames[0] === a.name;
    const active = isActiveName(a.name);
    return (
      <Link
        key={a.name}
        href={filterHref(LOT_FILTERS, "/lots", carryHere, { auction: only ? [] : [a.name] })}
        aria-pressed={active}
        className={
          "rounded-full border px-3 py-1 text-xs max-md:inline-flex max-md:min-h-8 max-md:items-center " +
          (active
            ? "border-neutral-900 bg-neutral-900 text-white"
            : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")
        }
        title={`${a.name} — ${pluralPurchases(a.count)} · ${auctionStatusText(a)}${docInfo.get(a.name) ? ` · ${docInfo.get(a.name)!.text}` : ""}${only ? " · клик — снять выбор" : ""}`}
      >
        {docInfo.get(a.name) && <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${docInfo.get(a.name)!.dot}`} />}
        {shortAuctionName(a.name)} <span className={active ? "text-neutral-300" : "text-neutral-400"}>· {a.count}</span>
      </Link>
    );
  };
  const furOptions = materials.filter((m) => m.unit !== "M").map((m) => ({ value: m.id, label: m.name }));
  const quickChips =
    auctions.length > 0 ? (
      <div className="mt-3 border-t border-neutral-200 pt-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Партии закупки (аукционы) — быстро открыть счета и лоты одной партии</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {auctionChips.map(auctionChip)}
          {moreAuctions.length > 0 && (
            <details className="group/more" open={moreAuctions.some((a) => isActiveName(a.name))}>
              <summary className="cursor-pointer list-none rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 max-md:inline-flex max-md:min-h-8 max-md:items-center [&::-webkit-details-marker]:hidden">
                <span className="group-open/more:hidden">ещё {moreAuctions.length}</span>
                <span className="hidden group-open/more:inline">скрыть</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">{moreAuctions.map(auctionChip)}</div>
            </details>
          )}
          {serviceAuctions.length > 0 && (
            <details className="group/other" open={serviceAuctions.some((a) => isActiveName(a.name))}>
              <summary className="cursor-pointer list-none rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 max-md:inline-flex max-md:min-h-8 max-md:items-center [&::-webkit-details-marker]:hidden">
                Без подтверждённой партии ({serviceAuctions.length})
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">{serviceAuctions.map(auctionChip)}</div>
            </details>
          )}
        </div>
      </div>
    ) : null;
  // Основа — выпадающий список «Партии закупки» с мультивыбором; быстрые чипы — под ним. Годы закупки в режиме таблицы
  // выбираются в самой таблице (там же вид меха, цвет, размер, остаток): параметр один — pyear.
  const filtersBlock = (
    <FilterBar
      title="Фильтры меха"
      footer={quickChips}
      controls={[
        { type: "multi", name: "auction", label: "Партии закупки (аукционы)", options: auctions.map((a) => ({ value: a.name, label: shortAuctionName(a.name, 56), count: a.count, title: a.name })), allLabel: "Все партии", hint: "Выберите одну или несколько партий — откроются их счета и лоты" },
        { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "№ лота, материал, цвет, сорт" },
        ...(auctionMode ? [{ type: "multi" as const, name: "material", label: "Материал", options: furOptions, allLabel: "Все материалы" }, { type: "multi" as const, name: "pyear", label: "Год закупки", aliases: ["py"], options: pyearOptions, hint: "Дополнительно к году в шапке: сужает выбор внутри него" }] : []),
      ]}
    />
  );

  if (auctionMode) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">
              Сырьё
              <YearNote year={year} />
            </h1>
          </div>
          <Link href="/materials/new" className={buttonVariants()}>
            + Добавить материал
          </Link>
        </div>
        <div className="flex gap-1 border-b border-neutral-200 pb-2">
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            Сырьё
            <YearNote year={year} />
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
          </h1>
          <Link href="/analytics/raw" className="mt-1 inline-block text-sm text-neutral-600 underline hover:text-neutral-900">Аналитика сырья →</Link>
        </div>
        <Link
          href={tab === "lining" ? "/materials/new?unit=M" : "/materials/new"}
          className={buttonVariants()}
        >
          + Добавить материал
        </Link>
      </div>

      <div className="flex gap-1 border-b border-neutral-200 pb-2">
        {tabLink("fur", "Мех")}
        {tabLink("lining", "Подкладка")}
        {tabLink("summary", "Сводка по годам")}
      </div>

      {tab === "fur" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Мех</CardTitle>
            </CardHeader>
            <CardContent>
              <FurSelectionTotal lots={tableLots} kind="fur" globalYear={year} initialQuery={sp} barFooter={quickChips} />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
        <Card>
          <CardHeader>
            <CardTitle>Подкладка</CardTitle>
          </CardHeader>
          <CardContent>
            <LiningPurchaseForm
              materials={materials
                .filter((m) => m.unit === "M")
                .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }))
                .map((m) => ({ id: m.id, name: m.name }))}
            />
            <FurSelectionTotal lots={tableLots} kind="lining" globalYear={year} initialQuery={sp} />
          </CardContent>
        </Card>
        </>
      )}
    </div>
  );
}
