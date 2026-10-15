import { LoginForm } from "./login-form";
import { demoLoginEnabled, registrationAllowed } from "@/lib/security-env";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  // На публичном стенде демо-пароли не попадают в страницу вообще (ни в разметку, ни в props).
  const demo = demoLoginEnabled();
  return (
    <LoginForm
      demoEmail={demo ? process.env.DEMO_LOGIN_EMAIL : undefined}
      demoPassword={demo ? process.env.DEMO_LOGIN_PASSWORD : undefined}
      supplierEmail={demo ? process.env.DEMO_SUPPLIER_EMAIL : undefined}
      supplierPassword={demo ? process.env.DEMO_SUPPLIER_PASSWORD : undefined}
      canRegister={registrationAllowed()}
    />
  );
}
