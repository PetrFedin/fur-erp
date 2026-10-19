"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CAT_LABEL } from "@/lib/sales-receipts-core";
import type { MarginInputS } from "@/lib/margin";
import type { ReportSizeRow } from "@/lib/margin-tree";
import { MarginBlock } from "./margin-block";
import { PricesBlock, type PriceModel } from "./prices-block";

type Cat = "all" | "clothes" | "acc";
type Photos = Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }>;

/** «Маржа и наценка» в разделе «Изделия»: закреплённый фильтр категории, разрезы, раскрытие по уровням, фото, розничные цены прайса. */
export function MarginView({ input, sizes, photos, priceModels, canEdit, initialCat }: { initialCat: Cat; input: MarginInputS | null; sizes: ReportSizeRow[]; photos: Photos; priceModels: PriceModel[]; canEdit: boolean }) {
  const router = useRouter();
  const [cat, setCatState] = useState<Cat>(initialCat);
  // Выбор категории хранится в адресе (?cat=), чтобы им можно было поделиться ссылкой.
  const setCat = (k: Cat) => { setCatState(k); router.replace(k === "all" ? "/analytics/margin" : `/analytics/margin?cat=${k}`, { scroll: false }); };
  // Счётчики на кнопках — единицы прихода по строкам выгрузки (категория по Level 02, как в Cashflow).
  const count = (k: Cat) => (input ? input.lines.filter((l) => l.kind === "RECEIPT" && (k === "all" || l.cls === k)).reduce((a, l) => a + l.pcs, 0) : 0);
  const seg = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Маржа и наценка</h1>
        <Link href="/cashflow" className="inline-flex min-h-11 items-center text-sm underline">Деньги по месяцам — в Cashflow</Link>
      </div>
      <div id="margin-filters" className="sticky top-0 z-20 -mx-3 border-b border-neutral-300 bg-white/95 px-3 py-1 backdrop-blur md:-mx-4 md:px-4">
        <div role="group" aria-label="Категория" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
          {(["all", "clothes", "acc"] as const).map((k) => <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)} className={seg(cat === k)}>{CAT_LABEL[k]} <span className="ml-1 text-xs opacity-80">{count(k)} шт.</span></button>)}
        </div>
      </div>
      <MarginBlock input={input} cat={cat} shown={CAT_LABEL[cat]} onChange={() => document.getElementById("margin-filters")?.scrollIntoView({ block: "start" })} sizes={sizes} photos={photos} />
      <PricesBlock models={priceModels} canEdit={canEdit} />
    </div>
  );
}
