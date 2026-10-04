import { redirect } from "next/navigation";

// На публичном сервере регистрацию новых компаний закрывают: ALLOW_REGISTRATION=false в .env.
export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  if (process.env.ALLOW_REGISTRATION === "false") redirect("/login");
  return children;
}
