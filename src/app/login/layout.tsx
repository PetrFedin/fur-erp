import { DemoLogin } from "./demo-login";

// Демо-доступ под формой входа. Показывается, только если оба значения заданы в .env
// (DEMO_LOGIN_EMAIL и DEMO_LOGIN_PASSWORD). На публичном сервере НЕ задавайте их, если сайт открыт всем.
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  const email = process.env.DEMO_LOGIN_EMAIL;
  const password = process.env.DEMO_LOGIN_PASSWORD;
  return (
    <>
      {children}
      {email && password ? <DemoLogin email={email} password={password} /> : null}
    </>
  );
}
