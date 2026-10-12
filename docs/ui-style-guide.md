# Свод правил оформления интерфейса (эталон — «Главная»)

Назначение: привести разделы Сырьё, ТЗ, Календарь, Изделия, Оплаты, Бюджет к виду Главной (`src/app/(app)/dashboard/*`).
Правило: **не изобретать — переиспользовать** общие компоненты и классы. Меняется только оформление; расчёты, данные, адреса, права не трогать.

Статус «в работе» (другие агенты правят сейчас, финал — в `theme-customer.css` / `src/lib/utils.ts` (format) / общих компонентах; применять только через общие классы и функции, свои копии не заводить):
- формат процентов «x,x%» везде (`formatPercent` / `formatShare`);
- белые / оранжевые заголовки блоков вместо синих и серо-синих полос;
- подсветка строки таблицы при наведении на блок/плитку;
- колонки «Шкур, шт.» / «Подкладка, м» / «Работа» в деревьях (`orders-tree.tsx`, `production-table.tsx`);
- схема лота.

## 1. Принципы

1. **Компактность.** Основной текст `text-sm`, подписи/сноски `text-xs` (12px) и `text-[11px]`; поля фильтров 12px / подпись 10px. Заголовок страницы `<h1 className="text-xl font-semibold">`, блока `<h2 className="text-base font-semibold">`, под-блока `<h3 className="text-sm font-semibold">`. Крупнее — только цифра плитки (`TileValue`, `text-xl`).
2. **Нет значения — «—»**, не «0», не пусто: `dash()` из production-table, `<Dash />` из `src/components/tree-table.tsx`. Нулевые суммы в деревьях тоже «—».
3. **Числа:** `tabular-nums`, правое выравнивание, `whitespace-nowrap`. Деньги — `formatMoney` (от 1000 ₽ без копеек), штуки/метры — `formatQty`, проценты — **только** `formatPercent(v)` (v в процентах) или `formatShare(0..1)`. Запрещено: `.toFixed(...)+"%"`, `Math.round(x)+"%"`, запятая вручную.
4. **Пояснения — в «i»** (`InfoHint`, `src/components/info-hint.tsx`; `wide`, `align="right"`), а не абзацем под блоком. Под плиткой — максимум одна мелкая строка (`TileCaption`, `VatLine`).
5. **Акцент — оранжевый**, только через токены: `--ui-accent` (рамки, линия над итогом), `--ui-soft` (подложка итога), `--ui-accent-text` (число итога), `--ui-field-bg` (активный фильтр). В теме «Текущий стиль» те же токены нейтральные. Запрещено: жёсткие `#ff4a1c`, `bg-blue-*`, `bg-sky-*`, `bg-slate-*`, `bg-indigo-*`, `style={{color:...}}` для акцента. Тема `customer` уже переопределяет `neutral-900` → акцент и `blue-*` → оранжево-красный, поэтому `bg-neutral-900 text-white` (активная кнопка/сегмент), `text-blue-700` (ссылка), `border-neutral-900` (выбранное) — **допустимы и правильны**.
6. **Две темы** (`customer` по умолчанию / `current`, cookie `uiTheme`, `src/lib/ui-theme.ts`, переключатель `src/components/theme-toggle.tsx`). Любое решение проверять в обеих. Новые цвета — только через токены темы (`--cv-*`, `--ui-*`) в `theme-customer.css`, не в страницах.
7. **Доступность:** контраст ≥ AA (второстепенный текст не светлее `--cv-muted` #5a6a94; `text-neutral-300/400` тема сама затемняет); фокус виден (тема даёт 3px outline — не гасить `outline-none` без замены); интерактив — `<button>`/`<a>`, не `<div onClick>` (если иначе — `role`, `tabIndex`, Enter/Space, как `Card` в raw-block); `aria-label` на иконках/стрелках; `aria-expanded` на раскрытии, `aria-pressed` на переключателях, `role="tablist"` на сегментах; на телефоне цель нажатия ≥ 40px (глобальное правило в globals.css; исключения — `data-touch-ok`).
8. **Адаптив:** 375 / 768 / 1714 без горизонтальной прокрутки **страницы**. Прокрутка внутри таблицы допустима только в контейнере (`overflow-x-auto`, `SCROLL_BOX` с классом `scroll-hint`), и лучше сократить колонки/названия (`shortMaterialName`), чем прокручивать. Проверять `document.documentElement.scrollWidth <= innerWidth`.
9. **Печать:** кнопки/фильтры `print:hidden`, плитки `print:break-inside-avoid`. Не ломать.

## 2. Шапка страницы и панель фильтров

Шапка (эталон `dashboard/page.tsx`):
```tsx
<div className="flex flex-wrap items-center justify-between gap-2">
  <div className="flex flex-wrap items-center">
    <h1 className="text-xl font-semibold">Раздел</h1>
    <PageModes info={{ year: yl, filters: activeFilters || null }} c4={c4Mode} />  {/* «· все годы · с НДС · с 4% ⓘ» */}
  </div>
  <PrintButton />
</div>
```
- Режимы (год, НДС, 4%) показывает **одна** строка `PageModes` рядом с `h1`, не внутри заголовка и не дублируется в блоках. Год — общий (`getYearFilter`, `YearNote`), НДС и 4% — переключатели в шапке сайта (`useVatDisplay`, `getCommission4Mode`).
- Фильтры — **только** `FilterBar` (`src/components/filters/filter-bar.tsx`) с контролами `type: "multi" | "text" | "date"`. Нативные `<select>` и самодельные чипы-фильтры — заменить.
```tsx
<div className="print:hidden">
  <FilterBar title="Фильтры …" oneRow hideChips dropOnChange={["status"]}
    controls={[{ type: "multi", name: "fur", label: "Вид меха", options, allLabel: "Все виды", noneLabel: "Без вида", hint: "…" },
               { type: "multi", name: "kind", label: "Тип", single: true, options, allLabel: "Все" }]}
    footer={<p className="mt-2 text-[11px] leading-4 text-neutral-500">Фильтры применяются сразу <InfoHint label="Что фильтруется" wide>…</InfoHint></p>} />
</div>
```
- `oneRow` + `hideChips` — режим Главной: сетка `grid-cols-[repeat(auto-fit,minmax(8.25rem,1fr))]`, одна строка на широком экране, перенос на узком. Параметры вида (не фильтры) — `state: true`; второстепенные — `more: true` («Ещё фильтры»).
- Поле: класс `.ui-field` (рамка `--ui-accent` при hover/focus/open/`[data-active]`), высота `h-11`, `rounded-lg`, текст `text-xs`, мини-подпись 10px `uppercase font-semibold`. Свои `<input>` рядом с панелью — те же классы: `ui-field h-11 rounded-lg border border-neutral-300 bg-white px-3 text-xs`.
- **Режим групп по годам:** `MultiSelectFilter` умеет сгруппированные опции (группа = год, чекбокс «весь год», «N из M»). Для партий/аукционов/ТЗ/закупок по годам передавать опции с группой-годом, а не плоским списком.
- Подсказка фильтра — `hint` (рядом «i»), общий абзац «что фильтруется» — в `footer` через `InfoHint`.
- Пока страница пересчитывается, всё после `[data-filter-bar]` бледнее (globals.css) — ничего не делать.
- Чекбоксы/радио — `accent-neutral-900`. Кнопки-действия — `btn-accent` (+ `h-7 rounded-md border px-2 text-xs`).

## 3. Ряд виджетов (плитки)

Любая группа плиток — внутри `WidgetRow` (`src/components/widget-row.tsx`):
```tsx
<WidgetRow id="prod" title="Производство" headerEnd={<Link href="/production" className="text-xs text-blue-700 hover:underline">→ ТЗ</Link>}>
  <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">…плитки…</div>
</WidgetRow>
```
- `title` — короткий (1–3 слова: «Сырьё — мех», «Оплаты», «План — выполнение»). `id` уникален на странице; состояние «свернуто / закреплено» хранится в `localStorage` по ключу `widgets:<путь>:<id>` — менять `id` нельзя без нужды.
- Правая колонка: **сверху** ссылка раздела «→ Раздел» (`headerEnd`), **под ней** кнопки «Свернуть» / «Закрепить». Не выносить ссылку в отдельный заголовок-строку над рядом (как сейчас сделано в `ProductionBlock`/`dashboard/page.tsx` для «→ Оплаты» — привести к `headerEnd`).
- Плитка — `TILE_BOX` + составные части из `dashboard/tile.tsx`: `TileHead` (подпись, 12px, до 2 строк, `pr-6` под «i»), `TileValue` (крупная цифра, `min-h-7`), `TileCaption` (мелкая пояснялка, `min-h-5`), `TileList` (строки «статья — сумма — доля %»). «i» — `absolute right-3 top-3` (см. `Card` в raw-block).
- **Выравнивание строк между плитками**: высоты заголовка/значения/подписи зарезервированы (`min-h-*`), «пустые» места держим `SubLines n=…`, `VatLine minRem=…` или невидимой «призрачной» строкой (`ghost`). Одинаковые по смыслу строки соседних плиток стоят на одной горизонтали. Не вставлять в одну плитку лишнюю строку без резерва в соседних.
- **Адаптив:** `grid-cols-1 md:grid-cols-3` (или `raw-row`/`raw-tiles` для шести плиток: 6 в ряд ≥1280px, 3+3 до 1280, горизонтальная лента на телефоне). На <640px любой `.grid` с `.tile-box` внутри автоматически становится лентой со snap (globals.css) — отдельной вёрстки не нужно, **плитки должны лежать прямо в `.grid`** (или в `.relative`-обёртке).
- Кликабельная плитка: `TILE_BOX + " tile-click"` — оранжевая рамка при hover / active / focus-visible (ширина рамки постоянна, раскладка не прыгает). Корень — `<button>`/`<a>` или `role="button" tabIndex={0}` с Enter/Space; `aria-haspopup="dialog"` если открывает окно. Некликабельной плитке `tile-click` не ставить.
- Фон плитки в теме customer — серо-голубая подложка без рамки (`.tile-box`), число `text-xl` → 1.4rem/800. Не переопределять цвета в странице.

## 4. Карусели плиток

`TileCarousel` (`src/components/tile-carousel.tsx`) — когда у плитки несколько срезов:
```tsx
<TileCarousel clickable title="Себестоимость" hintLabel="Что такое себестоимость" hint={<p>…</p>}
  slidesLabel="слайды: тотал, одежда, аксессуары" dotsLabel="Группа"
  slides={[{ key: "total", label: "Тотал", body: … }, ...PROD_GROUPS.map(g => ({ key: g, label: g, body: … }))]} />
```
- Порядок слайдов: **«Тотал» первым**, далее группы (Одежда, Аксессуары) или виды меха. Тотал = сумма остальных.
- Заголовок плитки автоматически «Название · Подпись слайда». Стрелки — константа `CAROUSEL_ARROW` (32×32, без рамки, hover — оранжевая подложка); точки (`role="tab"`, активная `w-5 bg-neutral-900`); жест-прокрутка со snap и клавиши ←/→. Свои стрелки/точки не делать.
- Переключатель «Все · Одежда · Аксессуары» внутри слайда — `GroupSwitch` (тот же файл). Фильтр срезов уровня страницы — в `FilterBar`, не в плитке.
- Примеры: `dashboard/production-block.tsx`, `dashboard/averages.tsx`, `articles/article-widgets.tsx`, `src/components/prod-tiles.tsx`, `prod-group-slides.tsx`.

## 5. Таблицы

Эталоны: `dashboard/dynamics-tables.tsx` (YearsTable, RawTable), `dashboard/production-table.tsx`, `src/components/orders-tree.tsx`; общие классы — `src/components/tree-table.tsx`.

Раскладка:
- Контейнер: `rounded-lg border border-neutral-200 bg-white p-3` (или `SCROLL_BOX`); внутри `table w-full table-fixed text-left`. `min-w-[…]` + `overflow-x-auto` только если колонок реально много (`production-table`: 1100px).
- **Первая колонка ~160–170px**: стрелка `›` (`Chevron`/`ARROW_TD`, у всех строк на одной вертикали) + название; остальные колонки — **равной ширины**, числа **справа** (`TD`, `TH`: `px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap`). Заголовки колонок `text-xs font-medium text-neutral-500`, короткие, с единицей через запятую: «Изделий, шт.», «Подкладка, м», «Ср. цена, ₽».
- **Блоки колонок:** надзаголовок блока (`text-[11px] font-semibold uppercase tracking-wide text-neutral-500`, `colSpan`, нижняя линия) + тонкая вертикальная линия слева у первой колонки блока: `const BL = " border-l border-neutral-200"` в `th` и во всех `td` блока. Пример: «Производство | Расходы | Среднее».
- Уровни: 0 — `text-sm font-semibold`; 1 — `text-[13px]`/`text-xs` на `bg-neutral-50/70`; 2+ — `text-xs` серым; отступ `style={{paddingLeft: depth*16}}` или `INDENT`. Функция `rowTone(level, open)` — раскрытая строка становится `text-neutral-900`.
- **«›» только если строка реально раскрывается** (есть дети); у листа вместо стрелки — выравнивающий пробел `inline-block w-4`. Раскрытие — `<button aria-expanded aria-label="Раскрыть: …">`, стрелка `rotate-90`.
- **Переходы из строк:** лист дерева — ссылка `↗` (`text-[10px] text-neutral-400`) в раздел с фильтрами в query (`/articles?catgroup=…&fur=…`, переносить год — из cookie, цвет/партию — из фильтров страницы). Заголовок ссылки: «Открыть в «Изделиях» с этими фильтрами». Названия ссылок — `hover:underline`, без синего цвета в самой строке.
- **Итог:** `<tr className="row-total">` (подложка `--ui-soft`, линия 2px `--ui-accent`, жирный `--ui-accent-text`) и в первой ячейке `<TotalLabel />`:
```tsx
<tr className="row-total"><td className="py-1.5 pr-2 text-sm"><TotalLabel unit="₽" note="с ремонтом" avg /></td>{cells(total)}</tr>
```
  `unit`: «₽», «шт.», «м», «₽/шт.»; `note` — мелко («с ремонтом» / «без ремонта»); `avg` — итог средневзвешенный → «i». Итог блоком (не таблица) — `<div className="row-total">`. Любые «Итого», «Всего (без…)» самописные — заменить.
- **«Ремонт»** — отдельная строка под итогом «без ремонта», в первой ячейке кнопка-ссылка синего цвета (`inline-flex rounded-lg border border-[#1d4ed8] … text-[#1d4ed8]`, `href="/repair"`), штуки в «—»; затем второй `row-total` «Всего, ₽ — с ремонтом». Ремонт в штуки/средние не входит.
- Пустое/ноль — «—»; загрузка — «Загрузка…» `text-sm text-neutral-500`.
- Сегмент «Категории → мех / Мех → категории»: `role="tablist"`, `inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs`, активная `bg-neutral-900 text-white`.
- Не использовать для новых таблиц голую `Table/Thead/…` из `ui/table.tsx` с собственными полосами цвета — только если нужен простой список без итога; всё равно шапка белая, итог `row-total`.

## 6. Окна детализации (модалки)

Эталон: `dashboard/production-modal.tsx` (также `averages.tsx`, `budget/ui.tsx`).
- `role="dialog" aria-modal="true" aria-labelledby=…`, затемнение `fixed inset-0`, контент `max-h-[90vh] overflow-y-auto rounded-lg bg-white`, ширина `max-w-*`, на 375px — почти на весь экран, без горизонтальной прокрутки.
- Закрытие: кнопка «✕/Закрыть» (`aria-label`, первая в фокусе при открытии), **Esc**, клик по подложке. Фокус зациклен (Tab/Shift+Tab), после закрытия фокус возвращается на плитку-источник.
- Заголовок: `text-base font-semibold` + «i»; режим/срез — сегмент как в п.5.
- Внутри те же правила таблиц: блоки колонок с линиями `BL`, итог `row-total`/`TotalLabel`, доли `PartCell` (сумма + `text-[11px] text-neutral-500` доля через `formatShare`), «—» вместо нуля.
- Суммы окна обязаны сходиться с плиткой-источником (там есть `totals`); не менять расчёт.

## 7. Строковые соглашения

| Что | Как |
|---|---|
| Итог | «Всего, ₽» / «Всего, шт.» / «Всего, м» (`TotalLabel`); мелко — «с ремонтом», «без ремонта» |
| Ткань | `shortMaterialName(name)` (`src/lib/material-name.ts`): «Подкладочная ткань №2» → «Ткань №2». Только отображение |
| ТЗ / позиции | единица «ТЗ» = уникальный номер ТЗ из документа; считать `uniqueOrderCount`, подпись — `tzCountText(orders, items)` из `src/lib/tz-key.ts`: «167 ТЗ · 182 позиции» (позиции — только если их больше). Суммы/штуки — по записям |
| 4% | в режиме «с 4%» под суммой мелко (`text-[11px] text-neutral-500`): «без 4%: X ₽»; в «Использовано» — «с 4%: X» и «надбавка Y» |
| НДС | `VatLine`: «в т.ч. НДС: 20% — X ₽ · 22% — Y ₽» (одна ставка — «в т.ч. НДС 22% — X ₽»; в режиме «без НДС» — «НДС (не вх.): …»); `vatEntries` отсекает нули |
| Проценты | один знак: «12,3%», «90,0%», «<0,1%» (`formatPercent`); доли `formatShare`; серым `text-[11px] text-neutral-500` рядом с суммой |
| Блоки | заголовки короткие: «Сырьё — мех», «Производство», «Оплаты», «Себестоимость», «Произведено» |
| Ссылки разделов | «→ ТЗ», «→ Оплаты», `text-xs text-blue-700 hover:underline print:hidden` |
| Единицы | в заголовке колонки/подписи через запятую («Подкладка, м», «Цена, ₽/шт.»), в ячейке единицу не повторять (в плитках — «150 шт.») |
| Пусто | «—»; в фильтрах — «Без …» / «… не указан» |

## 8. Чек-лист «привести страницу раздела к стилю Главной»

Заменить:
- [ ] самодельные карточки-цифры → `TILE_BOX` + `TileHead/TileValue/TileCaption/TileList`, ряд → `WidgetRow` с `headerEnd` «→ Раздел»; срезы → `TileCarousel`;
- [ ] фильтры (нативные `<select>`, чипы, самодельные формы) → `FilterBar` + `MultiSelectFilter`, поля `.ui-field`, группы по годам;
- [ ] таблицы → раскладка п.5 (`table-fixed`, 1-я колонка 160–170px, равные числовые, правое выравнивание, блоки `BL`, `Chevron`/`›` только у раскрываемых);
- [ ] итоги → `row-total` + `TotalLabel`; «Ремонт» → отдельная синяя кнопка-ссылка;
- [ ] кнопки/чипы/сегменты → акцентные классы (`btn-accent`, активная `bg-neutral-900 text-white`, `tile-click`), без жёстких цветов;
- [ ] синие/серо-синие/слейтовые полосы заголовков (`bg-blue-*`, `bg-sky-*`, `bg-slate-*`, `bg-indigo-*`) → белые / оранжевые заголовки блоков (общий класс, когда появится в `theme-customer.css`); выделение выбранной строки `bg-blue-50/60` → токен акцента;
- [ ] проценты → `formatPercent` / `formatShare`; нули → «—»; НДС → `VatLine`; ТЗ → `tzCountText`;
- [ ] длинные пояснения → `InfoHint`; режимы → `PageModes`; год → общий.

Не трогать: расчётные функции, `src/lib/*` (кроме общих форматтеров), Prisma, server actions, права, адреса страниц, `localStorage`-ключи.

Проверка (все пункты обязательны, результат — в отчёте):
1. `npx tsc --noEmit` — без ошибок; `npx eslint <изменённые файлы>` — без ошибок/предупреждений.
2. `npx tsx scripts/test-reconciliation.ts` — **375 / 0** (375 прошло, 0 упало), если страница считает суммы.
3. Dev-сервер `http://localhost:3200`, вход «Подставить email и пароль» → «Войти». Скриншоты **375, 768, 1714**; на каждом `document.documentElement.scrollWidth <= innerWidth`; после проверок вернуть окно 1714×1000. Обе темы (`customer`, `current`).
4. Контраст: текст ≥ 4,5:1, крупный/UI ≥ 3:1; фокус с клавиатуры виден; Esc закрывает окна и «i».
5. Сверить цифры раздела до/после (суммы, штуки, число ТЗ) — оформление не должно их менять. Печать (`print:`) не сломана.

## 9. Карта разделов (быстрый аудит по коду)

Условные обозначения: ✔ уже в стиле, ✘ расхождение.

**Сырьё** — `/lots` (`lots/page.tsx`, `summary-view.tsx`, `auction-view.tsx`, `lots-table.tsx`, `lots-filters.tsx`), `/purchases` (`purchases/page.tsx`, `purchases-tree.tsx`, `[id]/page.tsx`), `/materials` (`materials/page.tsx`), старые `/raw-materials`, `/lining` (тонкие редиректы-обёртки).
Переиспользовать: `RawCards`, `YearsTable`, `RawTable`, `PayTiles`, `FilterBar`, `TileCarousel`, `VatLine`, `TotalLabel`.
- ✔ `/lots` уже встраивает `RawCards`, `YearsTable`, `RawTable`, `PayTiles`, `FilterBar`, `TotalLabel`/`row-total`.
- ✘ `/lots` не использует `WidgetRow` на уровне страницы (только внутри `RawCards`); `lots-table.tsx`: выделение строк `bg-blue-50/60`, `border-blue-300`; нативные `<select>` (`lots-filters.tsx`, `auction-view.tsx`); `ui-field` нигде не применён.
- ✘ `/purchases/[id]` и `purchases/batch/lots-step.tsx`: `<select>` и синие заливки, проценты частично через `toFixed`; плитки есть (`TileHead`), но без `tile-click`/резерва высот.
- ✘ `/materials`: нет плиток/итога/`Dash`, простая таблица без блоков колонок; форма без `ui-field`.
- ✘ `purchases-tree.tsx`: свои стрелки/цвета вместо `Chevron`/`rowTone`.

**ТЗ** — `/production` (`production/page.tsx`, `grouped-view.tsx`, `tz-group-rows.tsx`, `filters-details.tsx`), `/production/[id]` (`order-tiles.tsx`, `composition-table.tsx`), `/production/batches[/номер]`, `/shipments`, `/fittings`, `/plan` (`plan/page.tsx`), `/supply-plan`.
Переиспользовать: `ProdTiles`, `OrdersTree`, `tree-table.tsx`, `TileCarousel`, `tzCountText`.
- ✔ `/production`: `FilterBar`, `WidgetRow`, `TotalLabel`; `/plan` — `WidgetRow` + `Tile*` («План — выполнение»).
- ✘ `/production`: `filters-details.tsx` — отдельная `<details>`-панель параллельно `FilterBar`; `production/new/form.tsx`, `import/wizard.tsx`, `[id]/batch-field.tsx` — нативные `<select>` и синие заливки.
- ✘ `/shipments`, `/fittings`, `/supply-plan`: нет плиток/`WidgetRow`, нет `Dash`, итоги не везде `row-total`; `/fittings` — кнопки не акцентные.
- ✘ `/plan`: `plan-form.tsx` 419 строк на нативных контролах; проценты/счётчики ТЗ не через `tz-key`.
- ✘ Деревья ТЗ: колонки «Шкур, шт.» / «Подкладка, м» / «Работа» — в работе, не копировать по-своему.

**Календарь** — `/calendar` (`calendar/page.tsx`, `month-views.tsx`, `pipe-views.tsx`, `day-panel.tsx`, `event-form.tsx`).
Переиспользовать: `FilterBar`, `WidgetRow`+`Tile*` для сводки, модалка п.6, `Dash`, `TotalLabel`.
- ✔ `FilterBar`, `TotalLabel` в таблице.
- ✘ Нет ряда плиток вверху (сводка по периоду → `WidgetRow`); карточки на `Card/CardHeader/Badge` (`components/ui`) вместо `TILE_BOX`.
- ✘ `pipe-views.tsx`: ссылки внутри текста `text-blue-700` (допустимо), но свои заливки и ручные заголовки блоков; `day-panel`/боковая панель `role="dialog"` без Esc/фокус-ловушки как в п.6 (проверить).
- ✘ Кнопки навигации по месяцам/режимам — `bg-neutral-900` вручную; нет `ui-field`/`btn-accent`; режимы страницы без `PageModes`.

**Изделия** — `/articles` (`articles/page.tsx`, `article-widgets.tsx`, `article-dialog.tsx`, `price-form.tsx`), `/models/[id]` (`models/[id]/page.tsx`, `bom-*`), `/repair` (`repair/page.tsx`, `repair-tiles.tsx`).
Переиспользовать: `TileCarousel`, `ProdTiles`, `OrdersTree`, `FilterBar`, `GroupSwitch`.
- ✔ `/articles` — эталон карусели (`TileCarousel`, `TileList`), `FilterBar`, `row-total`; `/repair` — `WidgetRow`.
- ✘ `/models/[id]`: 6 вхождений синих/цветных заливок и `<select>`, проценты через `toFixed`, нет `FilterBar`, нет `WidgetRow` вокруг плиток.
- ✘ `/repair`: нет фильтров, нет итога `row-total`, нет перехода «→» обратно на Главную/ТЗ; плитки без `tile-click`.
- ✘ `/articles`: плитки не в `WidgetRow` одного вида с Главной (заголовок/действия справа) — сверить; диалог артикула (`article-dialog.tsx`) без единого заголовка/Esc.

**Оплаты** — `/payments` (`payments/page.tsx` 955 строк, `payments-overview.tsx`, `goods-tiles.tsx`, `client-payments-table.tsx`, `client-debt-block.tsx`, `payment-lines.tsx`, `auction-payment-form.tsx`).
Переиспользовать: `PayTiles` (уже на странице), `WidgetRow`, `TotalLabel`, `VatLine`, модалка п.6.
- ✔ `PayTiles`, `WidgetRow`, `FilterBar`, `row-total` (4 таблицы), `formatShare`.
- ✘ `payments-overview.tsx`, `client-payments-table.tsx`: синие ссылки/заливки, самодельные заголовки колонок вместо `TH`/блоков `BL`.
- ✘ `goods-tiles.tsx`/`payment-tiles`: плитки нескольких стилей (часть без резерва высот и `tile-click`).
- ✘ `auction-payment-form.tsx` подтверждение `role="dialog"` — свой вид; привести к п.6 (Esc, фокус, заголовок).
- ✘ Страница-монолит: ряды плиток без единых `id`/`headerEnd` «→ Раздел».

**Бюджет** — `/budget` (`budget-list.tsx`, `budget-editor.tsx` 810 строк, `ui.tsx`, `add-dialog.tsx`, `compare/page.tsx`, `[id]/page.tsx`, `format.ts`).
Переиспользовать: `WidgetRow`/`Tile*`, `row-total`+`TotalLabel`, `formatPercent`, модалка п.6, `FilterBar` для списка.
- ✔ `budget-editor.tsx` уже: `WidgetRow id="budget-totals"` («Всего, ₽ по бюджету»), `row-total`, `formatPercent`.
- ✘ Нет `FilterBar` на списке/сравнении; нативные `<select>`; синие заливки (`budget-editor`, `ui.tsx`).
- ✘ `ui.tsx` диалог (`role="dialog"`) — без фокус-ловушки/Esc по п.6 (проверить); `add-dialog.tsx` — отдельный вид.
- ✘ Таблицы-редакторы: нет `table-fixed`/равных числовых колонок; нули не «—»; `format.ts` (локальный форматтер) — проверить, что проценты идут через общий `formatPercent` (правится сейчас).

Приоритет внедрения: (1) единые `FilterBar`+`.ui-field` вместо `<select>` по всем разделам; (2) `WidgetRow`+`Tile*` с `headerEnd` «→ Раздел» на Календаре, Моделях, Ремонте, Отгрузках; (3) `row-total`+`TotalLabel`, «—» и `formatPercent` в оставшихся таблицах; (4) единый вид модалок.
