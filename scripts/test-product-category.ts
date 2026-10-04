// Проверка таблиц соответствий из src/lib/product-category.ts: npx tsx scripts/test-product-category.ts
import {
  CATEGORY_CASES, categoryFromText, FUR_CASES, furFromText, SIZE_CASES, normalizeSize, COLOR_CASES, normalizeColor,
} from "../src/lib/product-category";
import { UNDEFINED_CATEGORY } from "../src/lib/product-category";

let bad = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got !== want) {
    bad++;
    console.error(`НЕ СОВПАЛО ${name}: получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`);
  }
}
for (const [t, want] of CATEGORY_CASES) check(`категория «${t}»`, categoryFromText(t) ?? UNDEFINED_CATEGORY, want);
for (const [t, want] of FUR_CASES) check(`мех «${t}»`, furFromText(t), want);
for (const [t, want] of SIZE_CASES) check(`размер «${t}»`, normalizeSize(t), want);
for (const [t, want] of COLOR_CASES) check(`цвет «${t}»`, normalizeColor(t), want);
console.log(bad === 0 ? "OK: все примеры совпали" : `Ошибок: ${bad}`);
process.exit(bad ? 1 : 0);
