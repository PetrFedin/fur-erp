import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getCategoryOptions } from "@/lib/categories";
import { RecordHistory } from "@/components/record-history";
import { RecordComments } from "@/components/comments/record-comments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { ModelForm } from "../model-form";
import { rowVersion, MODEL_V } from "@/lib/concurrency";
import { updateModel, removeBomLine } from "../actions";
import { BomAddForm } from "./bom-add-form";
import { ConfirmSubmitButton } from "../../purchases/[id]/documents-form";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FITTING_STATUS, orderLabel, truncate } from "@/lib/fittings";
import { ArticleName } from "@/components/article-name";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const m = await prisma.productModel.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { name: true } });
  return { title: m ? `Модель ${m.name}` : "Модель" };
}

export default async function EditModelPage({ params }: PageProps<"/models/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const [model, materials, fittings, categoryOptions] = await Promise.all([
    prisma.productModel.findFirst({
      where: { id, organizationId: session.user.organizationId },
      include: { materials: { include: { rawMaterial: true }, orderBy: { id: "asc" } } },
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.fitting.findMany({
      where: { organizationId: session.user.organizationId, productionOrder: { productModelId: id } },
      include: { productionOrder: { select: { number: true, workOrderNumber: true } } },
      orderBy: [{ fittingDate: "desc" }, { createdAt: "desc" }],
      take: 10,
    }),
    getCategoryOptions(session.user.organizationId),
  ]);
  if (!model) notFound();

  const boundRemove = removeBomLine.bind(null, id);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link href="/articles" className="text-sm text-neutral-500 hover:underline">← Изделия</Link>
      <Card>
        <CardHeader>
          <CardTitle>Модель: <ArticleName model={model} /></CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="text-sm text-neutral-600">
            Розничная цена: {model.sellingPrice ? formatMoney(model.sellingPrice.toString()) : "не задана"} ·{" "}
            <Link
              href={`/articles?q=${encodeURIComponent(model.name)}#price-${model.id}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Изменить цену
            </Link>
          </div>
          <ModelForm
            categories={categoryOptions}
            canCreateCategory={hasRole(session.user.role, ACCESS.categories)}
            action={updateModel.bind(null, id)}
            version={rowVersion(model, MODEL_V)}
            model={{
              id: model.id,
              organizationId: model.organizationId,
              name: model.name,
              sku: model.sku,
              category: model.category,
              categoryRefId: model.categoryRefId,
              sellingPrice: model.sellingPrice?.toString() ?? null,
              description: model.description,
              salesCode: model.salesCode,
              salesName: model.salesName,
              aliases: model.aliases,
              isActive: model.isActive,
              createdAt: model.createdAt,
              updatedAt: model.updatedAt,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Состав: норма расхода сырья на 1 изделие</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {model.materials.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Нормы нет: не задан состав (норма расхода) — себестоимость берётся из фактических ТЗ.
            </p>
          ) : (
          <Table>
              <Thead>
                <Tr>
                  <Th>Материал</Th>
                  <Th>Норма на 1 изделие</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {model.materials.map((line) => (
                  <Tr key={line.id}>
                    <Td>{line.rawMaterial.name}</Td>
                    <Td>
                      {formatQty(line.quantityPerUnit.toString())} {UNIT_LABELS[line.rawMaterial.unit]}
                    </Td>
                    <Td>
                      <form
                        action={async () => {
                          "use server";
                          await boundRemove(line.id);
                        }}
                      >
                        <ConfirmSubmitButton message={`Убрать «${line.rawMaterial.name}» из нормы расхода модели? Уже созданные ТЗ не изменятся.`} label="Удалить" />
                      </form>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
          <BomAddForm productModelId={id} materials={materials} />
        </CardContent>
      </Card>

      <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3" open={fittings.length > 0}>
        <summary className="cursor-pointer text-sm font-medium">Примерки этой модели ({fittings.length})</summary>
        <div className="mt-2">
          {fittings.length === 0 ? (
            <p className="text-sm text-neutral-400">Примерок по этой модели пока нет</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {fittings.map((f) => {
                const st = FITTING_STATUS[f.status];
                return (
                  <li key={f.id}>
                    <Link href={`/fittings/${f.id}`} className="flex flex-wrap items-center gap-3 py-2 text-sm hover:bg-neutral-50">
                      <span className="whitespace-nowrap font-medium">{formatDate(f.fittingDate)}</span>
                      <span className="whitespace-nowrap">{orderLabel(f.productionOrder)}</span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                      <span className="min-w-0 flex-1 text-neutral-600">{truncate(f.comment, 100)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
      <RecordHistory model="ProductModel" recordId={model.id} />
      <RecordComments entityType="ProductModel" entityId={model.id} />
    </div>
  );
}
