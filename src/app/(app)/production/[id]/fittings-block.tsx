import Link from "next/link";
import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FittingThumbs } from "@/components/fitting-thumbs";
import { formatDate } from "@/lib/utils";
import { FITTING_STATUS, truncate } from "@/lib/fittings";

/** Блок «Примерки» на карточке ТЗ: последние примерки этого ТЗ. */
export async function FittingsBlock({ orderId, organizationId, search }: { orderId: string; organizationId: string; search: string }) {
  const session = await getFreshSession();
  const canAdd = ["OWNER", "ADMIN", "TECHNOLOGIST"].includes(session?.user?.role ?? "");
  const where = { productionOrderId: orderId, organizationId };
  const [fittings, total] = await Promise.all([
    prisma.fitting.findMany({
      where,
      include: { photos: { select: { id: true }, orderBy: { createdAt: "asc" } } },
      orderBy: [{ fittingDate: "desc" }, { createdAt: "desc" }],
      take: 5,
    }),
    prisma.fitting.count({ where }),
  ]);

  if (total === 0) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
        Примерок пока нет
        {canAdd && (
          <>
            {" · "}
            <Link href={`/fittings/new?order=${orderId}`} className="inline-block text-neutral-700 underline underline-offset-2 hover:text-neutral-900 max-md:py-2">
              + Примерка
            </Link>
          </>
        )}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Примерки{total > 0 ? ` (${total})` : ""}</CardTitle>
        {canAdd && (
          <Link href={`/fittings/new?order=${orderId}`} className={buttonVariants({ size: "sm" })}>
            + Примерка
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {(
          <ul className="flex flex-col divide-y divide-neutral-100">
            {fittings.map((f) => {
              const st = FITTING_STATUS[f.status];
              return (
                <li key={f.id}>
                  <Link href={`/fittings/${f.id}`} className="flex flex-wrap items-center gap-3 py-2 hover:bg-neutral-50">
                    <span className="whitespace-nowrap text-sm font-medium">{formatDate(f.fittingDate)}</span>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    <span className="min-w-0 flex-1 text-sm text-neutral-600">{truncate(f.comment, 100)}</span>
                    <FittingThumbs photoIds={f.photos.map((p) => p.id)} total={f.photos.length} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {total > fittings.length && (
          <Link href={`/fittings?q=${encodeURIComponent(search)}`} className="mt-2 block text-xs text-neutral-500 hover:underline">
            Показаны последние {fittings.length} из {total} — все в разделе «Примерки»
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
