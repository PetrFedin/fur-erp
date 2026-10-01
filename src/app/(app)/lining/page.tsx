import { redirect } from "next/navigation";

// Подкладка переехала на вкладку раздела «Сырьё»; старый адрес остаётся рабочим
// и сохраняет параметры.
export default async function LiningPage({ searchParams }: PageProps<"/lining">) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "tab") continue;
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, item);
  }
  qs.set("tab", "lining");
  redirect(`/lots?${qs.toString()}`);
}
