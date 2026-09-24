import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ModelForm } from "../model-form";
import { updateModel, removeBomLine } from "../actions";
import { BomAddForm } from "./bom-add-form";
import { formatQty } from "@/lib/utils";

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
          <CardTitle>{model.name}</CardTitle>
        </CardHeader>
        <CardContent>
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
          <CardTitle>Норма расхода сырья (BOM)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <BomAddForm productModelId={id} materials={materials} />
          <Table>
            <Thead>
              <Tr>
                <Th>Сырьё</Th>
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
              {model.materials.length === 0 && (
                <Tr>
                  <Td colSpan={3} className="py-8 text-center text-neutral-400">
                    Норма расхода не задана
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
