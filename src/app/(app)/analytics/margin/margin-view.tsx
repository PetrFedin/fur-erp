"use client";

import { useEffect, useState } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/segmented";
import { CAT_LABEL } from "@/lib/sales-receipts-core";
import type { MarginInputS } from "@/lib/margin";
import type { ReportSizeRow } from "@/lib/margin-tree";
import { MarginBlock } from "./margin-block";
import { PricesBlock, type PriceModel } from "./prices-block";

type Cat = "all" | "clothes" | "acc";
type Photos = Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }>;

/** «Маржа и наценка» в разделе «Изделия»: закреплённый фильтр категории, разрезы, раскрытие по уровням, фото, розничные цены прайса. */
export function MarginView({ input, sizes, photos, priceModels, canEdit, initialCat, initialTree, initialCur, initialVat }: { initialCat: Cat; initialTree: "a" | "b"; initialCur: "rub" | "eur"; initialVat: "ex" | "in"; input: MarginInputS | null; sizes: ReportSizeRow[]; photos: Photos; priceModels: PriceModel[]; canEdit: boolean }) {
  const router = useRouter();
  const [cat, setCatState] = useState<Cat>(initialCat);
  // Выбор категории хранится в адресе (?cat=), чтобы им можно было поделиться ссылкой.
  const [tree, setTreeState] = useState<"a" | "b">(initialTree);
  const [cur, setCurState] = useState<"rub" | "eur">(initialCur);
  const [vat, setVatState] = useState<"ex" | "in">(initialVat);
  const urlOf = (c: Cat, t: "a" | "b", cu: "rub" | "eur", v: "ex" | "in") => { const q = [c !== "all" ? `cat=${c}` : "", t !== "a" ? `tree=${t}` : "", cu !== "rub" ? `cur=${cu}` : "", v !== "ex" ? `vat=${v}` : ""].filter(Boolean).join("&"); return q ? `/analytics/margin?${q}` : "/analytics/margin"; };
  const setCat = (k: Cat) => { setCatState(k); router.replace(urlOf(k, tree, cur, vat), { scroll: false }); };
  const setTree = (t: "a" | "b") => { setTreeState(t); router.replace(urlOf(cat, t, cur, vat), { scroll: false }); };
  const setCur = (c: "rub" | "eur") => { setCurState(c); router.replace(urlOf(cat, tree, c, vat), { scroll: false }); };
  // НДС — один на весь сайт (переключатель в шапке): раздел следует за шапкой, а свой переключатель меняет и шапку.
  const vatDisp = useVatDisplay();
  useEffect(() => {
    const want = vatDisp.mode === "excl" ? "ex" : "in";
    setVatState((v) => (v === want ? v : want));
  }, [vatDisp.mode]);
  const setVat = (v: "ex" | "in") => { setVatState(v); vatDisp.setMode(v === "ex" ? "excl" : "incl"); router.replace(urlOf(cat, tree, cur, v), { scroll: false }); };
  // Счётчики на кнопках — единицы прихода по строкам выгрузки (категория по Level 02, как в Cashflow).
  const count = (k: Cat) => (input ? input.lines.filter((l) => l.kind === "RECEIPT" && (k === "all" || l.cls === k)).reduce((a, l) => a + l.pcs, 0) : 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Маржа и наценка</h1>
        <Link href="/cashflow" className="inline-flex min-h-11 items-center text-sm underline">Деньги по месяцам — в Cashflow</Link>
      </div>
      <div id="margin-filters" className="sticky top-0 z-20 -mx-3 border-b border-neutral-300 bg-white/95 px-3 py-1 backdrop-blur md:-mx-4 md:px-4">
        <Segmented label="Категория" items={(["all", "clothes", "acc"] as const).map((k) => ({ key: k, label: <>{CAT_LABEL[k]} <span className="ml-1 text-xs opacity-80">{count(k)} шт.</span></>, on: cat === k, onSelect: () => setCat(k) }))} />
      </div>
      <MarginBlock input={input} cat={cat} shown={CAT_LABEL[cat]} onChange={() => document.getElementById("margin-filters")?.scrollIntoView({ block: "start" })} sizes={sizes} photos={photos} tree={tree} onTree={setTree} cur={cur} onCur={setCur} vat={vat} onVat={setVat} />
      <PricesBlock models={priceModels} canEdit={canEdit} />
    </div>
  );
}
