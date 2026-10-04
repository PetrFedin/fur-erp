import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { cleanSearch, escapeLike } from "@/lib/input";
import { getYearFilter } from "@/lib/year-filter";
import { orderYearWhere, orderDateOf } from "@/lib/year-scope";
import { YearNote } from "@/components/year-note";
import { formatQty, formatDate } from "@/lib/utils";
import { modelCodeVariants } from "@/lib/model-code";
import { suggestSeasons } from "@/lib/plan-season-rule";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ProductionTabs } from "@/components/production-tabs";
import { InfoHint } from "@/components/info-hint";
import { AssignTable } from "./assign-table";
import { applySeasonRule } from "../actions";

export const metadata = { title: "Сезоны ТЗ" };

const MSG: Record<string, string> = { none: "Ничего не выбрано.", noseason: "Сезон не найден." };

export default async function SeasonsOrdersPage({ searchParams }: PageProps<"/plan/seasons">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.planning);
  const year = await getYearFilter();
  const sp = await searchParams;
  const q = cleanSearch(sp.q);
  const s = cleanSearch(sp.s, 40);
  const msg = cleanSearch(sp.msg, 20);
  const n = cleanSearch(sp.n, 8);

  const seasons = await prisma.season.findMany({ where: { organizationId: orgId }, orderBy: [{ startDate: "desc" }, { code: "asc" }] });
  const seasonById = new Map(seasons.map((x) => [x.id, x]));

  const where = {
    organizationId: orgId,
    status: { not: "CANCELLED" as const },
    AND: [orderYearWhere(year)],
    ...(s === "none" ? { seasonId: null } : seasons.some((x) => x.id === s) ? { seasonId: s } : {}),
    ...(q
      ? {
          OR: [
            { workOrderNumber: { contains: escapeLike(q), mode: "insensitive" as const } },
            { number: { contains: escapeLike(q), mode: "insensitive" as const } },
            ...modelCodeVariants(q).map((v) => ({ productModel: { name: { contains: escapeLike(v), mode: "insensitive" as const } } })),
          ],
        }
      : {}),
  };
  const LIMIT = 300;
  const [orders, unseasoned] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, seasonId: true, workOrderDate: true, endDate: true, startDate: true, productModel: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    }),
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, seasonId: null, status: { not: "CANCELLED" } },
      select: { id: true, number: true, workOrderNumber: true, seasonId: true, workOrderDate: true, endDate: true, startDate: true, productModel: { select: { name: true } } },
    }),
  ]);

  // Предложение по датам — по всем ТЗ без сезона (не зависит от года в шапке).
  const verdicts = suggestSeasons(unseasoned, seasons);
  const info = new Map(unseasoned.map((o) => [o.id, o]));
  const matches = verdicts.filter((v) => v.kind === "match");
  const noDate = verdicts.filter((v) => v.kind === "nodate").length;
  const outside = verdicts.filter((v) => v.kind === "none").length;
  const multi = verdicts.filter((v) => v.kind === "multi").length;
  const rangedSeasons = seasons.filter((x) => x.startDate && x.endDate);
  const label = (o: { workOrderNumber: string | null; number: string }) => (o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : `Заказ ${o.number}`);

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="plan" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Сезоны ТЗ<YearNote year={year} />{" "}
          <InfoHint wide>Здесь каждому ТЗ присваивается сезон — по нему план заказа считает факт. Можно выбрать ТЗ галочками и присвоить сезон сразу всем, либо посмотреть предложение по датам (ничего не применяется без вашего подтверждения). Данные ТЗ при этом не меняются, кроме поля «сезон».</InfoHint>
        </h1>
        <Link href="/plan" className={buttonVariants({ variant: "outline" })}>← План заказа</Link>
      </div>

      {msg === "assigned" && <p className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-800">Готово: сезон изменён у ТЗ — {n || 0}.</p>}
      {MSG[msg] && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">{MSG[msg]}</p>}
      {seasons.length === 0 && (
        <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          Сезонов ещё нет. Заведите сезон на странице <Link href="/plan#seasons" className="underline">«План заказа»</Link> (внизу блок «Сезоны»).
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Предложение по датам{" "}
            <InfoHint wide>Правило: ТЗ без сезона, у которого есть дата (дата ТЗ → окончание → начало), попадает в сезон, если дата внутри диапазона дат сезона. ТЗ без даты, с датой вне всех сезонов или попадающие сразу в два сезона — «ждут ручного выбора»: правило их не трогает. Дата партии не используется, она не точная.</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {rangedSeasons.length === 0 ? (
            <p className="text-neutral-500">Чтобы получить предложение, задайте даты начала и конца хотя бы у одного сезона (блок «Сезоны» на странице плана).</p>
          ) : (
            <>
              <p>
                Подходит под правило: <b>{matches.length}</b>. Ждут ручного выбора: <b>{noDate + outside + multi}</b> (без даты — {noDate}, вне сезонов — {outside}, в двух сезонах сразу — {multi}).
              </p>
              {matches.length > 0 && (
                <form action={applySeasonRule} className="flex flex-col gap-2">
                  <div className="max-h-72 overflow-auto rounded-md border border-neutral-200">
                    <table className="w-full text-xs">
                      <thead className="bg-neutral-50 text-left text-neutral-500"><tr><th className="w-8 px-2 py-1">{""}</th><th className="px-2 py-1">ТЗ</th><th className="px-2 py-1">Модель</th><th className="px-2 py-1">Дата</th><th className="px-2 py-1">→ Сезон</th></tr></thead>
                      <tbody>
                        {matches.map((v) => {
                          const o = info.get(v.orderId)!;
                          return (
                            <tr key={v.orderId} className="border-t border-neutral-100">
                              <td className="px-2 py-1"><input type="checkbox" name="orderId" value={v.orderId} defaultChecked disabled={!canEdit} className="size-4" aria-label={`Применить к ${label(o)}`} /></td>
                              <td className="px-2 py-1 font-medium"><Link href={`/production/${o.id}`} className="hover:underline">{label(o)}</Link></td>
                              <td className="px-2 py-1">{o.productModel.name}</td>
                              <td className="px-2 py-1 tabular-nums">{formatDate(orderDateOf(o)!)}</td>
                              <td className="px-2 py-1 font-semibold">{v.kind === "match" ? seasonById.get(v.seasonId)?.code : ""}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {canEdit ? <Button type="submit" className="self-start">Применить к отмеченным</Button> : <p className="text-xs text-neutral-500">Применять правило могут владелец, администратор и технолог.</p>}
                </form>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={q} placeholder="№ ТЗ или модель" className="h-10 w-full sm:w-64" />
        <Select name="s" defaultValue={s} className="h-10 w-full sm:w-56" aria-label="Сезон">
          <option value="">Все сезоны</option>
          <option value="none">Без сезона</option>
          {seasons.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
        </Select>
        <button type="submit" className={buttonVariants({ variant: "outline", className: "h-10" })}>Найти</button>
        {(q || s) && <Link href="/plan/seasons" className="text-sm text-neutral-500 hover:underline">Сбросить</Link>}
      </form>

      <AssignTable
        key={`${q}|${s}|${year}`}
        canEdit={canEdit}
        seasons={seasons.map((x) => ({ id: x.id, code: x.code }))}
        orders={orders.map((o) => {
          const d = orderDateOf(o);
          return { id: o.id, label: label(o), model: o.productModel.name, date: d ? formatDate(d) : null, status: o.status, season: o.seasonId ? (seasonById.get(o.seasonId)?.code ?? null) : null, qty: formatQty(o.plannedQuantity.toString()) };
        })}
      />
      {orders.length === LIMIT && <p className="text-xs text-neutral-500">Показаны первые {LIMIT} ТЗ — сузьте поиск.</p>}
    </div>
  );
}
