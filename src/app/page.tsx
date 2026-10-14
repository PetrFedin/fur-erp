import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  redirect(!session?.user ? "/login" : session.user.role === "SUPPLIER" ? "/supplier" : "/dashboard");
}
