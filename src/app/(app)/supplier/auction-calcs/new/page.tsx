import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireInboxViewer } from "@/lib/supplier-inbox";
import { emptyPayload } from "@/lib/supplier-calc";
import { payloadFromBase, startOptions } from "@/lib/supplier-calc-start";
import { CalcForm } from "../calc-form";
import { StartFrom } from "../start-from";

export const metadata = { title: "Новый расчёт аукциона" };

export default async function NewCalcPage({ searchParams }: PageProps<"/supplier/auction-calcs/new">) {
  const s = await requireInboxViewer();
  if (s.user.role !== "SUPPLIER") redirect("/supplier/auction-calcs");
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : "";
  const [opts, base] = await Promise.all([startOptions(s), from ? payloadFromBase(s, from) : Promise.resolve(null)]);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Расчёты аукционов", href: "/supplier/auction-calcs" }, { label: "Новый расчёт" }]} />
      <h1 className="text-xl font-semibold">Новый расчёт аукциона</h1>
      <StartFrom calcs={opts.calcs} auctions={opts.auctions} current={base ? from : ""} />
      <CalcForm key={base ? from : "empty"} id={null} initial={base ?? emptyPayload("SP_RP")} readOnly={false} files={[]} />
    </div>
  );
}
