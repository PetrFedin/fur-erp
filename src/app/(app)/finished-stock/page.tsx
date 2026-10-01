import { redirect } from "next/navigation";

// Старый адрес остаётся рабочим и сохраняет параметры (например, ?q=…).
export default async function FinishedStockPage({ searchParams }: PageProps<"/finished-stock">) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, item);
  }
  const s = qs.toString();
  redirect(s ? `/articles?${s}` : "/articles");
}
