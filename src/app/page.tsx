import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";

export default async function Home() {
  const session = await getFreshSession({ allowSupplier: true });
  redirect(!session?.user ? "/login" : session.user.role === "SUPPLIER" ? "/supplier" : "/dashboard");
}
