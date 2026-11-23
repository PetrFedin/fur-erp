# Аудит 22.11.2026: «Производство» и «Изделия»

Метод: только чтение кода (ветка `main`, HEAD `173c44b4`). Ничего не запускалось, база и браузер не открывались: числа на живых данных не сверялись. Пути даны от `/Users/petr/Projects/fur-erp`; сокращение `app/` = `src/app/(app)/`, `lib/` = `src/lib/`.

Что уже сделано после ревизии 15.11 (`docs/ux-review/03-production-articles.md`): в `git log` с 15.11 по файлам `app/articles`, `app/production`, `app/models`, `lib/article-*` коммитов нет. Поэтому почти все находки 15.11 помечены «осталось». Изменилось рядом: режимы шапки по страницам (`lib/page-modes.ts`, 55b979da), ₽/€ убран с Главной (`app/(app)/dashboard/dash-currency.tsx` ещё есть), витрина читается одним экраном (`lib/margin-server.ts:92`), пересборка витрины после загрузок (`app/(app)/settings/import/actions.ts:52,65`), цена артикула переносится в открытые ТЗ (`lib/article-save.ts:119`, это закрывает пункт 8 из `docs/analysis/dependencies.md` частично: только ТЗ в плане и в работе).

---

## 1. Назначение разделов и роли

**Производство** (`/production`, пункт меню в `src/components/nav-links.ts:8`): ТЗ (технические задания подрядчику), их расчёт себестоимости из списаний лотов сырья, партии пошива, загрузка ТЗ из файлов. Скрытые модули: Примерки, План заказа, Сезоны ТЗ (`lib/hidden-modules.ts:14-20`). «План поставок» видим (`supplyPlan: false`).

**Изделия** (`/articles`, `nav-links.ts:9`; в «also» подсвечивает `/models`, `/finished-stock`, `/repair`, `/analytics/products|pricing|margin`): артикулы (ProductModel) с выпуском, себестоимостью, ценой, наценкой, складом, фото; карточка артикула `/models/[id]`.

Роли (`lib/access.ts`, `lib/production-access.ts`, `prisma/schema.prisma:253`):

| Действие | Кто | Где проверяется |
|---|---|---|
| Читать списки, карточки, партии, аналитику, маржу, цены, себестоимость | любая роль кроме SUPPLIER: OWNER, ADMIN, PURCHASER, WAREHOUSE, TECHNOLOGIST, ACCOUNTANT, VIEWER | `requireSession()` без `allowSupplier` (`lib/session.ts:81-89`) |
| Создать / править / списывать / завершить ТЗ, загрузить ТЗ | OWNER, ADMIN, TECHNOLOGIST | `lib/production-access.ts:6`, `requireRole(...EDIT_ROLES)` в `app/(app)/production/actions.ts`, `import-actions.ts:34,69,111` |
| Править артикул, цену, вкл/выкл, фото, PLU | OWNER, ADMIN, TECHNOLOGIST (`ACCESS.models`) | `app/(app)/models/actions.ts:15,19`, `articles/active-actions.ts`, `models/photo-actions.ts`, `models/shop-actions.ts` |
| План поставок (запись) | `ACCESS.supplyPlan` = OWNER, ADMIN, TECHNOLOGIST | `supply-plan/actions.ts` |
| План заказа, сезоны | `ACCESS.planning` = те же | `plan/page.tsx:46` |
| Примерки (запись) | OWNER, ADMIN, TECHNOLOGIST (список ролей прописан строкой, не из `access.ts`) | `fittings/page.tsx:38`, `app/api/fittings/route.ts:7` |
| Подрядчик (SUPPLIER, Веллмех) | `/articles` — отдельный вид без денег (`articles/supplier-view.tsx`, `articles/page.tsx:113`); карточка артикула редиректит на `/articles` (`models/[id]/page.tsx:89`); `/production` и остальное — редирект на `/supplier` | `requireSession` |

Замечания по ролям:
- Бухгалтер, кладовщик, наблюдатель (VIEWER) видят себестоимость, цены и наценку всех артикулов: ограничения нет, в `access.ts` нет понятия «видеть деньги производства». Решение владельца, если нужно сузить.
- `/models/new` открыт любой роли кроме поставщика и рисует рабочую форму (`ArticleForm` по умолчанию `canEdit = true`, `app/(app)/models/article-form.tsx:86`; страница роль не проверяет, `models/new/page.tsx`). Сохранение у не-редактора кончается редиректом `forbidden` (`requireRole` в `saveArticleForm`, `models/actions.ts:86-87`). Мелкий дефект: форма есть, прав нет.

---

## 2. Карта экранов

Условные обозначения источника: **витрина** = таблицы `Dm*` / представления `vDm*`; **старые таблицы** = ProductionOrder, ProductionMaterialUsage, ProductModel, FinishedGoodsStock и т.д.; **JSON** = `SystemState` (отчёт `sales-report-sizes`, прайс `retail-prices`, фото и ссылки магазина); **статика** = файлы в `src/lib/data`, константы в коде.

**Главный факт: ни один экран этих двух разделов не читает витрину.** `grep` по `src` находит `lib/mart` только в `lib/margin-server.ts:92` (итоги сезонов для Главной, `app/(app)/dashboard/page.tsx:68`), `settings/import/actions.ts` (пересборка) и самой витрине. Представления `vDm*` в `src` не упоминаются вообще, только в миграциях и `scripts/mart-verify.ts`. В `docs/data-mart/MIGRATION-STATUS.md` строка «Итоги сезонов … Главная, Производство» относится к блоку «Производство» на Главной (`dashboard/production-block.tsx:57`), а не к странице `/production`.

### 2.1 `/production` (`app/(app)/production/page.tsx`, 781 строк)

| Блок | Данные и функция | Источник | Куда ведут клики |
|---|---|---|---|
| Вкладки ТЗ · Партии пошива · План поставок (Примерки, План заказа скрыты) | `components/production-tabs.tsx` | флаги `lib/hidden-modules.ts` | `/production/batches`, `/supply-plan` |
| Кнопки «Загрузить ТЗ», «+ Новое ТЗ» (только edit-роли) | `page.tsx:613-619` | — | `/production/import`, `/production/new`; «Сезоны ТЗ» скрыта флагом, но ветка в коде (`page.tsx:613`) |
| Переключатель «Группа» + 18 фильтров | `PROD_FILTERS` `page.tsx:69`, `FilterBar` `:647`; список видов меха `loadOrderRows(orgId,"all",c4)` `:108` | старые таблицы (`lib/analytics-orders.ts:437`) | `?catgroup=…` и др. Группа дублируется (`:623-644` и фильтр `:657`) |
| Плитки «Итоги» (3) | `ProdTiles` `:679` ← `slimForTiles(drill)`; `drill = loadOrdersDrill` `:366` (`lib/orders-drill.ts`) → `loadDrillOrders` (`lib/dashboard-data.ts:188`) | старые таблицы + оплаты (шкуры подрядчика, `loadPaymentsOverview`) + отчёт-JSON (доля «произведено» по приходу, `receivedByModel`) | ссылка «→ Партии пошива» `:679` (дубль вкладки) |
| Таблица ТЗ, 13 столбцов | `priced`/`fullOf`/`statOf` `:334-390`: `sumUsagesWith4` + работа `clientWorkPricePerUnit×orderUnits` + шкуры подрядчика `allocateHides` `:355` | старые таблицы + константы `HIDES_ALLOC` (`lib/contractor-hides.ts:9`) | строка → `/production/[id]`; номер партии → `/production/batches/[n]`; артикул → `/models/[id]`; «Word» в ячейке → `/api/production/[id]/word` |
| Переключатель «Поставлен» | `DeliveredSwitch`, `delivOf` `:270`; запись `markOrdersDelivered` | `ProductionOrder.status/producedQuantity`, `ShipmentLine` ACCEPTED `:266` | действие меняет склад (см. 3.1) |
| Итог «Всего, ₽ по списку» | `showTotals(drill)` `:370` | как плитки | подсказка `C4Hint` |
| Недостижимая ветка `OrdersTree` | `const grouped = false` `:98`, ветка `:681-695` | — | мёртвый код |

Поиск: `q` ищет по `workOrderNumber`, `number`, названию модели, заказчику, лоту/закупке (`page.tsx:194-203`); приставки «ТЗ », «№» не срезаются (запрос «ТЗ 198» ничего не найдёт). Редирект старого `?view=batches` сделан (`:97`).

### 2.2 `/production/[id]` — карточка ТЗ (`production/[id]/page.tsx`, 634 строки + 16 компонентов)

| Блок | Функция | Источник |
|---|---|---|
| Заголовок «ТЗ N · поз. i/k», системный номер П-2026-… только в `title` (`:398`) | `orderLabel` | `ProductionOrder.workOrderNumber`, `number` |
| Плитки «Итоги ТЗ» | `OrderTiles`; сумма из `loadOrdersDrill({ids:[id]})` `:237` | старые таблицы |
| Таблица «Расчёт»: мех, подкладка, расходы, работа, шкуры подрядчика | локальный расчёт `sumUsagesWith4` `:210-211`, `grandIncl = projected + work + hides` `:~324`; «projected» = сумма строк списаний, а не снимок `totalCost` | старые таблицы + `drill.hI` (константы) |
| Параметры ТЗ (~25 строк, правка на месте) | `ParamsTable` → `patchProductionOrder` (`actions.ts:675`) | `ProductionOrder` |
| «+ Добавить»: мех (лот), мех списком, подкладка, расходы, по составу модели | `addMaterialUsage` `:860`, `addMaterialUsagesBulk` `:912`, `applyBomToOrder` `:980`, `addProductionExpense` `:1186` | пишут `ProductionMaterialUsage`, `ProductionExpense`, остаток лота |
| Меню «⋯»: документы, оплаты, подтверждение, история, .docx, завершить, отменить, цвета | ссылки `:411-416` → `/documents`, `/payments`, `/verify`, `/history`, `/api/production/[id]/docx` | — |
| «Завершить ТЗ» | `completeProductionOrder` `actions.ts:1286` | см. 3.1 |
| Отгрузки, документы-основания, оплаты за работу, история, комментарии | `shipment`, `SourceDocs`, `DocsPay` | старые таблицы, Drive |

### 2.3 `/production/new`, `/production/import`, `/production/batches*`

| Экран | Что показывает / пишет | Источник | Файл |
|---|---|---|---|
| `/production/new` | форма ТЗ: артикул, № ТЗ (предлагается max+1), партия, лоты (вставка из Excel), расходы, итог считается в браузере | `ProductModel`, склады, `RawMaterialLot`, партии | `production/new/page.tsx`, `form.tsx` (732 строки), запись `createProductionOrder` `actions.ts:147` |
| `/production/import` | мастер «источник → проверка → пересчёт»: xlsx/csv/docx/pdf → черновики → ТЗ + списания одной транзакцией | `lib/tz-import-*.ts`; пересчёт `orderStat`/`batchTotals` | `production/import/wizard.tsx`, `import-actions.ts:33,68,110`, `revalidateAll` `:302` |
| `/production/batches` | список партий, плитки, 4 режима дерева (Партии / Годы→партии / Артикулы / Категории), «остаток работы» | `loadBatchesWithOrders` (`lib/batch-stats.ts`), `batchTotals` — **себестоимость без работы, с 4 % по режиму** (`batch-stats.ts:57-65`), `loadClientDebt` (оплаты) | `production/batches/page.tsx` |
| `/production/batches/[n]` | таблица ТЗ партии, оплаты, документы, печать | то же + `DocsPayPanel` | `batches/[number]/page.tsx` (462 строки) |

### 2.4 `/articles` (`app/(app)/articles/page.tsx`, 678 строк)

| Блок | Функция (строка) | Источник |
|---|---|---|
| Таблица, 24 столбца (14 включены) | `ARTICLE_COLUMNS` `:80-105`, `ColumnPicker` | — |
| Выпуск, шкуры, подкладка, работа, полная себестоимость, за ед. | `allDrill = loadOrdersDrill(orgId,year,c4)` `:190`; `sumOrders/sumTotal` `:205-212`; `articleMetrics` (`lib/article-metrics.ts:60`) | старые таблицы (+ константы шкур подрядчика, + отчёт-JSON для доли «произведено») |
| «На складе, шт.» | `:215`: если отчёт-JSON есть (`repStockByCode.size`), то «получено по 3 сезонам − продано» по коду модели (модели нет в отчёте → 0, склад не берётся); иначе `FinishedGoodsStock` | **JSON** (`loadReportSizes`, `lib/margin-server.ts:67`) либо **старые таблицы** |
| Оценка склада `stockIncl` | `:217`: средняя себестоимость завершённых ТЗ среза × склад; нет ТЗ — `FinishedGoodsStock.avgUnitCost` | старые таблицы |
| «Розничная цена» (правка по месту) | `:222`: `ProductModel.sellingPrice`, иначе самая частая цена модели из прайс-JSON (`:120-127`), при равенстве — большая; метка `listOnly` | **старые таблицы + JSON** (`loadRetailPricesState`, `lib/import-keys.ts:32`) |
| «Наценка к ТЗ» | `:248`: `price / unitIncl` (цена с НДС ÷ себестоимость с работой и с НДС; зависит от года шапки и режима «4 %»; режим НДС не влияет) | как выше |
| «MU (110)» | `:249`: `price / 110 / (поступило € ÷ шт. по отчёту)`; число 110 записано литералом, а не `MU_EUR_RATE` | **JSON** (отчёт) |
| Таблица «Розничная цена и наценка по меху и категориям» | `aggOf` `:299` + дубль `aggOf` в `articles/article-widgets.tsx:76` (плитка «Наценка») | старые таблицы |
| Плитки «Итоги выпуска» (4 карусели, свёрнуты) | `ProdTiles` `:~449-461`, `PerUnitCarousel`, `MarkupCarousel` | старые таблицы |
| `YearProductionTable` `:464`, `UnitCostNow` `:466` (`loadBudgetStats` `:118`), дерево `OrdersTree` `:664` | три дублирующих блока | `loadBudgetStats` = `loadOrderRows("all","off")` (`lib/budget-stats.ts:14`), 4 % зашито константой `C4 = 4` в `components/unit-cost-now.tsx:14` |
| Фото, PLU, магазин | `loadPhotoSummary`, `loadAllShopLinks`, `PhotoGalleryButton`, `ArticleShopEditor` | **JSON** (`SystemState article-photos:<id>`, `article-shop-links:<id>`, `lib/article-photos.ts:1-9`) + свойства артикула `ProductModel.attributes` (PLU) |
| Клики | строка → `/models/[id]`; «ТЗ» → `/production?model=`; «продажи» → `/sales/movement?m=`; «Ремонт» → `/repair`; «Аналитика и цены» → `/analytics/products`; «+ Новый артикул» → `/models/new`; «Внёс Веллмех» → `?src=supplier` | |

### 2.5 `/models/[id]` — карточка артикула (`models/[id]/page.tsx`, 433 строки)

| Блок | Функция | Источник |
|---|---|---|
| Фото, ссылки «Товар в магазине», редактор | `loadArticlePhotos`, `loadShopLinks` | JSON |
| Плитки: итоги ТЗ (`ProdTiles`), «Розница» (цена и наценка) `:~230`, `WeightedTile` | `drill` из `loadOrdersDrill(orgId,year,c4)` `:122`; `price = model.sellingPrice` **без запасного прайса** `:148`; `markup = price / (sumTotal/qty)` `:149` | старые таблицы |
| «Реквизиты и цена» (форма) | `ArticleForm` → `saveArticleForm` `models/actions.ts:86` | `ProductModel` |
| Справочная часть («Категория → группа», «Тип меха», «Мех по ТЗ», «Цвет по ТЗ», НДС) | `article-fur-type.ts`, `articleMetrics`, `orderRows.colors` | старые таблицы |
| «Профиль по ТЗ» | `tz-profile.tsx` читает `lib/data/article-tz-profile.json` (66 артикулов, файл от 15.10) | **статика** |
| «ТЗ артикула и их состав» | `TzBreakdown` ← `buildTzTable` (`lib/article-tz-table.ts`); единственный блок, где сумма строк = итог | старые таблицы |
| Состав по лотам, отгрузки, документы ТЗ, история, комментарии | `OrdersTree`, prisma | старые таблицы |
| **Нет**: склада («На складе»), MU(110), цены из прайса | | |

### 2.6 Остальные экраны участка

| Экран | Что это | Источник | Файл |
|---|---|---|---|
| `/repair` | ТЗ с категорией «Ремонт»: плитки и дерево | `loadOrdersDrill` | `app/(app)/repair/page.tsx` (98 строк) |
| `/models`, `/finished-stock` | редиректы на `/articles` с параметрами | — | `models/page.tsx`, `finished-stock/page.tsx` |
| `/analytics/products` («Что произведено») | группировки по категории, меху, размеру, партии, цвету + матрицы; колонки метрик | `loadOrderRows` (`lib/analytics-orders.ts`), `lib/analytics-metrics.ts` | `analytics/products/page.tsx` (534) |
| `/analytics/pricing` («Цены») | себестоимость единицы по модели/категории/меху, рекомендованная цена по целевой наценке; кнопка «Принять рекомендацию» пишет `sellingPrice` | `loadOrderRows` + `ProductModel.sellingPrice` (`lib/analytics-pricing.ts:155`) | `analytics/pricing/page.tsx` (747) |
| `/analytics/margin` («Маржа») | маркап и валовая прибыль по моделям и сезонам: прайс × себестоимость × приход/продажи; блок «Цены» из прайса | `loadMarginInput` (`lib/margin-server.ts:34`): `SalesReceiptLine` + прайс-JSON + `sellingPrice` + себестоимость из `loadOrdersDrill`; `buildMargin` (`lib/margin.ts:84`) | `analytics/margin/*` |
| `/analytics` | редирект на `/analytics/raw` | — | `analytics/page.tsx` |
| `/catalog` («Каталог для телефона») | тот же `SeasonReport` из Продаж в режиме `catalog` | отчёт-JSON, `SalesReceiptLine`, `tzAwaitSizes`, `loadSupplyLeaves` | `catalog/page.tsx`, `lib/sales-server.ts` |
| `/supply-plan` | сетка месяцев × артикулы, статусы, запись | `SupplyPlanEntry` (86 записей на 11.11 по `docs/data-mart/SOURCE-REGISTRY-2026-11-11.md`); используется календарём (`lib/calendar-layers.ts`) | `supply-plan/page.tsx`, `actions.ts` |
| `/plan`, `/plan/seasons` (скрыт) | план заказа по сезонам, привязка ТЗ к сезонам | `ProductionPlan` (0 строк на 11.11), `Season`, `lib/plan-fact.ts` | `plan/page.tsx`, `plan/actions.ts` |
| `/fittings*` (скрыт) | примерки: список, карточка, фото | `Fitting`, `FittingPhoto`; API `app/api/fittings/*` | `fittings/page.tsx`, `lib/fittings.ts` |
| `/integrity` | редирект на `/reconciliation#integrity` | — | `integrity/page.tsx` |

Раздела «план», «примерки» в данных почти нет: `ProductionPlan` — 0 строк, `ShipmentPlanRow` — нигде не читается (реестр источников, §1).

---

## 3. Действия пользователя и что они пишут

После каждой записи вызывается только `revalidateAll(orgId)` (`lib/revalidate-all.ts:11-17`): сбрасывает кэш страниц и фильтры. **Пересборка витрины после записи в этих разделах не вызывается нигде.** Единственные вызовы `refreshMartInBackground` — после загрузок данных в Настройках (`settings/import/actions.ts:52,65`) и из `lib/margin-server.ts:104` при статусе «stale». Проверка «свежести» `martFreshForReport` (`lib/mart/read.ts:20-34`) смотрит на версии отчёта/прайса, журналы загрузок и строки прихода; **правки ТЗ, списаний, цены артикула в проверку не входят** (стоимость партий `DmCostParty` строится из ТЗ, `lib/mart/build.ts:51,206`). Сейчас это безопасно, потому что экраны витрину не читают; при переводе экранов на витрину это станет проблемой (см. раздел 5, пункт П5).

### 3.1 Производство

| Действие | Функция | Что пишет | Особенности |
|---|---|---|---|
| Создать ТЗ (форма) | `createProductionOrder` `production/actions.ts:147` | `ProductionOrder`, цвета, партия (находит или создаёт `ProductionBatch`), по желанию `ProductionMaterialUsage` (через `consumeFromLot`) и `ProductionExpense`; копирует `retailPrice` из `ProductModel.sellingPrice` (`:322`, `:431`) | `revalidateAll` `:447`; витрина не обновляется |
| Загрузить ТЗ из файла | `createTzBatch` `import-actions.ts:110` | то же транзакцией, журнал изменений | `revalidateAll` `:302` |
| Править параметры ТЗ | `patchProductionOrder` `:675`, `updateProductionOrder` `:541` | `ProductionOrder`; сброс подтверждения | |
| Списать лот / удалить / править НДС | `addMaterialUsage` `:860`, `removeMaterialUsage` `:1050`, `updateMaterialUsage` `:1136`, `updateUsageVat` `:1078` | `ProductionMaterialUsage`, остаток лота | меняют себестоимость ТЗ |
| Расход ТЗ | `addProductionExpense` `:1186` и др. | `ProductionExpense` | |
| **Завершить ТЗ / «Поставлен»** | `completeProductionOrder` `:1286`, `markOrdersDelivered` `:1360` | `status=COMPLETED`, `producedQuantity`, снимок `materialCost/expenseCost/totalCost/unitCost` (сырьё + расходы, **без 4 % и без работы**), приход на `FinishedGoodsStock` по полной стоимости с работой и 4 % (`receiveFinishedGoodsStock` `:1336`, `lib/finished-goods-cost.ts:30-40`) | складской остаток из этой записи **виден на «Изделиях» только если нет отчёта-JSON** (`articles/page.tsx:215`); при загруженном отчёте «Поставлен» на показанный «На складе» не влияет |
| Исправить фактическое количество | `updateProducedQuantity` `:1444` | пересчёт `FinishedGoodsStock` и движение `ADJUSTMENT` | |
| Отменить / категория / вид меха / НДС / цвета | `cancelProductionOrder` `:1743`, `setOrderCategory` `:1780`, `setOrderFurType` `:1797`, `setOrderVat` `:1815`, `setOrderColors` `:1701` | `ProductionOrder` | |
| Оплаты за работу | `addProductionPayment` `:1485` и др. | `ProductionPayment`, доли `PaymentAllocation` | |
| Партия: правка, удаление | `updateProductionBatch` `:1640`, `deleteProductionBatch` `:1684` | `ProductionBatch` | |
| План поставок | `addSupplyPlanEntry`, `updateSupplyPlanEntry`, `removeSupplyPlanEntry` (`supply-plan/actions.ts:42,82,106`) | `SupplyPlanEntry` | |
| План заказа, сезоны | `savePlan`, `copyPlan`, `deletePlan`, `createSeason`, `assignSeason`, `applySeasonRule` (`plan/actions.ts`) | `ProductionPlan*`, `Season`, `ProductionOrder.seasonId` | скрытый модуль |
| Примерки | `fittings/actions.ts`, `app/api/fittings/route.ts` | `Fitting`, `FittingPhoto`, файлы | скрытый модуль, API рабочий |

### 3.2 Изделия

| Действие | Функция | Что пишет |
|---|---|---|
| Новый артикул / правка | `saveArticleForm` `models/actions.ts:86` → `saveArticleCore` (`lib/article-save.ts`) | `ProductModel`; при изменении цены `propagateArticlePrice` (`article-save.ts:119`) |
| Цена в таблице («Enter») и «Принять рекомендацию» | `updateSellingPrice` `models/actions.ts:19` (из `articles/price-form.tsx` и `analytics/pricing/accept-price-button.tsx`) | `ProductModel.sellingPrice`; **`ProductionOrder.retailPrice` только у ТЗ в плане и в работе** (`PLANNED`, `IN_PROGRESS`); у завершённых остаётся старая цена. `retailPrice` ТЗ нигде на экранах не показывается, только в проверке целостности (`lib/integrity/checks.ts:346`) |
| Вкл / выкл | `setModelActive` `articles/active-actions.ts` | `ProductModel.isActive` |
| Свои параметры (в т.ч. PLU) | `saveArticleParam`, `removeArticleParam` `models/actions.ts:130,140` | `ProductModel.attributes` (Json) |
| Фото: загрузка / удаление | `lib/article-photo-upload.ts` (sharp, JPG + миниатюра), `deleteArticlePhoto(s)` (`models/photo-actions.ts`) | файлы в `UPLOAD_DIR/article-photos/…` и `SystemState article-photos:<id>` |
| Магазин и PLU | `saveArticleShop` (`models/shop-actions.ts`), `lib/article-shop.ts` | `SystemState article-shop-links:<id>`, свойства «PLU…» |
| Цвет | у артикула отдельного поля цвета **нет**: цвет живёт в ТЗ (`ProductionOrder.color/colorRef`, `ProductionOrderColor`, действие `setOrderColors`); у фото цвет — вариант фото (`lib/article-photo-color.ts`); в карточке «Цвет (по ТЗ)» вычисляется (`models/[id]/page.tsx:143`); для артикулов без ТЗ — из текста описания (`parseSupplierDescription`, `articles/page.tsx:226`) |
| Создание артикула подрядчиком | `createArticleBySupplier` `models/actions.ts:48` | `ProductModel` без цены |
| Удаление артикула | `articleDeleteBlocker` `article-save.ts:130`: нельзя при наличии ТЗ, плана поставок, остатков, движений | |

Предусловие для цен: перед записью `updateSellingPrice` нет подтверждения с цифрами на странице «Изделия» (оно есть только у кнопки «Принять рекомендацию», `accept-price-button.tsx`). Цена правится в таблице одним «Enter» и тут же уходит в открытые ТЗ.

---

## 4. Связи с другими разделами и расхождения

Цепочка: **Сырьё** (закупка → лот `RawMaterialLot`) → **ТЗ** (списание `ProductionMaterialUsage`, расходы, работа) → **Изделия** (себестоимость, цена артикула) → **Продажи** (приход и продажи из файла `SalesReceiptLine` и отчёта-JSON).

| Связь | Как реализована | Расхождение |
|---|---|---|
| Сырьё → ТЗ | `consumeFromLot` (`lib/stock.ts`); из ТЗ ссылка на лот `/analytics/raw/lot/[id]` | цена лота подтягивается при списании; пересчёт лота (`lib/lot-reprice.ts`) меняет себестоимость задним числом: витрина не знает |
| ТЗ → Главная | `loadDrillOrders` (`lib/dashboard-data.ts:188`): блоки «Стоимость производства», «Произведено» | `scaleProducedToReport` (`lib/dashboard-drill.ts:390`) масштабирует «произведено» к приходу отчёта: числа Главной и `/production` (по ТЗ) могут отличаться |
| ТЗ/Изделия → Продажи, Маржа | `loadModelCosts` (`lib/margin-server.ts:14`) берёт себестоимость из того же `loadOrdersDrill` | цена там другая: прайс, взвешенный по приходу (`lib/margin.ts:98-104`) |
| Изделия → Главная («Изделия на стоке») | не связаны: блок строится из отчёта-JSON и курса 110 (`app/(app)/dashboard/sales-block-data.ts:189-203,257,339`) | закупка остатка 172,7 млн по отчёту против 165,9 млн по ТЗ (`MIGRATION-STATUS.md`, «Не переведено») |
| Изделия → Каталог / Продажи | `SeasonReport` из Продаж | остаток и цена из отчёта, а на `/articles` склад тоже из отчёта, но цена — из карточки с запасным прайсом |
| Оплаты → Партии | `batchTotals`, `loadClientDebt`; на `/production/batches` «мост» к Главной | отдельный расчёт «оплачено» от Главной (`batches/page.tsx:106-112`) |
| Чат, Документы, Контроль | ссылки из карточки ТЗ | поиск «ТЗ 198» с приставкой не работает и в `/documents?q=` (`production/[id]/page.tsx:111,412`) |

Числа Главной, которые берутся из этого участка: «Стоимость производства» (`loadDrillOrders`), «Произведено» (то же), «Изделия на стоке» (отчёт-JSON, не отсюда), итоги сезонов («заказано/получено», из витрины `DmSkuSeason`, `lib/margin-server.ts:92`).

### 4.1 Определения себестоимости (в коде их девять, не «4–5»)

| № | Определение | Файл:строка | С работой | 4 % | Шкуры подрядчика | Год / режим НДС |
|---|---|---|---|---|---|---|
| С1 | `DrillOrder` → `sumOrders`/`sumTotal` («полная себестоимость»): мех + подкладка + 4 % + прочее/расходы + работа | `lib/orders-sum.ts:34-50`, `lib/dashboard-data.ts:188`, `lib/dashboard-drill.ts` | да | по режиму шапки | да (константы) | год шапки, НДС |
| С2 | Строка в таблице `/production`: `sumUsagesWith4` + работа + шкуры | `production/page.tsx:334-364` | да | по режиму | да | |
| С3 | Карточка ТЗ «Расчёт»: сумма строк списаний (`projected`), не снимок | `production/[id]/page.tsx:210-211,~324` | да | по режиму | да | |
| С4 | `batchTotals`/`orderStat`: `totalCost ?? projected` + надбавка 4 %; **работа отдельно** | `lib/batch-stats.ts:57-65` | нет («себестоимость сырья») | по режиму | нет | |
| С5 | `OrderRow.costIncl` в аналитике: `totalCost ?? projected` + 4 % | `lib/analytics-orders.ts:301-302` | нет, работа в `work` | по режиму | нет | год шапки |
| С6 | Снимок при завершении: `materialCost + expenseCost` | `production/actions.ts:1307-1311` | нет | нет | нет | |
| С7 | Склад готовой продукции: полная стоимость, 4 % константой | `lib/finished-goods-cost.ts:30-40` | да | да | нет | |
| С8 | Витрина `DmCostParty.unitCostRub`: `(costIncl + work) / qty` из `loadOrderRows(orgId,"all","on")` | `lib/mart/build.ts:51,206` | да | всегда «с 4 %» | **нет** (в `loadOrderRows` шкур нет) | все годы, с НДС |
| С9 | «Себестоимость сейчас» по `loadBudgetStats`: средневзвешенно, `c4 = 4 %` константой, режим `"off"` | `lib/budget-stats.ts:14`, `components/unit-cost-now.tsx:14` | да (workPer) | пересчёт заново | нет | все годы |
| С10 | Закупка по отчёту, €: `поступило € ÷ шт.` | `lib/stock-money.ts:5-9`, `articles/page.tsx:132-135` | n/a (SC EUR) | n/a | n/a | |

Следствие: себестоимость одного артикула может отличаться между `/articles` (С1), витриной (С8: нет шкур подрядчика, всегда с 4 %, все годы), `/analytics/pricing` (С5: по умолчанию без работы), `/production/batches` (С4: без работы). Для ТЗ без шкур подрядчика и в режиме «С 4 %, все годы» С1 и С8 должны совпасть; **числовую сверку на данных я не выполнял**. Есть `scripts/mart-vs-legacy.ts`, но он сравнивает только итоги сезонов.

### 4.2 Определения маркапа / наценки (шесть в этом участке + три рядом)

| № | Где | Формула | Файл:строка | Цена | Курс 110 |
|---|---|---|---|---|---|
| М1 | `/articles`, столбец «Наценка к ТЗ» | `price ÷ unitIncl` (С1 с работой, с НДС) | `articles/page.tsx:248` | карточка → запасной прайс | нет |
| М2 | `/articles`, столбец «MU (110)» | `price ÷ 110 ÷ (поступило € ÷ шт.)` | `articles/page.tsx:249` (литерал 110) | как М1 | **да** |
| М3 | `/articles`: таблица по меху/категориям и плитка «Наценка» | `Σ(цена × выпуск) ÷ Σ(unitIncl × выпуск)`; **две копии `aggOf`** | `articles/page.tsx:299`, `articles/article-widgets.tsx:76` | как М1 | нет |
| М4 | `/models/[id]`, плитка «Розница» | `price ÷ (sumTotal/qty)`; цена **только `sellingPrice`** | `models/[id]/page.tsx:147-149` | карточка | нет |
| М5 | `/analytics/pricing`, «Наценка» | `price ÷ (costIncl [+ work] ) / unitsCosted`; **по умолчанию база = сырьё без работы** («Наценка к сырью») | `lib/analytics-pricing.ts:41,273-290` | только `sellingPrice` (`:155`) | нет |
| М6 | `/analytics/margin`, «Наценка» модели и «наценка прихода» | `price ÷ unitIncl`; цена = средневзвешенный прайс по приходу артикулов, либо карточка (если нет продаж), либо цена модели | `lib/margin.ts:90-104,122-126` | прайс-JSON + карточка | нет |
| М7 | `/sales` (сезонный отчёт, MU) и Главная («Изделия на стоке») | `(выручка ₽ + скидка ₽) ÷ 110 ÷ SC EUR`; `цена ÷ 110 ÷ себестоимость €` | `app/(app)/sales/season-report.tsx:243,336`, `app/(app)/dashboard/sales-block-data.ts:257,339` | выручка / прайс-JSON | **да** |
| М8 | Витрина `vDmMarkupStock`, `vDmMarkupSold`, `…Weighted` | `retailPrice ÷ unitCostAvgRub` (₽, без курса) | `prisma/migrations/20261112140000_data_mart_markup_rub`, `…150000_…weighted` | прайс-JSON по размеру | нет (первая версия с 110 заменена) |
| М9 | Решение владельца 12.11: «маркап = розничная цена ÷ себестоимость по ТЗ, в рублях, курс 110 не нужен»; вопрос «с НДС или без» остаётся открытым (`MIGRATION-STATUS.md`, «Не переведено») | | `docs/data-mart/DATA-MART-PLAN-2026-11-11.md §16-17` | | |

Решение 12.11 (М9) в экранах не применено: на `/articles` рядом стоят и М1, и М2 по курсу 110; Продажи и Главная считают по 110 (М7).

### 4.3 Откуда цена и склад в карточке артикула (три источника, плюс четвёртый)

**Цена (розничная):**
1. `ProductModel.sellingPrice`: правится в форме и в таблице; **единственная цена, которую показывает карточка** (`models/[id]/page.tsx:148`) и `/analytics/pricing` (`lib/analytics-pricing.ts:155`).
2. Прайс-JSON `SystemState retail-prices:*` (по артикулу·цвету·размеру): на `/articles` берётся как запасная «самая частая цена по коду модели» (`articles/page.tsx:120-127,222`, пометка `listOnly`); на `/analytics/margin` и в Продажах используется по размерам.
3. `DmRetailPrice` (`prisma/schema.prisma:2439`): копия прайс-JSON в витрине (`lib/mart/build.ts`), **ни один экран не читает**.
4. `ProductionOrder.retailPrice`: копия цены артикула на момент создания ТЗ и при изменении цены у открытых ТЗ; нигде не показывается (кроме проверки целостности `lib/integrity/checks.ts:346`).

Итог: один и тот же артикул может иметь цену в списке (из прайса) и «–» в карточке, где цена пуста (`articles/page.tsx:222` против `models/[id]/page.tsx:148`).

**Склад («На складе»):** в карточке артикула склада **нет**. В списке `/articles`: отчёт-JSON (получено по трём сезонам − продано, по коду модели; если отчёт есть и модели нет в нём → 0, `articles/page.tsx:215`), иначе `FinishedGoodsStock`. Третий вариант (`FinishedGoodsStock`) пополняется из `completeProductionOrder`, четвёртый — витрина (`DmStock`, `vDmStockModel`), не читается. Эталонное расхождение «368 против 371» (память проекта) относится к этому двойнику.

### 4.4 Где используется курс 110

| Место | Файл:строка | Назначение |
|---|---|---|
| `MU_EUR_RATE = 110` | `lib/mu-rate.ts:2` | Продажи (`sales/season-report.tsx:85-88,243,336`), Главная (`dashboard/sales-block-data.ts:189-203,257,322,341`) |
| `EUR_RATE = 110` | `lib/money-currency.ts:5` | переключатель ₽/€ на Главной |
| литерал `* 110` | `lib/utils.ts:90` | форматирование суммы в €-режиме |
| литерал `/ 110` | `articles/page.tsx:249` | столбец «MU (110)» |
| `RETAIL_RATE = 110` | `lib/mart/build.ts:16` | объявлена, нигде не используется (`grep`), в представлениях витрины курса больше нет (миграция `…140000`) |
| `buildMart` комментарии | `lib/mart/build.ts:13,277` | курс 110 только как справка («Закупка остатка по отчёту, € (справка)») |

Четыре независимых записи одного числа 110.

---

## 5. Проблемы

Серьёзность: В (высокая), С (средняя), Н (низкая).

| № | Проблема | Серьёзность | Доказательство | Что делать |
|---|---|---|---|---|
| П1 | **Один маркап считается девятью способами**; на `/articles` рядом два столбца («к ТЗ» и «MU 110»), на карточке один, на «Ценах» по умолчанию без работы | В | §4.2: `articles/page.tsx:248-249`, `models/[id]/page.tsx:149`, `lib/analytics-pricing.ts:41,273`, `lib/margin.ts:98`, `season-report.tsx:243`, миграции `…140000` | Единое определение (раздел 7); одна функция `markupOf(price, cost)` в `src/lib`; убрать «MU (110)» из `/articles` или спрятать в «Колонки» |
| П2 | **Себестоимость определяется десятью способами**, включая отличия: работа/без работы, шкуры подрядчика, 4 %, год | В | §4.1; также `docs/analysis/duplicates-relevance.md` п. 10 | Одна функция «полная себестоимость ТЗ» (`orders-sum`/`DrillOrder` уже ближе всего), остальные вызывают её |
| П3 | **Цена артикула из трёх мест**; карточка показывает меньше, чем список | В | `articles/page.tsx:222` против `models/[id]/page.tsx:148`; `lib/analytics-pricing.ts:155` | Решение владельца: какая цена главная (карточка артикула vs прайс по размерам); показывать пометку источника везде одинаково |
| П4 | **«На складе» из двух источников, «Поставлен» не меняет показанный остаток при наличии отчёта** | В | `articles/page.tsx:215`; `production/actions.ts:1336` | Единый источник «На складе» (отчёт/витрина `DmStock`); `FinishedGoodsStock` оставить только для стоимости |
| П5 | **Витрина не обновляется после правок ТЗ/цен и «свежесть» их не учитывает**; ни один экран участка не читает `Dm*` | В | `lib/revalidate-all.ts:11-17`; `lib/mart/read.ts:20-34`; `grep lib/mart` | Перед переводом экранов: добавить в `martFreshForReport` проверку по `ProductionOrder`/`ProductionMaterialUsage`/`ProductModel.updatedAt` и фоновую пересборку после записи (решение: после каждой записи или по кнопке «Обновить») |
| П6 | Витрина и экран по-разному считают себестоимость: в витрине нет шкур подрядчика, всегда «с 4 %», все годы | С | `lib/mart/build.ts:51` против `lib/orders-drill.ts`/`lib/contractor-hides.ts` | Сверка `scripts/mart-vs-legacy.ts` расширить с итогов сезонов на себестоимость по моделям |
| П7 | Шкуры подрядчика зашиты в код (две суммы по двум партиям: 189 966,22 ₽ и 32 918,56 ₽, цитата из платёжек) | С | `lib/contractor-hides.ts:1-16` | Хранить в базе (`PaymentAllocation`/расходы партии), код читает; в демо-сборке реальные суммы попадают в `src` (см. `scripts/demo-static-data.mjs`) |
| П8 | Дублирующие блоки на `/articles`: `YearProductionTable`, `UnitCostNow`, плитка «Наценка», таблица «Розничная цена и наценка», дерево «Выпуск»; `aggOf` в двух файлах | С | `articles/page.tsx:299,464,466,664`, `article-widgets.tsx:76` | Убрать три блока (оставить таблицу наценки и итоговую строку) |
| П9 | `UnitCostNow` берёт 4 % константой `C4 = 4` и независимый расчёт | С | `components/unit-cost-now.tsx:14`, `lib/budget-stats.ts:14` | Убрать со «Изделий»; в «Бюджете» вызывать общую функцию |
| П10 | Мёртвый и скрытый код в списке ТЗ: `grouped = false`, «Сезоны ТЗ» | Н | `production/page.tsx:98,613,681-695` | Удалить |
| П11 | Дубль переключателя «Группа» и фильтра «Группа категорий» | Н | `production/page.tsx:623-644,657` | Оставить сегмент, убрать фильтр |
| П12 | Поиск «ТЗ 198», «№198» не находит; системный номер П-2026-… виден только в `title` (на iPad невидим); подпись поля названа «№ ТЗ» и «Номер ТЗ» | В/С | `production/page.tsx:194-203`; `production/[id]/page.tsx:398`; `params-table.tsx:118-119` | Срезать приставку при разборе `q`; вывести системный номер текстом |
| П13 | Профиль «по ТЗ» из статического JSON (66 артикулов, 15.10); вне базы | С | `models/[id]/tz-profile.tsx:1`, `lib/data/article-tz-profile.json` | Убрать с экрана или перенести в «Реквизиты» |
| П14 | `window.confirm` в «Поставлен» меняет склад | С | `production/delivered-switch.tsx:22,26` | Диалог приложения с суммой и штуками |
| П15 | `HIDDEN_MODULES.supplyPlan: false` (видим), но комментарий в `nav-links.ts:6` и в шапке `hidden-modules.ts` описывают его как скрытый; карточка артикула делает запросы по скрытым модулям (`productionPlan.count`, `fitting.count`, `shipment.count`, `findMany` отгрузок/примерок) | Н | `models/[id]/page.tsx:112-125` | Считать счётчики только для видимых модулей |
| П16 | `/models/new` рисует рабочую форму ролям без прав | Н | `models/new/page.tsx`, `article-form.tsx:86` | Проверка роли или `canEdit` из `ACCESS.models` |
| П17 | Цена в таблице «Изделия» меняется одним Enter и уходит в открытые ТЗ без подтверждения; завершённые ТЗ сохраняют старую `retailPrice` (нигде не видна) | С | `models/actions.ts:19-37`, `lib/article-save.ts:119` | Подтверждение с числом открытых ТЗ (как в `accept-price-button.tsx`, `countOpenOrdersForModel`) |
| П18 | Тяжёлые загрузки на каждый заход: `/production` грузит `loadOrderRows("all")` всегда, `/articles` — `loadBudgetStats`, `loadReportSizes` + строки прихода, `loadOrderRows`, `loadOrdersDrill` | С | `production/page.tsx:108`, `articles/page.tsx:118,128,190,~196`; `lib/margin-server.ts:67-72` | Не проверялось по времени; `memoRequest` смягчает. Убрать лишние блоки (П8), вызывать `loadOrderRows("all")` только при фильтре «Вид меха» |
| П19 | Режимы шапки (Год, НДС, 4 %) действуют на `/production`, `/articles`, `/models/*`, `/analytics/*` (правило «все три» по умолчанию, `lib/page-modes.ts`): маркап зависит от года и 4 %, но не от НДС (`unitIncl` всегда с НДС) | С | `lib/page-modes.ts:41-42`, `articles/page.tsx:248` | Зафиксировать: маркап всегда по одной базе, режимы шапки на него не влияют |
| П20 | Цели касания и подсказки только `max-md` (телефон); на iPad 820–1180 меньше 44 px; hover-подсказки | С | `production/page.tsx:635,751`, `production/[id]/page.tsx:395-409` (`max-md:min-h-11`) | По правилу владельца ≥44 px на 820 и 1180: заменить `max-md:` на нужные брейкпоинты |
| П21 | Дубль «Продажи» (`/sales/movement`), «Каталог» (`/catalog`) и `/articles`: остаток и цена из отчёта через другую цепочку (`SeasonReport`) | С | `catalog/page.tsx`, `sales/season-report.tsx` | См. раздел 7 |
| П22 | Два набора ролей: «Примерки» прописаны строкой `["OWNER","ADMIN","TECHNOLOGIST"]` вне `access.ts` | Н | `fittings/page.tsx:38`, `app/api/fittings/route.ts:7` | Вынести в `ACCESS.fittings` |
| П23 | Дубли страниц-редиректов и «аналитик» в этом участке: `/analytics/products` («Что произведено»), `/articles`, `/repair`, `/analytics/pricing`, `/analytics/margin` показывают одни и те же ТЗ в разных срезах; в подсвеченном меню «Изделия» шесть адресов | С | `components/nav-links.ts:9`; `analytics/*` | Свести аналитику в «Цены» и «Маржа»; «Что произведено» оставить только как срез (раздел 7) |

### 5.1 Статус находок 15.11 (`docs/ux-review/03-production-articles.md`)

| Находка 15.11 | Статус 22.11 |
|---|---|
| Витрина не используется в участке | осталось |
| Два расчёта «Итого ТЗ» в списке (`sumUsagesWith4`+`fullOf` против `loadOrdersDrill`) | осталось (`production/page.tsx:334-370`) |
| Поиск «ТЗ 198» | осталось |
| Системный номер в `title` | осталось (`[id]/page.tsx:398`) |
| 24 столбца / 16 фильтров «Изделий», 18 фильтров ТЗ | осталось |
| `aggOf` дважды; 4 вида одной «наценки» | осталось |
| `YearProductionTable`, `UnitCostNow`, дерево на «Изделиях» | осталось |
| Три источника цены, два источника склада | осталось (§4.3) |
| Профиль «по Word-ТЗ» из JSON | осталось |
| `grouped = false`, «Сезоны ТЗ» | осталось |
| «Мех списком» и «Мех (лот)» — два способа | осталось (`add-menu.tsx`) |
| Две заметки «ТЗ отменено» | осталось (`[id]/page.tsx:470,579`) |
| `window.confirm` | осталось |
| Цена артикула не следует за ТЗ (из `docs/analysis/dependencies.md`, п. 8) | исправлено частично: переносится на ТЗ в плане и в работе (`article-save.ts:119`) |
| «По партиям» дублирует вкладку (`docs/analysis/duplicates-relevance.md`, п. 5) | исправлено: редирект `production/page.tsx:97` |
| Фильтры «Заказчик» убраны | исправлено в списках (07.10), но в `/production` фильтр «Заказчик» всё ещё есть (`production/page.tsx:664`), так что находка 07.10 после этого вернулась или не касалась `/production` (проверить с владельцем) |

Что не проверял: реальный вид на iPad; совпадение клиентского пересчёта в шаге 3 формы создания (`production/new/form.tsx`) с `sumUsagesWith4`; тексты всех подсказок; числа на живой базе и в демо-базе; работу API `app/api/production/[id]/{word,docx,print}` и `app/api/fittings/*` по ролям (читал только заголовок `fittings/route.ts`); что именно лежит в `SystemState` на демо (в `scripts/make-demo-db.ts:161-169` очищаются `Dm*`, фото и ссылки магазина, `report-xlsx`, но не `sales-report-sizes` и `retail-prices`: в демо отчёт-JSON, возможно, остаётся).

---

## 6. Что можно исправить сразу и что требует решения владельца

### 6.1 Сразу (без решения, малый риск)

1. Удалить мёртвый код списка ТЗ: `grouped = false` и ветку `OrdersTree`, кнопку «Сезоны ТЗ» (`production/page.tsx:98,613,681-695`) (П10).
2. Убрать дубль «Группа» в `/production` (П11).
3. Заменить литерал `110` в `articles/page.tsx:249` и `lib/utils.ts:90` импортом одной константы (П4.4); не менять поведение.
4. Одна `aggOf`: вынести в `src/lib` (П8).
5. Срезать приставки «ТЗ», «№», «П-» в разборе `q` (`production/page.tsx:194`, `/documents`) (П12).
6. Вывести системный номер П-2026-… текстом в карточке ТЗ; одну подпись «№ ТЗ (из документа)» (П12).
7. Одно сообщение «ТЗ отменено» (`production/[id]/page.tsx:470,579`).
8. Считать счётчики скрытых модулей в карточке артикула только при видимости (П15).
9. Роль в `/models/new` (П16); `ACCESS.fittings` (П22).
10. Комментарии `nav-links.ts:6` и шапка `hidden-modules.ts` привести к фактическому состоянию (`supplyPlan` виден).
11. Вынести `HIDES_ALLOC` в данные (П7), если владелец подтвердит суммы (они из платёжек, не выдумка: хранение в базе без смены значений).

### 6.2 Нужно решение владельца

| Вопрос | Варианты |
|---|---|
| Маркап: с НДС или без; «к ТЗ с работой» или «к сырью» | `docs/data-mart/MIGRATION-STATUS.md` оставляет «с НДС/без НДС» открытым; в `/analytics/pricing` по умолчанию «к сырью без работы» |
| Какая цена главная: карточка артикула или прайс по размерам; что показывать, если они расходятся | П3 |
| Эталон «На складе»: отчёт (845/637/346), файл прихода (868/659/368), `FinishedGoodsStock` | решение 16.11: сезонные блоки; `FinishedGoodsStock` оставить только для стоимости? |
| Сохранять ли курс 110 вообще (Продажи и Главная считают MU по 110) | `docs/data-mart/DATA-MART-PLAN §15-17`: только для розничного маркапа |
| Можно ли убрать с «Изделий» годовую таблицу, `UnitCostNow`, дерево | П8 |
| Кто из ролей видит деньги производства | бухгалтер, кладовщик, наблюдатель сейчас видят всё |
| Подтверждение при правке цены, которая уходит в открытые ТЗ | П17 |
| Когда пересобирать витрину: после каждой записи или по кнопке «Обновить» | `MIGRATION-STATUS.md`, «Сделать для общего перевода» |
| Судьба скрытых модулей (Примерки, План заказа, Сезоны ТЗ: 0 строк плана, примерок мало) | оставить флагом или удалить код |
| Судьба `/catalog`, `/analytics/products`, `/repair` | раздел 7 |

---

## 7. Предложение

### 7.1 Минимальный набор данных и функций для демонстрации

Показать цепочку Сырьё → ТЗ → Изделие → цена/маркап одним сквозным примером, без остальных разделов.

Данные: 2–3 артикула одной категории (например, пальто и жилет из норки и соболя), у каждого по 1–2 ТЗ, один с лотами из двух закупок и подкладкой; один завершённый ТЗ и один в работе; цена артикула у двух из трёх; одна партия пошива. В демо `Dm*`, фото и ссылки магазина очищены (`scripts/make-demo-db.ts:161-169`), поэтому «На складе» там идёт из `FinishedGoodsStock`, а MU 110 пуст: демо-данные надо готовить под этот путь.

Экраны (все существуют): `/production` (список) → `/production/[id]` (карточка с «Расчёт», «Завершить ТЗ») → `/models/[id]` («ТЗ артикула и их состав», «Розница») → `/articles` (себестоимость, цена, наценка). Функции: создать ТЗ, списать лот, завершить ТЗ, поставить цену, увидеть наценку.

Что скрыть в демо: «Загрузить ТЗ», Каталог, Ремонт, «Аналитика и цены», фото/PLU (если нет фото), План поставок.

### 7.2 Что убрать, упростить, объединить

- **Убрать**: `grouped = false` и «Сезоны ТЗ»; `YearProductionTable`, `UnitCostNow`, дерево «Выпуск» с `/articles`; профиль «по ТЗ» из статического JSON; столбцы «Подкладка м/₽», «Шкур», «НДС» из таблицы ТЗ по умолчанию; вторую заметку «ТЗ отменено»; `RETAIL_RATE` в `mart/build.ts`.
- **Упростить**: `/production` — 13 → 8 столбцов, 18 → 9 фильтров; `/articles` — 14 → 9 столбцов по умолчанию; карточка артикула — 5 плиток → 3; карточка ТЗ — «Параметры» на «Основное» и «Ещё».
- **Объединить**: «Мех списком» и «Мех (лот)» в одну форму; `aggOf` в одну; `/analytics/products` («Что произведено») оставить как срез внутри «Изделия» или «Цены», а не как четвёртую вкладку «Аналитики»; `/catalog` — оставить только как телефонный режим `SeasonReport` (отдельного расчёта у него нет).

### 7.3 Единые определения

Принцип: считается один раз в `src/lib` и в витрине; экраны только вызывают.

**Себестоимость единицы изделия (ТЗ)** = (мех + подкладка + 4 % по строкам с флагом + расходы ТЗ + работа + шкуры подрядчика) ÷ количество изделий ТЗ. С НДС. Это уже `sumTotal(sumOrders(drill))` (`lib/orders-sum.ts:34-50`) без изменений. Варианты «без работы» и «без 4 %» остаются как подпись-разложение (`s.c4`, `s.work`), но не как отдельная «себестоимость».
- Количество: `orderUnits` (выпуск у завершённого, план у ТЗ в работе, `lib/production-totals.ts`).
- Шкуры подрядчика: из базы, не из констант (П7).
- Средневзвешенная по артикулу: Σ стоимость ТЗ ÷ Σ изделия (как `articleMetrics.unit`, `lib/article-metrics.ts:107`).

**Цена** = `ProductModel.sellingPrice` (розница с НДС). Если пуста, показывается цена прайса по размеру с пометкой «из прайса»; прайс остаётся источником для розницы остатка и продаж (по размеру). Решение владельца по П3.

**Маркап** = розничная цена ÷ себестоимость (ТЗ, С НДС, с работой и 4 %), в рублях, курс 110 не участвует; средневзвешенный = Σ(цена × штуки) ÷ Σ(себестоимость × штуки) только по изделиям, у которых есть и цена и себестоимость. Это формула `vDmMarkupStockWeighted`/`vDmMarkupSoldWeighted` (миграция `20261112150000_data_mart_markup_weighted`) и М1 на `/articles`. Столбец «MU (110)» (М2) и MU по 110 в Продажах и на Главной (М7) переводить после ответа владельца про НДС и курс.

**На складе** = витрина `DmStock.stock` (`vDmStockModel`), эталон сезонных блоков 845/637/346; `FinishedGoodsStock` не показывается как «На складе».

**Порядок перевода** (из `docs/ux-review/99-summary.md` и `MIGRATION-STATUS.md`, подтверждается кодом): 1) «На складе» и цена в `/articles` (малый риск, эталон есть); 2) единая функция себестоимости и сверка С1 против С8 (шкуры подрядчика, год, режим 4 %); 3) маркап из витрины; 4) хук пересборки витрины после записи ТЗ/списаний/цены и расширение `martFreshForReport` (П5).

---

## Главное (10 строк)

1. Ни один экран «Производства» и «Изделий» не читает витрину `Dm*`; `vDm*` в `src` не используются (читается только итог сезонов на Главной, `lib/margin-server.ts:92`).
2. Маркап считается минимум девятью способами (в т.ч. два столбца на `/articles`: «к ТЗ» и «MU 110»); решение 12.11 «розница ÷ себестоимость ТЗ в рублях» в экранах не применено.
3. Себестоимость определяется десятью способами; витрина (`lib/mart/build.ts:51`) не учитывает шкуры подрядчика и всегда «с 4 %, все годы» — с экраном может расходиться (числа не сверял).
4. Цена в карточке артикула одна (`sellingPrice`), в списке — с запасным прайс-JSON; склад в карточке отсутствует, в списке из отчёта-JSON либо `FinishedGoodsStock`: «Поставлен» не меняет показанный склад при наличии отчёта.
5. После правок ТЗ, списаний и цены витрина не пересобирается, а проверка свежести их не видит (`lib/revalidate-all.ts`, `lib/mart/read.ts:20`) — риск при переводе экранов.
6. Курс 110 записан в четырёх местах (`lib/mu-rate.ts`, `lib/money-currency.ts`, литералы в `lib/utils.ts:90` и `articles/page.tsx:249`) плюс мёртвый `RETAIL_RATE`.
7. Находки ревизии 15.11 по этому участку не исправлены (кода не менялось с 15.11); исправлено только: редирект «По партиям», перенос цены артикула на открытые ТЗ.
8. Статика и константы в расчётах: `HIDES_ALLOC` (две суммы шкур подрядчика), `article-tz-profile.json` (66 артикулов), `C4 = 4` в `unit-cost-now.tsx`.
9. Сразу безопасно: удалить мёртвый код списка ТЗ, дубли блоков `/articles`, единая `aggOf`, поиск «ТЗ 198», системный номер текстом, проверка роли в `/models/new`.
10. Нужны решения владельца: маркап с НДС или без и «к сырью/с работой», главная цена, эталон склада, судьба курса 110 и скрытых модулей, доступ ролей к деньгам производства, момент пересборки витрины.
