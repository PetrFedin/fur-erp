# Аудит шапок таблиц: подписи, единицы, выравнивание

Дата: 2026-10-12. Правила: `src/lib/units.ts` (реестр единиц `UNIT`), компоненты `src/components/table-head.tsx` (`TH`, `THGroup`, `SortMark`), `Th` с `unit` в `src/components/ui/table.tsx`, глобальное правило шапок в `src/app/globals.css`.

## Единый вид шапки

- Название колонки — первая строка, единица — вторая, мелкая (`text-[10px]`, приглушённая): `<TH label="Сумма" unit={UNIT.rub} />`; в `ui/table` — `<Th unit="₽" className="text-right">Сумма</Th>`.
- Единицы: ₽, $, шт., м, %, ₽/шт., $/шт., ₽/м, ₽/изд., шт./изд., м/изд. Запрещены «руб.», «р.», «RUB», «USD», «долл.», «шт» без точки, «пог.м», «м.п.» (регулярка `BANNED_UNIT_RE`). Колонки без единицы (названия, даты, номера, статусы) — без неё, по левому краю.
- Вертикаль: заголовки строго по центру во всех строках шапки (глобально `table thead :is(th,td){vertical-align:middle}` + `align-middle` в компонентах). Высота: последняя строка шапки `min 2.5rem`, строка групп `1.75rem` (`globals.css`).
- Числовые колонки — по правому краю, текстовые — по левому, подписи блоков (`THGroup`, `colSpan`) — по центру блока, линия снизу и вертикальная линия слева между блоками.
- Сортировка: `SortMark` ▲/▼ фиксированной ширины (не двигает подпись), активная — цвет акцента темы.
- Многоточий («…») в заголовках нет (проверено скриптом на основных страницах: Главная, ТЗ, Партии, Изделия, Оплаты, Бюджет, Календарь: `…` и обрезки не найдены).

## Что приведено в этом проходе

Главная: `production-table`, `averages`, `production-modal`, `price-composition-block`; ТЗ: `production/page`, партии (список и карточка), `composition-table`, `production/[id]`, `new/form`, `import/wizard`, `plan`, `plan/seasons`; Изделия: `articles/page`, `models/[id]`; Оплаты: `payments/page`, `client-payments-table`, `goods-tiles`, `payment-lines`, `payments-overview`; Бюджет: `budget-editor`, `compare`; Календарь: `pipe-views`; прочее: `shipments`, `fittings`, `analytics/pricing`, `settings/auctions`, `lot-products/lot-sheet-table/lot-usage-bar`, `orders-tree`, `price-composition`, печатные формы ТЗ и партии.

Остаётся «ступенчатость» от разного числа строк в подписях (одно-/двустрочные подписи в одной шапке): строка шапки выравнивается по максимальной, содержимое — по центру.

## Инвентарь: разделы вне зоны агента «Сырьё»

| Файл | Заголовков | С единицей | Без единицы (проверить) |
|---|---|---|---|
| `src/app/(app)/analytics/_shared/metric-ui.tsx` | 1 | 0 | — |
| `src/app/(app)/analytics/pricing/page.tsx` | 12 | 4 | Доля; Кол-во; Молоток за шкуру <InfoHint l |
| `src/app/(app)/analytics/products/page.tsx` | 3 | 0 | — |
| `src/app/(app)/analytics/raw/recon/page.tsx` | 19 | 0 | Закуплено; Остаток; Остаток в файле; Остаток по ТЗ; Расход по ТЗ; Стоимость остатка |
| `src/app/(app)/articles/page.tsx` | 22 | 12 | Мех; НДС <InfoHint label="НДС">Ст; Наценка <InfoHint label="Как |
| `src/app/(app)/budget/budget-editor.tsx` | 39 | 24 | Всего |
| `src/app/(app)/budget/compare/page.tsx` | 2 | 0 | — |
| `src/app/(app)/calendar/month-views.tsx` | 6 | 1 | Вид меха / стадия |
| `src/app/(app)/calendar/pipe-views.tsx` | 3 | 1 | — |
| `src/app/(app)/clients/page.tsx` | 5 | 0 | — |
| `src/app/(app)/dashboard/averages.tsx` | 1 | 0 | — |
| `src/app/(app)/dashboard/price-composition-block.tsx` | 3 | 1 | — |
| `src/app/(app)/dashboard/production-modal.tsx` | 1 | 0 | — |
| `src/app/(app)/dashboard/production-table.tsx` | 1 | 0 | — |
| `src/app/(app)/documents/page.tsx` | 6 | 0 | — |
| `src/app/(app)/documents/todo-summary.tsx` | 3 | 0 | — |
| `src/app/(app)/expense-categories/page.tsx` | 3 | 0 | — |
| `src/app/(app)/fittings/page.tsx` | 6 | 1 | — |
| `src/app/(app)/history/page.tsx` | 5 | 0 | — |
| `src/app/(app)/materials/page.tsx` | 6 | 0 | НДС в ТЗ |
| `src/app/(app)/models/[id]/page.tsx` | 19 | 3 | Расход |
| `src/app/(app)/payments/client-payments-table.tsx` | 8 | 0 | Мех |
| `src/app/(app)/payments/goods-tiles.tsx` | 5 | 0 | Мех |
| `src/app/(app)/payments/page.tsx` | 5 | 4 | — |
| `src/app/(app)/payments/payment-lines.tsx` | 7 | 0 | Мех |
| `src/app/(app)/payments/payments-overview.tsx` | 1 | 0 | — |
| `src/app/(app)/plan/page.tsx` | 12 | 6 | — |
| `src/app/(app)/plan/plan-form.tsx` | 4 | 0 | — |
| `src/app/(app)/plan/seasons/assign-table.tsx` | 5 | 0 | — |
| `src/app/(app)/plan/seasons/page.tsx` | 5 | 0 | — |
| `src/app/(app)/production/[id]/composition-table.tsx` | 5 | 0 | — |
| `src/app/(app)/production/[id]/page.tsx` | 11 | 5 | Кол-во |
| `src/app/(app)/production/[id]/params-table.tsx` | 3 | 1 | — |
| `src/app/(app)/production/batches/[number]/page.tsx` | 14 | 6 | НДС |
| `src/app/(app)/production/batches/page.tsx` | 8 | 5 | — |
| `src/app/(app)/production/import/wizard.tsx` | 2 | 0 | — |
| `src/app/(app)/production/new/form.tsx` | 7 | 0 | НДС; Остаток |
| `src/app/(app)/production/page.tsx` | 15 | 7 | Мех; НДС |
| `src/app/(app)/settings/articles-ref/articles-table.tsx` | 4 | 0 | — |
| `src/app/(app)/settings/articles-ref/import-panel.tsx` | 6 | 0 | — |
| `src/app/(app)/settings/auctions/auctions-table.tsx` | 8 | 1 | — |
| `src/app/(app)/settings/categories/page.tsx` | 10 | 0 | — |
| `src/app/(app)/settings/colors/page.tsx` | 10 | 0 | — |
| `src/app/(app)/settings/fur-attrs/page.tsx` | 7 | 1 | Вид меха |
| `src/app/(app)/settings/furs/furs-table.tsx` | 6 | 0 | — |
| `src/app/(app)/shipments/[id]/page.tsx` | 4 | 1 | — |
| `src/app/(app)/shipments/page.tsx` | 5 | 1 | — |
| `src/app/(app)/suppliers/page.tsx` | 5 | 0 | — |
| `src/app/(app)/supply-plan/page.tsx` | 3 | 1 | — |
| `src/app/(app)/users/page.tsx` | 4 | 0 | — |
| `src/app/(app)/warehouses/page.tsx` | 3 | 0 | — |
| `src/app/(print)/production/[id]/print/page.tsx` | 9 | 1 | Кол-во |
| `src/app/(print)/production/batches/[number]/print/page.tsx` | 6 | 0 | Работа; Себестоимость{c4} |
| `src/components/lot-passport.tsx` | 2 | 0 | — |
| `src/components/lot-products.tsx` | 7 | 1 | {unit === "м" ? "Метров" : "; Доля лота |
| `src/components/lot-sheet-table.tsx` | 4 | 0 | — |
| `src/components/lot-usage-bar.tsx` | 10 | 0 | Доля от лота; Кол-во, {unit}; Остаток, {unit} |
| `src/components/orders-tree.tsx` | 1 | 0 | — |
| `src/components/price-composition.tsx` | 3 | 2 | — |
| `src/components/supplier-debt-hint.tsx` | 5 | 0 | Остаток |
| `src/components/table-head.tsx` | 2 | 0 | — |
| `src/components/tz-vat-badge.tsx` | 5 | 0 | Без НДС; НДС; С НДС |
| `src/components/ui/table.tsx` | 1 | 0 | — |

## Файлы агента «Сырьё» (только инвентарь; правки внесёт агент «Сырьё»)

| Файл | Заголовков | С единицей | Без единицы (проверить) |
|---|---|---|---|
| `src/app/(app)/dashboard/dynamics-tables.tsx` | 14 | 0 | Задолженность; Использовано; Куплено; Оплачено; Остаток |
| `src/app/(app)/dashboard/raw-block.tsx` | 9 | 2 | Доля от купленного; Кол-во; Сумма; Цена |
| `src/app/(app)/lots/auction-view.tsx` | 7 | 0 | — |
| `src/app/(app)/lots/contractor-hides/hides-view.tsx` | 23 | 11 | Стоимость шкур подрядчика |
| `src/app/(app)/lots/cost-breakdown-toggle.tsx` | 3 | 0 | — |
| `src/app/(app)/lots/fur/[fur]/page.tsx` | 6 | 3 | — |
| `src/app/(app)/lots/lining/[batch]/view.tsx` | 13 | 5 | Доля; Использовано; НДС; Остаток |
| `src/app/(app)/lots/lots-table.tsx` | 13 | 0 | — |
| `src/app/(app)/lots/material-lots.tsx` | 8 | 1 | Без НДС; Куплено; НДС; Остаток |
| `src/app/(app)/purchases/[id]/page.tsx` | 17 | 4 | Кол-во; НДС; Себестоимость единицы <InfoH; Сумма{isForeignCurrency && " |
| `src/app/(app)/purchases/batch/lots-step.tsx` | 9 | 0 | Кол-во; Мех; НДС %; Цена |
| `src/app/(app)/purchases/batch/wizard.tsx` | 5 | 0 | Без НДС; С НДС |
| `src/app/(app)/purchases/paste-box.tsx` | 8 | 0 | Кол-во; НДС; Сумма без НДС; Цена без НДС |
| `src/app/(app)/purchases/purchases-tree.tsx` | 19 | 8 | Остаток |
| `src/components/fur-orders-table.tsx` | 12 | 4 | {kind === "lining" ? "Подкла |
| `src/components/fur-selection-total.tsx` | 11 | 5 | Кол-во, {unit}; НДС |


«Без единицы (проверить)» — эвристика по словам-признакам (сумма, цена, кол-во и т.п.): часть колонок осознанно без единицы (единица внутри ячейки: «150 шт.», текстовые поля, смешанные шт./м в одной колонке — `analytics/raw/recon`).
