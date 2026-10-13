import { redirect } from "next/navigation";

// Создание теперь в окне поверх списка; старый адрес открывает его (единица измерения из ?unit= сохраняется).
export default async function NewMaterialRedirect({ searchParams }: PageProps<"/materials/new">) {
  const sp = await searchParams;
  const unit = typeof sp.unit === "string" ? sp.unit : "";
  redirect(`/materials?new=1${unit ? `&unit=${encodeURIComponent(unit)}` : ""}`);
}
