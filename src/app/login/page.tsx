import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm demoEmail={process.env.DEMO_LOGIN_EMAIL} demoPassword={process.env.DEMO_LOGIN_PASSWORD} />;
}
