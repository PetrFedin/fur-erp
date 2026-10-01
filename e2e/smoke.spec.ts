import { test } from "@playwright/test";
import { login, watchErrors, expectNoErrors } from "./helpers";

// Все страницы меню открываются в боевой сборке без ошибок консоли и 5xx.
const PAGES = [
  "/dashboard", "/lots", "/lots?tab=lining", "/raw-materials", "/purchases", "/purchases/new",
  "/production", "/production/new", "/shipments", "/shipments/new", "/fittings", "/fittings/new",
  "/articles", "/settings", "/materials", "/materials/new", "/suppliers", "/clients", "/payments",
  "/payments?tab=clients", "/supply-plan", "/warehouses", "/expense-categories", "/users",
];

test.describe("смоук: страницы открываются", () => {
  for (const path of PAGES) {
    test(path, async ({ page }) => {
      await login(page);
      const errors = watchErrors(page);
      const res = await page.goto(path);
      test.expect(res?.status()).toBeLessThan(400);
      await page.waitForLoadState("networkidle");
      await expectNoErrors(errors);
    });
  }
});
