// Переключатели безопасности публичного стенда. Единое место, чтобы страницы и действия не расходились.
// Без server-only: читаются только на сервере (process.env), но файл безопасно импортировать и в тестах.

export const isProduction = () => process.env.NODE_ENV === "production";

/** Демо-вход (пароли на странице /login). В боевом режиме выключен, пока явно не задано ALLOW_DEMO_LOGIN=true. */
export function demoLoginEnabled(): boolean {
  return !isProduction() || process.env.ALLOW_DEMO_LOGIN === "true";
}

/** Самостоятельная регистрация компании. В боевом режиме выключена, пока явно не задано ALLOW_REGISTRATION=true. */
export function registrationAllowed(): boolean {
  const v = process.env.ALLOW_REGISTRATION;
  return isProduction() ? v === "true" : v !== "false";
}

/** Проверка обязательных секретов при старте боевого сервера. Возвращает список проблем (пусто — всё хорошо). */
export function productionEnvProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const secret = (env.AUTH_SECRET || env.NEXTAUTH_SECRET || "").trim();
  const weak = new Set(["secret", "changeme", "change-me", "ЗАМЕНИТЕ", "your-secret", "development", "dev-secret", "test"]);
  if (!secret) problems.push("AUTH_SECRET не задан");
  else if (secret.length < 32 || weak.has(secret) || /^(.)\1+$/.test(secret)) problems.push("AUTH_SECRET слишком простой или короткий (нужно не меньше 32 символов: openssl rand -base64 32)");
  if (!(env.DATABASE_URL || "").trim()) problems.push("DATABASE_URL не задан");
  if (!(env.AUTH_URL || env.NEXTAUTH_URL || "").trim() && env.AUTH_TRUST_HOST !== "true") problems.push("не задан AUTH_URL (адрес сайта) и не включён AUTH_TRUST_HOST");
  return problems;
}

/** Быстрое переключение владельца в кабинет поставщика (демонстрация). В боевом режиме выключено, пока явно не задано ALLOW_ROLE_SWITCH=true. */
export function roleSwitchEnabled(): boolean {
  const v = process.env.ALLOW_ROLE_SWITCH;
  return isProduction() ? v === "true" : v !== "false";
}
