import Link from "next/link";
import { formatQty, formatDec1 } from "@/lib/utils";
import { Money } from "@/components/money";
import { RowCard } from "@/components/responsive-rows";
import { ArticleName } from "@/components/article-name";
import { CostTwo } from "@/components/cost-two";
import { NO_GROUP } from "@/lib/category-groups";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { ArticleShopEditor } from "@/components/article-shop-editor";
import { galleryExtras } from "@/lib/article-photo-color";
import type { loadPhotoSummary, loadAllShopLinks } from "@/lib/article-photos";
import type { ArticleLike } from "@/lib/article-label";
import type { ArticleMetrics } from "@/lib/article-metrics";
import { deleteArticlePhoto, deleteAllArticlePhotos } from "../../models/photo-actions";
import { ArticlePriceForm } from "../price-form";
import { ActiveToggle } from "../active-toggle";

export type ArticleCardRow = {
  id: string;
  name: string;
  isActive: boolean;
  model: ArticleLike;
  group: string;
  primaryFur: string | null;
  colors: string[];
  qty: number;
  costIncl: number;
  met: ArticleMetrics;
  markup: number | null;
  mu110: number | null;
  orderCount: number;
  plus: { plu: string; label: string }[];
  ownPrice: string;
  listOnly: boolean;
  sellingPrice: number | null;
};

// Карточки строк «Изделий» на телефоне (на ≥ md — таблица).
export function ArticleCards({
  rows,
  photoSummary,
  shopLinksAll,
  colorRefs,
  canCreate,
  perItem,
  fmtX,
}: {
  rows: ArticleCardRow[];
  photoSummary: Awaited<ReturnType<typeof loadPhotoSummary>>;
  shopLinksAll: Awaited<ReturnType<typeof loadAllShopLinks>>;
  colorRefs: Parameters<typeof galleryExtras>[2];
  canCreate: boolean;
  perItem: (q: number, n: number) => string;
  fmtX: (v: number) => string;
}) {
  return (
    <>
      {rows.map((r) => (
        <RowCard
          key={r.id}
          className={r.isActive ? "" : "opacity-60"}
          title={<ArticleName model={r.model} compact />}
          subtitle={[r.model.category?.trim(), r.group !== NO_GROUP ? r.group : null, r.primaryFur, r.colors.slice(0, 2).join(", ") || null].filter(Boolean).join(" · ") || undefined}
          href={`/models/${r.id}`}
          fields={[
            { label: "Заведено в ТЗ, шт.", value: r.qty > 0 ? formatQty(r.qty) : "–", strong: true },
            { label: "Полная себестоимость итого", value: <CostTwo on={r.costIncl > 0 ? r.met.total.on : null} off={r.met.total.off} /> },
            { label: "За ед.", value: <CostTwo on={r.met.unit ? r.met.unit.on : null} off={r.met.unit ? r.met.unit.off : null} /> },
            { label: "Наценка к ТЗ", value: r.markup ? fmtX(r.markup) : "–" },
            { label: "MU (110)", value: r.mu110 ? fmtX(r.mu110) : "–" },
            { label: "Вкл / выкл", value: <ActiveToggle modelId={r.id} active={r.isActive} canEdit={canCreate} /> },
            { label: "ТЗ", value: r.orderCount > 0 ? <Link href={`/production?model=${r.id}`} className="underline">{r.orderCount}</Link> : "–" },
          ]}
          details={[
            ...(() => {
              const ph = photoSummary.get(r.id);
              const ex = ph ? galleryExtras(ph, shopLinksAll.get(r.id) ?? [], colorRefs) : null;
              const links = shopLinksAll.get(r.id) ?? [];
              return [
                ...(ph && ex ? [{ label: "Фото", value: <PhotoGalleryButton modelId={r.id} photos={ph} groups={ex.groups} shops={ex.shops} title={r.name} compact {...(canCreate ? { onDelete: deleteArticlePhoto, onDeleteAll: deleteAllArticlePhotos } : {})} /> }] : []),
                ...(r.plus.length ? [{ label: "PLU", value: r.plus.map((x) => x.plu + (r.plus.length > 1 && x.label ? ` · ${x.label}` : "")).join(", ") }] : []),
                ...(links[0] ? [{ label: "Товар в магазине", value: <a href={links[0].url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-blue-700 underline">Открыть ↗</a> }] : []),
                ...(canCreate ? [{ label: "Магазин и фото", value: <ArticleShopEditor modelId={r.id} title={r.name} /> }] : []),
              ];
            })(),
            { label: "Шкур, шт.", value: r.met.fur.qty > 0 ? `${formatDec1(Math.round(r.met.fur.qty * 100) / 100)}${r.qty > 0 ? ` (${perItem(r.met.fur.qty, r.qty)}/изд.)` : ""}` : "–" },
            { label: "Шкуры, сумма", value: <CostTwo on={r.met.fur.on} off={r.met.fur.off} /> },
            { label: "Подкладка, м", value: r.met.lining.qty > 0 ? `${formatDec1(Math.round(r.met.lining.qty * 100) / 100)}${r.qty > 0 ? ` (${perItem(r.met.lining.qty, r.qty)}/изд.)` : ""}` : "–" },
            { label: "Подкладка, сумма", value: <CostTwo on={r.met.lining.on} off={r.met.lining.off} /> },
            { label: "Работа", value: r.met.work > 0 ? <Money incl={r.met.work.toFixed(2)} excl={r.met.work.toFixed(2)} /> : "–" },
            { label: "НДС в списаниях", value: r.met.vatRates.length ? r.met.vatRates.map((v) => `${v} %`).join(", ") : "–" },
          ]}
          extra={
            <div>
              <div className="mb-1 text-xs text-neutral-500">Розничная цена, с НДС</div>
              <ArticlePriceForm mobile modelId={r.id} sellingPrice={r.ownPrice} fallback={r.listOnly && r.sellingPrice ? String(r.sellingPrice) : ""} canEdit={canCreate} />
            </div>
          }
        />
      ))}
    </>
  );
}
