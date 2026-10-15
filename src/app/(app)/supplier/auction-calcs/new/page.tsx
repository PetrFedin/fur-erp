import { redirect } from "next/navigation";
import { InfoHint } from "@/components/info-hint";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireRawViewer } from "@/lib/supplier-inbox";
import { emptyPayload } from "@/lib/supplier-calc";
import { payloadFromBase, startOptions } from "@/lib/supplier-calc-start";
import { calcYearOptions } from "@/lib/supplier-calc-years";
import { CalcForm } from "../calc-form";
import { StartFrom } from "../start-from";

export const metadata = { title: "Новый расчёт аукциона" };

export default async function NewCalcPage({ searchParams }: PageProps<"/supplier/auction-calcs/new">) {
  const s = await requireRawViewer();
  if (s.user.role !== "SUPPLIER") redirect("/supplier/auction-calcs");
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : "";
  const [opts, base, years] = await Promise.all([startOptions(s), from ? payloadFromBase(s, from) : Promise.resolve(null), calcYearOptions(s)]);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Расчёты аукционов", href: "/supplier/auction-calcs" }, { label: "Новый расчёт" }]} />
      <h1 className="text-xl font-semibold">Новый расчёт аукциона</h1>
      {(opts.calcs.length > 0 || opts.auctions.length > 0) && (
        <details className="text-sm" open={!!base}>
          <summary className="cursor-pointer select-none text-neutral-600 underline decoration-dotted">Взять с предыдущего расчёта</summary>
          <div className="mt-2"><StartFrom calcs={opts.calcs} auctions={opts.auctions} current={base ? from : ""} /></div>
        </details>
      )}
      {base && from.startsWith("auction:") && base.rows.some((r) => r.lot) && <p className="flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm">Лоты подставлены из нашей закупки<InfoHint label="Откуда лоты">Лоты и количество подставлены из нашей последней закупки по этому аукциону, цена молотка — там, где она есть в закупке. Проверьте, допишите недостающие цены, ставки и расходы.</InfoHint></p>}
      <CalcForm key={base ? from : "empty"} id={null} initial={base ?? emptyPayload("SP_RP")} readOnly={false} files={[]} years={years} />
    </div>
  );
}
