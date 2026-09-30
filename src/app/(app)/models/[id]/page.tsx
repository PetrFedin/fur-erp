import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ModelForm } from "../model-form";
import { updateModel, removeBomLine } from "../actions";
import { BomAddForm } from "./bom-add-form";
import { formatMoney, formatQty } from "@/lib/utils";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export default async function EditModelPage({ params }: PageProps<"/models/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const [model, materials] = await Promise.all([
    prisma.productModel.findFirst({
      where: { id, organizationId: session.user.organizationId },
      include: { materials: { include: { rawMaterial: true }, orderBy: { id: "asc" } } },
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!model) notFound();

  const boundRemove = removeBomLine.bind(null, id);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Модель: {model.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="text-sm text-neutral-600">
            Розничная цена: {model.sellingPrice ? formatMoney(model.sellingPrice.toString()) : "не задана"} ·{" "}
            <Link href="/articles" className="text-neutral-900 underline">
              изменить на странице «Изделия»
            </Link>
          </div>
          <ModelForm
            action={updateModel.bind(null, id)}
            model={{
              id: model.id,
              organizationId: model.organizationId,
              name: model.name,
              sku: model.sku,
              category: model.category,
              sellingPrice: model.sellingPrice?.toString() ?? null,
              description: model.description,
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
            <p className="text-sm text-neutral-400">Нормы нет</p>
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
                        <Button type="submit" variant="ghost" size="sm">
                          Удалить
                        </Button>
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
    </div>
  );
}
