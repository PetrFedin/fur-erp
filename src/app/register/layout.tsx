import { redirect } from "next/navigation";
import { registrationAllowed } from "@/lib/security-env";

// На публичном сервере регистрацию новых компаний закрывают: в боевом режиме она выключена, пока явно не задано ALLOW_REGISTRATION=true.
export const dynamic = "force-dynamic";
export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  if (!registrationAllowed()) redirect("/login");
  return children;
}
