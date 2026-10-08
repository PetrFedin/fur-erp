import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ProductionTabs } from "@/components/production-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { FITTING_STATUS, dateInputValue, orderLabel } from "@/lib/fittings";
import { updateFitting, deleteFitting, deleteFittingPhoto } from "../actions";
import { EditFittingForm } from "./edit-fitting-form";
import { PhotoGallery } from "./photo-gallery";
import { AddPhotosForm } from "./add-photos-form";
import { DeleteFittingButton } from "./delete-fitting-button";
import { articleLabel } from "@/lib/article-label";

export const metadata = { title: "Примерка" };

export default async function FittingPage({ params }: PageProps<"/fittings/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const fitting = await prisma.fitting.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      photos: { orderBy: { createdAt: "asc" } },
      productionOrder: {
        select: {
          id: true,
          number: true,
          workOrderNumber: true,
          productModel: { select: { id: true, name: true, category: true, salesCode: true, salesName: true } },
          client: { select: { name: true } },
        },
      },
    },
  });
  if (!fitting) notFound();
  const canEdit = ["OWNER", "ADMIN", "TECHNOLOGIST"].includes(session.user.role);
  const st = FITTING_STATUS[fitting.status];
  const o = fitting.productionOrder;

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="fittings" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Примерка от {formatDate(fitting.fittingDate)}</h1>
        <Link href="/fittings" className="text-sm text-neutral-500 hover:underline">
          ← Все примерки
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Данные примерки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-neutral-500">ТЗ</dt>
              <dd>
                <Link href={`/production/${o.id}`} className="underline">
                  {orderLabel(o)}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Модель</dt>
              <dd>
                <Link href={`/models/${o.productModel.id}`} className="underline">
                  {articleLabel(o.productModel)}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Заказчик</dt>
              <dd>{o.client?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Итог</dt>
              <dd>
                <Badge variant={st.variant}>{st.label}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Размер</dt>
              <dd>{fitting.size ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Дата</dt>
              <dd>{formatDate(fitting.fittingDate)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-neutral-500">Комментарий</dt>
              <dd className="whitespace-pre-wrap">{fitting.comment ?? "—"}</dd>
            </div>
          </dl>
          {canEdit && (
            <EditFittingForm
              action={updateFitting.bind(null, id)}
              defaults={{
                date: dateInputValue(fitting.fittingDate),
                size: fitting.size ?? "",
                status: fitting.status,
                comment: fitting.comment ?? "",
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Фото ({fitting.photos.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PhotoGallery
            photos={fitting.photos.map((p) => ({ id: p.id, name: p.originalName }))}
            canEdit={canEdit}
            onDelete={deleteFittingPhoto}
          />
          {canEdit && <AddPhotosForm fittingId={id} />}
        </CardContent>
      </Card>

      {canEdit && (
        <div>
          <DeleteFittingButton action={deleteFitting.bind(null, id)} photoCount={fitting.photos.length} />
        </div>
      )}
    </div>
  );
}
