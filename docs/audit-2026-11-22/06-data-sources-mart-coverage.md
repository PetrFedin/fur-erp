# Аудит 06. Что подвязано на единую витрину данных, а что считается из старых источников

Дата аудита: 22.11.2026. Только чтение: код не менялся, в базу писали только SELECT. База — локальная `fur-erp-db-1` (порт 5436, `.env`); боевая и демо-базы НЕ проверялись, всё про «сколько строк / когда пересобрано» относится к локальной базе. Ссылки даны как `файл:строка` или как результат запроса. Чего не проверял, помечено «не проверено».

Прочитано до аудита: `docs/data-mart/*.md` (план 11.11, реестр источников, MIGRATION-STATUS от 16.11, открытые вопросы 12 и 13.11), `docs/analysis/*.md` (заголовки; про витрину там ничего нет), `git log --oneline -40`.

Предупреждение про имя: `src/lib/datamart-stock.ts` («витрина datamart», ключ `datamart-stock` в SystemState) к нашей витрине Dm* отношения не имеет — это внешний датамарт поставщика (`dwh.vFact_Inventory_Datamart`), читается на «Продажах» (`src/app/(app)/sales/page.tsx:7`). В локальной базе ключа `datamart-stock` нет (запрос по SystemState).

---

## Короткий вывод

1. Витрина построена и сверена с эталоном (845 / 637 / 291 / 346 / 689 484 200 ₽), но **экраны читают её в одном-единственном месте**: итоги сезонов (заказано/получено) в блоке «Производство» на Главной (`src/lib/margin-server.ts:91-107` → `src/app/(app)/dashboard/page.tsx:68`). Представления `vDm*` не читает ни один файл в `src/`, только `scripts/mart-verify.ts` и `scripts/gen-color-mapping-xlsx.ts`.
2. Всё остальное (маркап, остаток и закупка остатка, оплаты и долги, лоты, ТЗ, склад, Cashflow, Excel) считается из старых таблиц Prisma, JSON в SystemState и констант.
3. Пересборка витрины запускается только после загрузки/отката файлов на экране «Загрузка данных» и «лениво» с Главной, когда витрина устарела по отчёту, прайсу или приходу. Закупки, лоты, ТЗ, платежи, справочники, цвета, цены карточек пересборку не запускают, и в проверке свежести (`martFreshForReport`) не участвуют.
4. Одно и то же число считается несколькими способами: маркап — не менее 8 способов, закупка остатка — 4, остаток — 5, оплачено — 5.

---

## 1. Инвентаризация витрины

### 1.1 Таблицы Dm* (`prisma/schema.prisma:2304-2700`), строки на 22.11.2026 в локальной базе

| Таблица | Что внутри | Строк |
|---|---|---|
| DmSku | изделие: артикул · цвет · размер, ключ `skuKey`, класс, мех, категории, `builtAt` | 338 |
| DmSkuSeason | по сезонам: заказано, получено, €, продано (сезон/олды), ₽ выручка и скидка, SC € | 1014 |
| DmStock | остаток изделия: получено, продано, остаток, розничная цена, закупка средневзвешенная (ТЗ) и по отчёту (€) | 338 |
| DmCostParty | партии ТЗ → изделия: закупка единицы, работа, `estimated`, `matchLevel` | 726 |
| DmMovement | датированные движения из файла «поступления и продажи» (артикул · цвет) | 605 |
| DmCheck | контрольные суммы и расхождения (24 проверки) | 24 |
| DmColorAlias | синонимы цветов → канонический | 67 |
| DmRetailPrice | прайс по размерам, разложен из JSON | 298 |
| DmLoad | журнал загрузок (источник, строк, время) | 10 |
| DmPlanLine / DmPlanParam | бюджет штук FW27 / параметры сценария | 67 / 13 |
| DmPresentationItem | позиции презентации FW27 | 98 |
| DmShipmentLine | строки зачётов отгрузки | 71 |
| DmDecision | решения владельца (JSON → таблица) | 7 |
| DmPurchase | закупки сырья (плоская копия с суммами) | 66 |
| DmLot | лоты сырья | 335 |
| DmLotUse | расход лота в ТЗ | 730 |
| DmPayment | платежи поставщикам (49) и за работу (39) | 88 |
| DmPaymentAlloc | распределение платежей за работу по ТЗ | 374 |
| DmOrderExpense | расходы ТЗ по категориям | 87 |

Всего 20 таблиц.

### 1.2 Представления vDm* (миграции `prisma/migrations/20261112*`), строк в базе

| Представление | Миграция | Что даёт | Строк |
|---|---|---|---|
| vDmSeasonTotals | `..020000_data_mart_views` | итоги сезонов (заказано/получено/продано/остаток/деньги) | 3 |
| vDmStockSku / vDmStockModel | `..020000` | остаток по изделию / по модели | 338 / 66 |
| vDmPurchaseChain | `..020000` | закупка → лоты → расход | 66 |
| vDmLotToOrder | `..020000` | лот → ТЗ | 730 |
| vDmOrderCost | `..020000` | стоимость ТЗ (материалы, работа, расходы) | 219 |
| vDmPaymentsBySupplier | `..020000` | платежи по контрагентам | 2 |
| vDmMovementByMonth | `..020000` | движения по месяцам | 47 |
| vDmMarkupSold / vDmMarkupStock | `..130000`, `..140000_markup_rub` | маркап продаж / остатка = розница ÷ себестоимость по ТЗ | 1014 / 338 |
| vDmMarkupSoldWeighted / vDmMarkupStockWeighted | `..150000` | средневзвешенный маркап (только изделия с себестоимостью) | 82 / 58 |
| vDmInWork | `..160000` | в работе = заказано − получено | 1014 |

Всего 13 представлений. Курс 110 в SQL остался только в более ранней миграции `..130000_data_mart_markup_view` (`110.0`, строки 13 и 19); в `..140000` (рублёвый вариант, текущий) числа 110 нет (`grep -c 110` = 0).

### 1.3 Когда пересобиралась и актуальна ли

- `max("builtAt")` в DmSku = **2026-11-16 13:09:01**; `DmLoad`: все 10 источников загружены 2026-11-16 13:09:27 (одна пересборка).
- Правила свежести — `src/lib/mart/read.ts:20-31` (`martFreshForReport`): витрина «stale», если после `builtAt` менялись `SystemState` с ключами `sales-report-sizes:*`, `retail-prices:*`, `import-journal:*`; либо есть строки прихода (`SalesReceiptLine`), созданные позже; либо число строк прихода не равно `DmLoad.rows` для `receipt-lines`. Если витрины нет — «absent».
- Фактически: последнее изменение в SystemState по этим ключам 2026-11-12 11:56, последний `SalesReceiptLine.createdAt` 2026-11-09 11:30, строк 605 = `DmLoad.rows` 605 → состояние «fresh». `scripts/mart-vs-legacy.ts` это подтвердил (`OK … fresh`).
- **Что `martFreshForReport` НЕ проверяет**: закупки, лоты, ТЗ, платежи, справочник цветов, расходы ТЗ, `ProductModel`. Таблицы цепочки (`DmPurchase`, `DmLot`, `DmLotUse`, `DmPayment`, `DmPaymentAlloc`, `DmOrderExpense`) могут молча устареть: код свежести их не смотрит вообще (`read.ts:20-31`). На локальной базе последние изменения этих источников (Purchase.updatedAt 10.11, ProductionOrder.updatedAt 09.11, RawMaterialLot.createdAt 10.11, Payment.createdAt 19.10, ProductModel.updatedAt 06.11; у ProductionPayment и ProductionMaterialUsage нет проверяемых полей времени, не проверено) раньше сборки 16.11, поэтому цепочка сейчас совпадает с базой; на боевой так может быть не всегда (не проверено).
- Эталон в `DmCheck` (24 проверки): ordered 845 / received 637 / sold 291 / stock 346 / stockRetail 689 484 200 ₽ — все `ok`; `info`: приход файла 659 против 637, 3 шт. продано сверх прихода, закупка остатка по ТЗ 165 852 189,51 ₽, по отчёту 1 570 398,16 €, в работе 208, 16 ТЗ в работе со списанным сырьём на 21 044 689,49 ₽; `warn`: 7 закупок «стоимость лотов ≠ позиции с НДС» и 2 строки прайса без изделия.
- Режим «приход из файла» (868/659/368) выключен: `src/lib/mart/build.ts:22` `MART_RECEIPTS_FROM_FILE === "1"` (по умолчанию нет), хотя `DATA-MART-PLAN` §23 описывает итоги 868/659/368. Решение 16.11 вернуло сезонные блоки (845/637/346): план-документ тут отстаёт от кода.
- Вкладка «Данные» с проверками витрины не сделана: `DmCheck` пишется, но в `src/` нигде не читается (grep по `DmCheck`/`dmCheck` вне `src/lib/mart/` пуст; MIGRATION-STATUS это подтверждает).
- В демо витрина очищается целиком (`scripts/make-demo-db.ts:161`), экраны остаются на старом расчёте (`absent`).

---

## 2. Кто читает витрину

| Потребитель | Что читает |
|---|---|
| `src/lib/margin-server.ts:91-107` (`loadReportSeasonTotalsImpl`) → `src/lib/mart/read.ts:35` `martSeasonTotals` | `DmSkuSeason` ⨝ `DmSku.cls`, суммы заказано/получено по сезонам, всего/одежда/аксессуары. Единственный экранный потребитель. |
| `src/app/(app)/dashboard/page.tsx:68` → `production-block.tsx:69-72,121` | показывает эти итоги в блоке «Производство» только когда нет фильтров и года (`scoped=false`); иначе блок считает по ТЗ. |
| `src/lib/mart/read.ts:20` `martFreshForReport` (вызов из `margin-server.ts:93`, `scripts/mart-vs-legacy.ts:16`) | `DmSku.builtAt`, `SystemState`, `SalesReceiptLine`, `DmLoad` |
| `scripts/mart-verify.ts:12-25` | `vDmSeasonTotals`, `vDmStockSku`, `vDmStockModel`, `vDmOrderCost`, `DmLotUse`, `vDmPurchaseChain`, `DmLot`, `vDmPaymentsBySupplier`, `DmPayment` (все SELECT) |
| `scripts/gen-color-mapping-xlsx.ts:28,38` | `DmSku` (`colorCanon`, `colorRefId`, модели) и сезоны, для Excel сопоставления цветов |
| `scripts/mart-refresh.ts`, `scripts/make-demo-db.ts:161` | пишет / очищает (см. раздел 3) |

Замечания:
- MIGRATION-STATUS называет переведёнными «Главную» и «Производство». В коде единственный вызов `loadReportSeasonTotals` — `dashboard/page.tsx:68` (grep по `src/`); страница `/production` его не вызывает. Утверждение про отдельный экран «Производство» кодом не подтверждено.
- Сама сборка витрины зависит от старого кода: `buildMart` импортирует `loadReportSizes` из `margin-server.ts` и `loadOrderRows` из `analytics-orders.ts` (`src/lib/mart/build.ts:3,7,51`). То есть витрина не независимый слой, а копия результата старых расчётов. Для ТЗ режим 4 % зашит как `"on"` (`build.ts:51`), тогда как экраны берут режим из cookie `commission4Display` (`src/lib/commission4-mode.ts`): при «Без 4%» экран и витрина дадут разную себестоимость.
- `loadReportSizes` для сезона FW26/27 подменяет «получено» приходом из файла (`margin-server.ts:60-82` `withOurFw26Delivered`), а витрина берёт `loadReportSizes` как есть, поэтому и в витрине получено FW26/27 = 304 (подтверждено `mart-vs-legacy.ts`: 269/269, 64/64, 512/304).

---

## 3. Кто и когда пишет / пересобирает витрину

Код сборки: `src/lib/mart/build.ts` (`buildMart`, одна транзакция на организацию: удаляет и заново вставляет), `chain.ts` (цепочка сырья и денег), `plans.ts` (JSON → таблицы). Фоновый запуск — `src/lib/mart/refresh.ts:12` (`refreshMartInBackground`: одна сборка на организацию, повторный запрос во время сборки ставит флаг `again`, ошибка пишется в `console.error`, на экран не попадает).

Места вызова (grep `refreshMartInBackground|buildMart` по `src/` и `scripts/`):

| Где | Когда | Файл:строка |
|---|---|---|
| Экран «Загрузка данных», применение файла | после `applyImport`, если появился журнал | `src/app/(app)/settings/import/actions.ts:52` |
| Экран «Загрузка данных», откат | после `rollbackImport` | `settings/import/actions.ts:65` |
| Главная, при открытии | если `martFreshForReport` = `stale` (по отчёту/прайсу/приходу) | `src/lib/margin-server.ts:103-105` |
| Вручную | `npm run mart:refresh`, `mart:update` (пересборка + сверка) | `package.json:10-12`, `scripts/mart-refresh.ts:13` |
| Демо | `scripts/make-demo-db.ts:161` очищает, но не пересобирает; `rebuild-demo.sh` витрину не упоминает (grep пуст) | не проверено, запускается ли сборка при пересборке демо |

Не найдено ни в `Dockerfile`, `docker-entrypoint.sh`, `render.yaml`, `.github/workflows/*`, ни в cron: плановой пересборки нет (grep `mart` по `*.sh`, `*.yml`, `Dockerfile*` пуст).

**Пересборка НЕ запускается после:**
- создания и правки закупок, лотов, приёмки, расходов закупки (`DmPurchase`, `DmLot`);
- записи и завершения ТЗ, списания сырья в ТЗ (`DmLotUse`, `DmCostParty`, себестоимость);
- платежей поставщикам и за работу, распределения платежей (`DmPayment`, `DmPaymentAlloc`);
- правок справочника цветов и синонимов (`DmColorAlias`), справочников меха/категорий;
- правки цены в карточке артикула (`ProductModel.sellingPrice`); в витрину это поле и не входит, цены только из `retail-prices:*`;
- изменений в JSON `budget-pcs:*`, `fw27-presentation`, `shipment-zi:*`, `owner-decision:*` (разложены в `Dm*` `plans.ts`, но обновятся лишь при следующей пересборке, а свежесть их не отслеживает).
Это то же, что записано в MIGRATION-STATUS («нет пересборки после лотов и ТЗ») и подтверждено кодом: единственных двух мест вызова нет в `actions.ts` закупок, ТЗ, платежей.

Побочное: при устаревании Главная при каждом открытии пытается запустить пересборку (`margin-server.ts:103`); защита от повторного запуска только в памяти процесса (`refresh.ts:5`), для нескольких инстансов (Render, масштабирование) не проверено.

---

## 4. Что в приложении НЕ из витрины: загрузчики

Колонка «Витрина есть?»: есть ли для этого в Dm* подходящая таблица или представление. «Можно перевести?» — доказуемо ли идентично сейчас; «блокер» — что мешает.

| Загрузчик (файл) | Источник | Витрина есть? | Можно перевести? | Блокер |
|---|---|---|---|---|
| `dashboard-data.ts` `loadDashboard` (Главная: Активы, Сырьё, Расходы, Производство) | `RawMaterialLot`, `PaymentAllocation`, `ProductionOrder`, `Payment*` через `loadFurLots`, `loadOrderRows`, `loadPaymentsOverview` (`dashboard-data.ts:7-15,310-346,780`) | да: `DmLot`, `DmLotUse`, `DmPayment`, `vDmPurchaseChain`, `vDmOrderCost` | частично; фильтры (год, мех, аукцион, режим 4 %) в витрине не заложены | нет пересборки после закупок/ТЗ/платежей; режим 4 % |
| `app/(app)/dashboard/sales-block-data.ts` (Главная: «Изделия на стоке», маркап, продажи) | отчёт `loadReportSizes` + прайс + `SalesReceiptLine`; закупка остатка € × `MU_EUR_RATE` 110 (`:189,201-203,257,339-341`) | да: `vDmStockSku`, `vDmSeasonTotals`, `vDmMarkup*` | штуки и розница остатка совпадают (346; 689 484 200); закупка остатка — нет (172,7 млн ₽ по отчёту × 110 против 165,9 млн ₽ по ТЗ) | решение владельца: закупка остатка по ТЗ; фильтры категории и листьев |
| `sales-server.ts` `loadSalesInput`, `loadPricing`, `loadChain` (Продажи, Каталог) | `SalesReceiptLine`, `retail-prices`, `ProductModel.sellingPrice`, ТЗ через `loadModelCosts`, отчёт; цепочка из `ShipmentLine` (`:21-80`) | `DmMovement`, `DmRetailPrice`, `DmStock`; для цепочки отгрузок нет | движения и прайс да, но метрики (выручка, НДС, ex-VAT) в витрину не перенесены | НДС в рознице (22/20), метрики продаж |
| `margin-server.ts` `loadMarginInput`, `loadModelCosts`, `loadReportSizes` (Маржа) | `SalesReceiptLine`, `ProductModel`, ТЗ (`loadOrdersDrill`), `retail-prices` | `DmCostParty`, `vDmMarkup*` | нет: маржа считается с НДС и 4 % по ТЗ, в витрине маркап рублёвый, 4 % зашит «on» | единое определение маркапа, режим 4 % |
| `analytics-orders.ts` `loadOrderRows`, `receivedByModel*` (Изделия, Платежи, Производство, аналитика) | `ProductionOrder`, `RawMaterialLot`, `SalesReceiptLine`, `ColorRef`, `ProductModel` | `vDmOrderCost`, `DmCostParty` | нет: источник для самой витрины (`build.ts:51`), перевести — значит замкнуть круг | сначала стабилизировать цепочку ТЗ в витрине |
| `payments-overview.ts` (Оплаты, Главная «Расходы», Cashflow, Производство) | `Payment`, `ProductionPayment`, `PaymentAllocation`, `Purchase` (статус COMPLETED) (`:69-75,261`) | `DmPayment`, `DmPaymentAlloc`, `vDmPaymentsBySupplier` | суммы совпадают (582 208 809 + 69 879 927 ₽ в обоих), но разбивка по статьям, документам и частям (OverviewPart) в витрине отсутствует | нет полей «сумма в валюте и курс»; нет пересборки после платежей |
| `payments-registry.ts` (реестр платежей, Сверка) | `Invoice`, `Payment`, `ProductionPayment`, `Supplier` | нет (счета `Invoice` в витрину не входят) | нет | отсутствует `DmInvoice`; счёт №317 не внесён |
| `supplier-debt.ts`, `auction-payments.ts`, `purchase-summary.ts` (долги, оплачено по закупке) | `Payment` (COMPLETED), `Purchase`, `PurchaseItem` (`purchase-summary.ts:123`, `supplier-debt.ts:241`, `auction-payments.ts:77`) | `DmPurchase`, `DmPayment` | нет, пока не сведены 5 способов «оплачено» (раздел 7) | то же |
| `cashflow-server.ts`, `cashflow.ts`, `cashflow-detail.ts` (Cashflow) | `PurchaseItem`/`PurchaseExpense` (доля НДС), `SalesReceiptLine`, платежи; константы `PROJECT_START_MONTH = "2025-08"` (`cashflow.ts:340`), `CASHFLOW_FIRST_YEAR` | `vDmMovementByMonth`, `DmPayment` | нет: НДС платежей считается по закупкам; в `DmPayment` НДС-доли нет | НДС в рознице и в платежах |
| `fur-table-server.ts`, `raw-analytics.ts`, `raw-balance.ts`, `raw-forecast.ts` (Лоты, Закупки, Сырьё, прогноз) | `RawMaterialLot`, `PurchaseItem`, `StockMovement`, `ProductionMaterialUsage`, отчёт (`raw-forecast.ts`) | `DmLot`, `DmLotUse`, `DmPurchase` | остатки лотов совпадают (проверка `lotQtyBalance` = 0), но экраны требуют признаков меха, аукциона, подкладки | нет пересборки после лотов |
| `stock.ts`, `finished-goods-cost.ts`, `articles/page.tsx:134` (склад, карточка «На складе») | `FinishedGoodsStock` (67 строк), `FinishedGoodsMovement` (555) | `DmStock` (остаток отчёта), склад-таблицы нет | нет: два «остатка» разной природы (учётный склад против отчёта) | единый источник склада |
| `article-metrics.ts`, `articles/page.tsx:131,249` (Изделия: MU 110) | ТЗ (`DrillOrder`), отчёт: закупка € ÷ шт., прайс; цена из `ProductModel.sellingPrice` или прайса | `vDmMarkupStock`, `DmStock` | нет: другой знаменатель (€ отчёта × 110 против ТЗ) | маркап |
| `shipment-data.ts`, `shipments-feed.ts`, `shipment-zi-db.ts` (Отгрузки) | `Shipment*`, `ProductionOrder`, `shipment-zi:*` | `DmShipmentLine` (71 строка) | нет: в ней 59 из 71 строк без изделия | сопоставление цветов (файл v2) |
| `supply-report.ts`, `fw26-plan.ts`, `fw27-plan-data.ts`, `budget-pcs-store.ts`, `forecast-store.ts` (план, прогноз, бюджет) | JSON в SystemState: `sales-fw26-forecast`, `production-plan:fw27`, `budget-pcs:*`, `raw-forecast:*` + отчёт | `DmPlanLine`, `DmPlanParam`, `DmPresentationItem` (копии `budget-pcs`, `fw27-presentation`) | нет: экраны правят JSON, витрина — только копия | решение, кто хозяин данных плана |
| `tz-await.ts`, `season-orders.ts` (Каталог «ждём») | ТЗ минус приход | `vDmInWork` (заказано − получено по отчёту) | нет: другое определение «в работе» (объём ТЗ против заказа отчёта) | решение владельца 12.11 («приход решает») применено только в витрине |
| `plan-fact.ts`, `plan/page.tsx` (План по сезонам) | `ProductionPlan`, `Season`, `ProductionOrder` | нет | нет | таблицы пусты (ProductionPlan 0 строк по реестру) |
| `article-photos.ts`, `article-shop.ts`, `article-params.ts` | JSON `article-photos:*`, `article-shop-links:*`, `article-params:*` | нет | не требуется | карточка артикула |
| `datamart-stock.ts` | внешний датамарт, ключ `datamart-stock` | нет (не наша витрина) | нет | внешний источник |
| `lot-hammer.ts`, `mink-sex.ts`, `registry-coverage.ts`, `calc-presets.ts` | статичные JSON (раздел 5) | нет | нет | статика |
| `cbr-rate.ts` | внешний API `cbr.ru/scripts/XML_daily.asp`, кэш 24 ч (`cbr-rate.ts:1-40`) | нет | нет | используется только в формах закупки (`purchases/cbr-actions.ts`, `new/form.tsx`, `[id]/exchange-rate-form.tsx`, `cost-plan-editor.tsx`), на экраны отчётов не влияет |

Страницы, читающие Prisma напрямую (минуя `lib`): `articles/page.tsx:134-178` (FinishedGoodsStock, ProductionOrder, ColorRef, ProductModel), `payments/page.tsx:172-728` (Payment, ProductionPayment, Purchase, DriveDocument, PaymentAllocation), `production/page.tsx:117-266`, `lots/page.tsx:59-87`, `purchases/page.tsx:112-142`, `shipments/page.tsx:85-138`, `supply-plan/page.tsx:58`, `plan/page.tsx:52-133`, `analytics/margin/page.tsx:23`.

Не проверено: файл за файлом по всем 333 файлам `src/lib` и всем 100+ страницам; таблица составлена по ключевым загрузчикам экранов из задания.

---

## 5. Статика: что и где зашито

| Что | Где | Чем заменить |
|---|---|---|
| Курс 110 ₽/€ — **четыре копии** | `src/lib/mu-rate.ts:2` (`MU_EUR_RATE`), `src/lib/money-currency.ts:5` (`EUR_RATE`), `src/lib/utils.ts:90` (литерал `110`), `src/lib/mart/build.ts:16` (`RETAIL_RATE`), плюс SQL `20261112130000_data_mart_markup_view/migration.sql:13,19` | один параметр (настройка организации) |
| Курс ЦБ | есть `src/lib/cbr-rate.ts`, в расчёты не подключён | подтягивать для отчётов, если решено |
| НДС розницы | `src/lib/margin.ts:8` `RETAIL_VAT_PCT = 22`; `margin.ts:27` `vatPctAt` (20 до 2026-01-01, 22 после) | справочник «Ставки НДС с датами»; одна функция |
| НДС закупок по дате | `src/lib/vat-by-date.ts:4-6` (`VAT_CUTOFF 2026-01-01`, 20/22); дубль `src/lib/batch-intake.ts:731`; запасное значение `22` в `src/lib/commission4.ts:108` | тот же справочник |
| 4 % | `src/lib/commission4-const.ts` (`COMMISSION_RATE = 0.04`, `NO_COMMISSION4_BATCH = 6`); режим показа в cookie | настройка + признак на строке списания |
| Комиссия Веллмеха 4,5 % | текст в `commission4-const.ts` (`COMMISSION4_HINT`) | параметр договора |
| Сезоны | `src/lib/import-core.ts:327` (`REPORT_SEASONS`), `margin-server.ts:113`, `supply-report.ts:23-24`, `sales-reconcile.ts:11-12`, `sales-section.ts:322`, `mart/read.ts` (`LABEL`), `mart/build.ts:12` (`SEASONS`), открытый сезон `"FW 26/27"` в `dashboard-data.ts:269` и `season-orders.ts:17`; сезон из года ТЗ `order-seasons.ts:44`; даты сезона `sales-receipts-core.ts:189-203` (SS: 1.02–31.07, FW: 1.08–31.01) | таблица `Season` уже есть в схеме (6 файлов её читают), но отчёты читают литералы |
| Месяцы прогноза | `src/lib/fw26-plan.ts:5` (`FC_MONTHS` 2026-11, 2026-12, 2027-01), `supply-report.ts:85` (`NOV = "2026-11"`), `sales/forecast-actions.ts:11`, `sales/season-receipts.tsx:135,170` | параметры сценария (`DmPlanParam`) |
| Первый месяц Cashflow | `cashflow.ts:340` `"2025-08"`, `CASHFLOW_FIRST_YEAR = 2025` | дата начала проекта (настройка) |
| Даты в запросах | `payments/page.tsx:534` (`docDate ≥ 2026-01-01`), `attention.ts:258-259` (день импорта 2026-10-01) | параметр / удалить |
| Цвета: дополнительные синонимы | `src/lib/mart/build.ts:32` `EXTRA_COLOR_ALIASES` (TORTOR, VIOLET, BORDEAUX, ORANGE); в `DmColorAlias` ещё 4 ручных и 4 «auto» (MAHOGANY, SILVER, ТОНИРОВКА, TONIROVKA) | таблица синонимов в `ColorRef.aliases` по решению владельца (файл сопоставления) |
| Кириллица-двойники кодов | `sales-receipts-core.ts:6` (`CYR`) | нормализация на загрузке |
| `REPORT_SIZES_KEY = "sales-report-sizes:2026-10-19"` | `src/lib/margin-tree.ts:195`; во всём `src/` и `scripts/` (без archive) больше не используется (grep) | мёртвая константа, удалить после проверки |
| Пол шкур норки | `src/lib/data/mink-lot-sex.json` (4 КБ; «проверено 01.11.2026») через `mink-sex.ts:6` | признак меха «Самец/Самка» у лота (подход уже есть: используется приоритетно) |
| Профили ТЗ артикулов | `src/lib/data/article-tz-profile.json` (17 КБ) через `models/[id]/tz-profile.tsx:1` | витрина `vDmOrderCost`/ТЗ |
| Цена шкуры в валюте для лотов без строки расчёта | `src/data/lot-usd-sources.json` (7 КБ) через `lot-hammer.ts:8` | поле в `costBreakdown`/`PurchaseItem` |
| Сверка реестра | `src/data/reconciliation.json` (255 КБ) — `reconciliation/model.ts:1`; `registry-coverage.json` (38 КБ); `raw-audit-2026-02-09.json` | таблицы `Reconciliation*` (6 таблиц, 0 строк по реестру источников); артефакты разовой сверки |
| Форматы расчёта аукциона | `src/lib/calc-presets.json` (77 КБ) | остаётся как данные формата, но шаблоны хранятся не в БД (`SupplierCalcTemplate`, 1 файл) |
| Seed бюджета штук | `src/lib/budget-pcs-seed.json` (26 КБ) → `budget-pcs-store.ts:3`, создаётся при первом чтении; в базе `budget-pcs` 1 запись, `budget-pcs-seeded` | разложено в `DmPlanLine` |
| Данные цифр на скриптах | `scripts/article_sales_data.json`, `scripts/auction-seed-data.ts`, `scripts/color-seed-data.ts` | разовые seed; не проверял, читает ли их приложение |
| Эталоны владельца | `src/lib/mart/build.ts:26` `MART_EXPECTED = {845, 637, 291, 346, 689 484 200}` — зашиты числами; при новом отчёте проверка начнёт показывать `fail`, пока число не поменять в коде | вынести в `DmDecision` / настройку |

Литерал `110` встречается также в разметке (`scheme/diagram.tsx`, ширины колонок) — это не курс.

---

## 6. Как проверяется согласованность

| Инструмент | Что сверяет | Пишет в БД? | Результат запуска 22.11 |
|---|---|---|---|
| `scripts/mart-verify.ts` (`npm run mart:verify`) | представления с эталоном: заказано 845, получено 637, продано 291, остаток 346, остаток по прайсу 689 484 200 ₽; остаток по моделям = по изделиям; материалы по ТЗ = расход лотов; лоты по закупкам = лоты; платежи по контрагентам = платежи | нет (код прочитан: только `$queryRawUnsafe` SELECT) | запущен: все 9 строк `OK`, «Все представления сходятся с эталонами» (материалы по ТЗ 217 875 579,77; лоты 469 784 591,98; платежи 652 088 735,58) |
| `scripts/mart-vs-legacy.ts` | итоги сезонов из витрины = `loadReportSeasonTotalsLegacy`; свежесть = fresh | нет (только чтение; `martFreshForReport`, `martSeasonTotals`, legacy-расчёт) | запущен: `fresh`; `[FW 25/26 269/269], [SS 2026 64/64], [FW 26/27 512/304]` совпадают |
| `MART_SHADOW=1` | в `loadReportSeasonTotalsImpl` (`margin-server.ts:97-99`) при чтении сравнивает витрину и старый расчёт и пишет `console.warn` | нет | в прод-окружении установлена ли переменная — не проверено |
| `DmCheck` (24 проверки в `buildMart`, `build.ts:265+`) | эталон, приход файла против отчёта, продажи сверх прихода, ТЗ без остатка, лоты, платежи, НДС лотов, ключи | пишет при сборке | видно в базе, на экране не показано |
| `check-invariants.ts`, `docs/TESTING.md` | не про витрину (не читал) | не проверено | не запускал |

Что остаётся не покрыто:
- сверка «витрина = старый расчёт» сделана **только для одного блока** (итоги сезонов). Для остатка, розницы остатка, маркапа, оплат, долгов, лотов, ТЗ парных проверок «экран ↔ витрина» нет; есть лишь сверка с эталонными числами.
- `mart-verify` сравнивает платежи сами с собой (`vDmPaymentsBySupplier` против `DmPayment`), не с `loadPaymentsOverview`. Сверки «витрина ↔ экран Оплаты/Главная» нет.
- `mart-verify`: проверки цепочки сравнивают витрину с самой собой (представление против таблицы той же витрины), не с исходными таблицами Prisma (кроме `DmCheck` `usageVsMaterial` и `purchaseVsLots`, которые сравнивают с `ProductionOrder.materialCost` и позициями закупки при сборке).
- нет автоматического запуска `mart-vs-legacy` в CI (grep `mart` по `.github/workflows/*` пуст).
- нет теста на «свежесть» цепочки (закупки/ТЗ/платежи).

---

## 7. Расхождения: одно число двумя и более способами

### 7.1 Маркап

| Способ | Формула | Файл |
|---|---|---|
| А. Карточка модели | цена (`sellingPrice`) ÷ себестоимость единицы по ТЗ с НДС (с 4 % или без — по cookie) | `src/app/(app)/models/[id]/page.tsx:149`; `src/app/(app)/sales/movement/movement-view.tsx:51` |
| Б. Маржа по моделям | цена (карточка или прайс) ÷ `unitIncl` | `src/lib/margin.ts:109-114` |
| В. Маржа/дерево, «Наценка прихода» | Σ(цена × шт.) ÷ Σ(себестоимость × шт.) по приходу; «карточный» без продаж | `src/lib/margin.ts:148`, `src/lib/margin-tree.ts:91,122` |
| Г. Ценообразование | цена ÷ база (материалы или полная) `baseIncl`, взвешенный по себестоимости партии | `src/lib/analytics-pricing.ts:280,292-299` |
| Д. Изделия, MU (110) | цена ÷ 110 ÷ (поступило € ÷ шт.) | `src/app/(app)/articles/page.tsx:131,249,505` |
| Е. Продажи, MU по сезонам | (выручка ₽ + скидка ₽) ÷ 110 ÷ SC EUR; MU current — цена ÷ 110 ÷ себестоимость € | `src/app/(app)/sales/season-report.tsx:242,347,561-577` |
| Ж. Главная | `rm.in.soldGross / 110 / soldSc`; маркап остатка по € отчёта | `src/app/(app)/dashboard/sales-block-data.ts:257,339-341` |
| З. Витрина | продано: (NS RUR + Discount RUR) ÷ себестоимость по ТЗ; остаток: цена прайса ÷ себестоимость по ТЗ, всё в ₽ без курса | `prisma/migrations/20261112140000_data_mart_markup_rub`, `..150000` |

Значения в витрине (по документам 12.11): продано 3,58, остаток 4,15. Значения по экранам при тех же данных не пересчитывал, разницу не измерял: не проверено.
Ключевые различия: знаменатель (ТЗ с НДС и 4 % / ТЗ без 4 % / € отчёта × 110); числитель (цена с НДС, без НДС, до или после скидки); весовая схема (по строкам, по моделям, по партиям). Нерешено: розница с НДС или без.

### 7.2 Себестоимость

- По ТЗ (с 4 %, без 4 %, c НДС, без НДС): `loadModelCosts` (`margin-server.ts:14-28`, ключ — модель, одна цена на модель), `loadOrdersDrill` (экраны ТЗ), `vDmOrderCost` (витрина), `DmCostParty` (партия, привязана к изделию, 52 % штук на уровне модели по документам).
- По отчёту: SC EUR = `sizeUnitEur` (поступило € ÷ шт.; `stock-money.ts:3-8`), `seasonUnitEur`, заказ € ÷ шт. для закрытых сезонов (`leafStockEur`, `stock-money.ts:23+`).
- `FinishedGoodsStock.avgUnitCost` на карточке артикула (`articles/page.tsx:134`) и `finished-goods-cost.ts`.
- В витрине обе (по партии и средневзвешенная) плюс справочно € отчёта (`DmStock.unitCostReportEur`).

### 7.3 Остаток (штуки)

1. отчёт: получено по трём сезонам − продано (`stock-money.ts:19-23` `sizeStockEur`; витрина `DmStock.stock`; 346);
2. файл прихода/продаж (`sales-section.ts` `openingStock` и цепочка `lines`; 659 − 291 = 368);
3. `FinishedGoodsStock.quantity` (учётный склад, 67 строк);
4. «В работе» по ТЗ: `tz-await.ts` (объём ТЗ − приход) против `vDmInWork` (заказано − получено, 208 шт.) и `loadChain` (`sales-server.ts:61-80`);
5. внешний `datamart-stock` (остаток магазинов и складов).
В `DmCheck` это зафиксировано как `fileVsReport` (659 против 637, +22) и `oversold` (3 шт.).

### 7.4 Закупка остатка

1. отчёт: € × 110: `sales-block-data.ts:201-203` (`leafStockEur`, остаток × закупка по листу артикул+цвет) → ≈ 172,7 млн ₽ (1 570 398,16 € × 110, значение `DmCheck.stockCostReportEur`);
2. по ТЗ, средневзвешенно: 165 852 189,51 ₽ (`DmCheck.stockCostTz`; партии привязаны по размеру 43 %, по цвету 5 %, по модели 52 % штук);
3. по поступлению € ÷ шт. по размеру: `stock-money.ts:19` `sizeStockEur`;
4. по `FinishedGoodsStock.avgUnitCost`.
Разница способов 1 и 2 ≈ 6,9 млн ₽ (около 4 %); в `DATA-MART-PLAN` §4 пример M002: ТЗ 3 395 671 ₽/изд против 3 558 207 ₽ по отчёту (−4,6 %). Малая разница с эталоном шага 2 (1 569 840 € по плану против 1 570 398,16 € по базе) мной не объяснена.

### 7.5 Оплачено и долг

1. `loadPaymentsOverview`: `Payment` и `ProductionPayment` со статусом COMPLETED (`payments-overview.ts:69-75`); часть «Расходы» Главной;
2. `purchase-summary.ts:123`: `payments { status: COMPLETED }` по закупке;
3. `auction-payments.ts` (`loadAuctionSummaries`, `purchasePaidShare` `:77,153`): оплаты по аукциону, доля в закупке; `supplier-debt.ts` (`computeSupplierDebt:118`, `:241`): долг по поставщику;
4. `PaymentAllocation` (`dashboard-data.ts:780`, `payments-overview.ts:261`, `payments/page.tsx:526,620`): оплата работы по ТЗ;
5. витрина: `DmPayment` + `vDmPaymentsBySupplier` (все платежи в витрине COMPLETED: 49 + 39, суммы равны исходным таблицам).
Итоги по базе одинаковы (582 208 809 + 69 879 927 ₽), но способ группировки (по закупке, аукциону, поставщику, ТЗ) разный; в витрине нет суммы в валюте и курса платежа (решение 16.11: оплаты в рублях), нет счёта №317 (3 633 404,98 ₽).

### 7.6 Цена (розница)

Три источника: `retail-prices:*` (прайс по размерам; в витрине `DmRetailPrice`), `ProductModel.sellingPrice` (цена карточки, на Маржа/Изделия/Каталог), «цена прайса, средневзвешенная по приходу» (`margin.ts:45-46`). Приоритет «карточка» против «прайс» зависит от экрана (`margin.ts:109`, `articles/page.tsx:222`).

### 7.7 Прочее

- Режим 4 %: экраны зависят от cookie (по умолчанию «С 4 %»), витрина строится только «on» (`build.ts:51`).
- Получено по FW26/27: экран подменяет приходом из файла (`withOurFw26Delivered`), витрина получает ту же подмену, но потому что берёт `loadReportSizes`; при выделении `buildMart` из `margin-server` это поведение надо сохранить (не проверено, есть ли ещё потребители).
- 59 из 71 строки зачётов отгрузки без изделия; 2 строки прайса без изделия; 7 закупок со стоимостью лотов не равной позициям (`DmCheck.purchaseVsLots`).

---

## 8. Предложение: порядок перевода на витрину

Принцип (решение владельца из MIGRATION-STATUS): переводить только после сверки «экран = старый расчёт» через `mart-vs-legacy.ts` (расширить на каждый блок) и режима `MART_SHADOW=1`; старый расчёт удалять после периода без расхождений.

**Этап 0 (дёшево, безопасно, ничего не меняет в цифрах):**
1. Вынести 110, 22/20 %, 4 % и список сезонов в один модуль/настройку; убрать мёртвую `REPORT_SIZES_KEY` и дубль `EUR_RATE` (после проверки импортов; не удалять без доказательства, что ничего не зависит).
2. Расширить `martFreshForReport` на цепочку (Purchase/RawMaterialLot/ProductionOrder/ProductionMaterialUsage/Payment/ProductionPayment/ColorRef): `max(updatedAt|createdAt)` и счётчики строк.
3. Вызывать `refreshMartInBackground` после записи закупок, лотов, ТЗ, платежей (или таймером раз в N минут + кнопка «Обновить»; решение «когда пересобирать» ждёт владельца). Пересборка ≈ 1 с (`DATA-MART-PLAN` §8).
4. Показать вкладку «Данные» (`DmCheck`), записывать в журнал ошибку пересборки (сейчас только `console.error`, `refresh.ts:21`).
5. Включить `mart-vs-legacy` и `mart:verify` в CI/перед выкладкой.

**Этап 1 (штуки без денег, совпадение доказуемо):**
6. Остаток и штуки по сезонам и изделиям (Главная «Изделия на стоке»: штуки; Продажи → Остатки): `vDmStockSku`/`vDmSeasonTotals`. Блокер: фильтры категории и листьев, сверка по каждому фильтру (MIGRATION-STATUS).
7. Розница остатка (689 484 200 ₽) из `DmStock.stockRetailRub`: совпадение уже проверено `mart-verify`; нужно доказать идентичность при фильтрах.
8. Лоты и закупки (куплено, остаток лота, расход в ТЗ): `DmLot`, `DmLotUse`, `vDmPurchaseChain`; блокер: пересборка после лотов (этап 0.3) и 7 закупок на 492 601 ₽ расходов не в стоимости лотов (вопрос 6 от 13.11).

**Этап 2 (деньги по ТЗ и оплаты, после решений владельца):**
9. Оплаты (`DmPayment`, `vDmPaymentsBySupplier`) для Главной «Расходы» и Cashflow: после пересборки по платежам, полей «валюта и курс» и данных по счёту №317.
10. Закупка остатка: **ждёт решения владельца** (по ТЗ 165,9 млн ₽ против по отчёту × 110 172,7 млн ₽).
11. Маркап: **ждёт решения владельца про НДС в рознице**; затем свести 8 способов к `vDmMarkup*` и перенести метрики продаж (выручка, цена до скидки, SO AS) в витрину; режим 4 % определить как параметр витрины.

**Этап 3 (зависит от данных и сопоставлений):**
12. Цвета (MAHOGANY, SILVER, ТОНИРОВКА) и зачёты отгрузок: файл сопоставления, `DmColorAlias` как источник; отгрузки, `DmShipmentLine`.
13. Единый склад (`FinishedGoodsStock` против отчёта), единый источник цены (карточка против прайса).
14. Клиентский разрез продаж и отгрузки подрядчика: данных нет.
15. Приход по датам и «Движение» (659 против 637): ждёт решения, как показывать разницу.

Зависимости: 0.2 и 0.3 нужны до любых экранов на `Dm*` из цепочки (иначе число станет «старее» экрана); маркап зависит от решения по НДС и от закупки по ТЗ; закупка остатка зависит от решения по ТЗ и от сопоставления цветов/размеров (сейчас 52 % штук привязаны на уровне модели).

---

## Главное (10 строк)

1. Витрина: 20 таблиц Dm* и 13 представлений vDm*, собрана 16.11.2026, сверена с эталоном (`mart:verify` и `mart-vs-legacy` запущены, всё OK).
2. Читает её один экранный блок: итоги сезонов в «Производстве» на Главной (`margin-server.ts:91-107`); представления vDm* в `src/` не читает никто.
3. Пересборка: только после импорта/отката файлов и ленивым запуском с Главной; после закупок, лотов, ТЗ, платежей, цветов, цен карточек не запускается, плановой пересборки нет.
4. `martFreshForReport` смотрит только отчёт, прайс и приход; цепочка сырья и денег может устареть незаметно.
5. Маркап считается 8 способами, закупка остатка 4 (172,7 против 165,9 млн ₽), остаток 5, оплачено 5; цена из трёх мест.
6. Курс 110 зашит в 4 местах и в SQL; НДС 20/22 % и сезоны — литералы в десятках файлов; витрина строится только при режиме «4 % включено», экраны зависят от cookie.
7. Сама сборка опирается на старые загрузчики (`loadReportSizes`, `loadOrderRows`), то есть это копия, а не независимый слой.
8. Сверка «витрина = экран» есть только для итогов сезонов; для остатка, маркапа, оплат парных проверок нет, в CI не запускается.
9. Безопасно сначала: настройки курса/НДС/4 % в одном месте, свежесть и пересборка для цепочки, вкладка «Данные» по `DmCheck`.
10. Ждёт владельца: НДС в рознице, закупка остатка по ТЗ или по отчёту, момент пересборки, сопоставление цветов, счёт №317.
