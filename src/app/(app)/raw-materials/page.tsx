import { redirect } from "next/navigation";
import { cleanSearch } from "@/lib/input";

/**
 * Старая страница «Сырьё» со списком лотов дублировала фильтры на /lots.
 * Переносим выбранное на /lots (q = № лота или поиск, material = первый материал, auction = первый аукцион).
 */
export default async function RawMaterialsRedirect({ searchParams }: PageProps<"/raw-materials">) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined, max = 200) => cleanSearch(Array.isArray(v) ? v[0] : v, max);
  const params = new URLSearchParams();
  const q = first(sp.q) || first(sp.lot);
  const material = first(sp.material);
  const auction = first(sp.auction);
  if (q) params.set("q", q);
  if (material) params.set("material", material);
  if (auction) params.set("auction", auction);
  const qs = params.toString();
  redirect(qs ? `/lots?${qs}` : "/lots");
}
