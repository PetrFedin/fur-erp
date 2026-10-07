import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import Link from "next/link";
import { cleanSearch, escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { FilterPanel } from "@/components/filter-panel";
import { loadFurLots } from "@/lib/fur-table-server";

export const metadata = { title: "Сырьё" };

export default async function RawStockPage({ searchParams }: PageProps<"/lots">) {
  const session = await requireSession();
  const sp = await searchParams;
  const year = await getYearFilter();
  const tab: "fur" | "lining" | "summary" = sp.tab === "lining" ? "lining" : sp.tab === "summary" ? "summary" : "fur";
  const q = cleanSearch(sp.q);
  const materialId = cleanSearch(sp.material);
  const auctionQ = tab === "fur" ? cleanSearch(sp.auction, 200) : "";
  // Вид режима «Аукцион»: по счетам (по умолчанию) или плоским списком лотов; сохраняется при фильтрах.
  const auctionView: "invoices" | "lots" = cleanSearch(sp.view, 20) === "lots" ? "lots" : "invoices";

  const [materials, auctions] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, name: true, unit: true, minStockLevel: true },
      orderBy: { name: "asc" },
    }),
    tab === "fur" ? loadAuctions(session.user.organizationId, year) : Promise.resolve([]),
  ]);

  // Режим «Аукцион»: выбранное название — точное совпадение, иначе вхождение (без учёта регистра).
  const lowerQ = auctionQ.toLowerCase();
  const exact = auctions.filter((a) => a.name.toLowerCase() === lowerQ);
  const auctionNames = auctionQ
    ? (exact.length > 0 ? exact : auctions.filter((a) => a.name.toLowerCase().includes(lowerQ))).map((a) => a.name)
    : [];
  const auctionMode = tab === "fur" && Boolean(auctionQ);
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

  const tabLink = (t: string, label: string) => (
    <Link
      href={t === "fur" ? "/lots" : `/lots?tab=${t}`}
      className={
        "rounded-md px-3 py-1.5 text-sm " +
        (tab === t ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
      }
    >
      {label}
    </Link>
  );

  if (tab === "summary") {
    const one = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : undefined);
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
          organizationId={session.user.organizationId}
          year={year}
          searchParams={{ auction: one(sp.auction), material: one(sp.material), vat: one(sp.vat) }}
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
  const isActiveName = (name: string) => auctionNames.length === 1 && auctionNames[0] === name;
  const auctionChip = (a: (typeof auctions)[number]) => {
    const active = auctionNames.length === 1 && auctionNames[0] === a.name;
    return (
      <Link
        key={a.name}
        href={`/lots?auction=${encodeURIComponent(a.name)}${auctionView === "lots" ? "&view=lots" : ""}`}
        className={
          "rounded-full border px-3 py-1 text-xs max-md:inline-flex max-md:min-h-8 max-md:items-center " +
          (active
            ? "border-neutral-900 bg-neutral-900 text-white"
            : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")
        }
        title={`${a.name} — ${pluralPurchases(a.count)} · ${auctionStatusText(a)}${docInfo.get(a.name) ? ` · ${docInfo.get(a.name)!.text}` : ""}`}
      >
        {docInfo.get(a.name) && <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${docInfo.get(a.name)!.dot}`} />}
        {shortAuctionName(a.name)} <span className={active ? "text-neutral-300" : "text-neutral-400"}>· {a.count}</span>
      </Link>
    );
  };
  const filtersBlock = (
    <FilterPanel title="Фильтры сырья" applied={Boolean(q || materialId || auctionQ)}>
      {auctions.length > 0 && (
        <div className="mb-3 border-b border-neutral-200 pb-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Партии закупки (аукционы) — открыть счета и лоты одной партии</div>
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
      )}
        <form className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4" method="get">
          {auctionView === "lots" && <input type="hidden" name="view" value="lots" />}
          {auctionQ && <input type="hidden" name="auction" value={auctionQ} />}
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-neutral-500">Поиск по № лота, материалу, цвету, сорту</label>
            <Input name="q" defaultValue={q} placeholder="напр. 15016 или соболь" />
          </div>
          {auctionMode && (
          <div>
              <label className="mb-1 block text-xs text-neutral-500">Материал</label>
              <Select name="material" defaultValue={materialId}>
                <option value="">Все материалы</option>
                {materials
                  .filter((m) => m.unit !== "M")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="outline">
              Найти
            </Button>
            <Link
              href={auctionQ ? `/lots?auction=${encodeURIComponent(auctionQ)}${auctionView === "lots" ? "&view=lots" : ""}` : "/lots"}
              className="flex items-center text-sm text-neutral-500 hover:underline"
            >
              Сбросить
            </Link>
          </div>
        </form>
      </FilterPanel>
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
        {auctionNames.length === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Аукцион «{auctionQ}» не найден{year === "all" ? "" : ` за ${year} год`}. Выберите название из списка или{" "}
            <Link href="/lots" className="underline">
              сбросьте фильтр
            </Link>
            .
          </p>
        ) : (
          <AuctionView
            organizationId={session.user.organizationId}
            names={auctionNames}
            label={auctionNames.length === 1 ? auctionNames[0] : auctionQ}
            q={q}
            materialId={materialId}
            canEdit={canEditDocs}
            view={auctionView}
          />
        )}
      </div>
    );
  }

  const orgId = session.user.organizationId;
  const furIdx = await getFurIndex(orgId);
  const canonOf = (name: string) => canonicalFur(name, furIdx)?.name ?? name;

  // Поиск и «?material=» (id материала либо название вида меха — «Лиса» включает и «Лиса красная») сужают сами лоты.
  const materialIds = materialId
    ? materials.filter((m) => m.id === materialId || (m.unit !== "M" && canonOf(m.name) === materialId)).map((m) => m.id)
    : [];
  const searchWhere = {
    ...(materialId ? { rawMaterialId: { in: materialIds.length > 0 ? materialIds : ["__none"] } } : {}),
    ...(q
      ? {
          OR: [
            { lotNumber: { contains: escapeLike(q), mode: "insensitive" as const } },
            { color: { contains: escapeLike(q), mode: "insensitive" as const } },
            { grade: { contains: escapeLike(q), mode: "insensitive" as const } },
            { rawMaterial: { name: { contains: escapeLike(q), mode: "insensitive" as const } } },
          ],
        }
      : {}),
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
          {filtersBlock}

          <Card>
            <CardHeader>
              <CardTitle>Мех</CardTitle>
            </CardHeader>
            <CardContent>
              <FurSelectionTotal lots={tableLots} kind="fur" globalYear={year} initialQuery={sp} />
            </CardContent>
          </Card>
        </>
      ) : (
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
      )}
    </div>
  );
}
