import { expect, type Page } from "@playwright/test";

export const TEST_USER = { email: "anna@qa-test.ru", password: "TestPass123!" };

/** Логин тестовым пользователем (в изолированной копии базы). */
export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Пароль").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}

/** Собирает ошибки консоли и падения страницы, чтобы тест мог их проверить. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return errors;
}

export async function expectNoErrors(errors: string[]) {
  expect(errors, errors.join("\n")).toEqual([]);
}
