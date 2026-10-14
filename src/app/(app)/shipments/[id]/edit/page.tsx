import { redirect } from "next/navigation";

// Старая форма правки заменена окном «Изменить» в карточке отгрузки.
export default async function EditShipmentRedirect({ params }: PageProps<"/shipments/[id]/edit">) {
  const { id } = await params;
  redirect(`/shipments/${id}`);
}
