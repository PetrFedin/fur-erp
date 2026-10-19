import { redirect } from "next/navigation";

// Cashflow вынесен в отдельный раздел меню (/cashflow); старый адрес оставлен ссылкой.
export default async function CashflowRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  redirect(sp.p === "2025" || sp.p === "2026" ? `/cashflow?p=${sp.p}` : "/cashflow");
}
