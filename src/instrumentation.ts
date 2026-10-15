// Выполняется один раз при старте сервера. В боевом режиме не даём запуститься с пустым/простым секретом входа.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { productionEnvProblems } = await import("@/lib/security-env");
  const problems = productionEnvProblems();
  if (problems.length > 0) {
    console.error("[security] Сервер не запущен из-за настроек: " + problems.join("; "));
    throw new Error("Небезопасные настройки окружения: " + problems.join("; "));
  }
  if (process.env.ALLOW_DEMO_LOGIN === "true") console.warn("[security] ВНИМАНИЕ: ALLOW_DEMO_LOGIN=true — демо-пароли показаны на странице входа");
  if (process.env.ALLOW_REGISTRATION === "true") console.warn("[security] ВНИМАНИЕ: ALLOW_REGISTRATION=true — любой может зарегистрировать компанию");
}
