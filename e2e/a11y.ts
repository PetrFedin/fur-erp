// Проверка доступности (axe, WCAG 2 AA: контраст и пр.) для e2e-тестов:
//   import { expectNoA11yViolations } from "./a11y"; await expectNoA11yViolations(page);
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectNoA11yViolations(page: Page, opts: { exclude?: string[] } = {}) {
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  for (const sel of opts.exclude ?? []) b = b.exclude(sel);
  const { violations } = await b.analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}
