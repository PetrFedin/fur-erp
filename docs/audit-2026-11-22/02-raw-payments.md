# Аудит 22.11.2026. Разделы «Сырьё» и «Оплаты»

Метод: только чтение кода в `/Users/petr/Projects/fur-erp` (ветка `main`, HEAD `173c44b4`). Приложение не запускалось, база не читалась, цифры из живых данных не проверялись; все числа в тексте взяты из документов проекта и помечены. Формат ссылок: `файл:строка` относительно `src/` (если не сказано иное). `app/(app)/` сокращено до `app/…`.

Что проверено на предмет «уже исправлено»: `git log` после ревизии 15.11 (`581e4961`) не содержит ни одного коммита, трогающего `lots/`, `purchases/`, `payments/`, `lib/payments-*`, `lib/auction-payments.ts`, `components/raw-tabs.tsx` (команда `git log 581e4961..HEAD -- <эти пути>` пуста). Из всего сделанного после 15.11 к разделам относится только коммит `55b979da` (режимы шапки по страницам, `lib/page-modes.ts`). Поэтому замечания ревизии `docs/ux-review/02-raw-purchases.md` и `05-payments-budget.md` в основном **остались**; статус каждого помечен ниже.

---

## 1. Назначение разделов и роли

**Сырьё** (пункт меню «Сырьё», `components/nav-links.ts:6-8`, подсвечивается также на `/purchases` и `/analytics/raw`). Путь сырья: закупка (документ, счёт, УПД) → приём на склад → лот (шкурки, метры) → списание в ТЗ → остаток; плюс деньги по закупкам. Вкладки (`components/raw-tabs.tsx:21-38`, и копии разметки в `app/…/lots/page.tsx`): Закупки · Мех · Подкладка · Сводка по годам.

**Оплаты** (пункт «Оплаты», `nav-links.ts`). Реестр платежей: оплаты поставщику за сырьё (`Payment`) и оплаты подрядчику за работу (`ProductionPayment`), долг поставщику по аукционам, разнесение авансов, подтверждение платёжками. Cashflow, Бюджеты, Сверка — отдельные пункты меню, здесь не разбираются.

**Роли** (`lib/access.ts`):
- Читать (открыть `/lots`, `/purchases`, `/payments`, карточки): любая внутренняя роль — страницы вызывают `requireSession()` без проверки роли (`app/…/lots/page.tsx:44`, `app/…/purchases/page.tsx:69`, `app/…/payments/page.tsx:146`, `app/…/payments/[id]/page.tsx:113`). Внешний поставщик (`SUPPLIER`) перенаправляется на `/supplier` (`lib/session.ts:87`). То есть `VIEWER`, `WAREHOUSE`, `TECHNOLOGIST` видят все оплаты, п/п и долги. Меню для них не скрывает «Оплаты» (`nav-links.ts` фильтрует только «Чат»).
- Писать закупки, лоты, документы закупок: `ACCESS.purchases` = OWNER, ADMIN, PURCHASER (`lib/access.ts:20`).
- Платежи поставщику, чеки/платёжки, закрытие остатка: `ACCESS.supplierPayments` = OWNER, ADMIN, PURCHASER, ACCOUNTANT (`lib/access.ts:26`).
- Платежи за работу: `PRODUCTION_EDIT_ROLES` = OWNER, ADMIN, TECHNOLOGIST (`lib/production-access.ts:6`).
- Правка лота (карточка лота): OWNER, ADMIN, PURCHASER, WAREHOUSE (`app/…/analytics/raw/lot/[id]/actions.ts:23`).
- Пользовательские столбцы лотов: OWNER, ADMIN, PURCHASER (`app/…/lots/custom-field-actions.ts:19`). Статьи расходов: OWNER, ADMIN, ACCOUNTANT (`app/…/settings/expense-categories/actions.ts:9`).
- Роли продублированы массивами в коде вне `ACCESS`: `app/…/lots/page.tsx:98`, `app/…/purchases/page.tsx:72`, `custom-field-actions.ts:19`, `purchases/doc-actions.ts:11`, `lot/[id]/actions.ts:23`, `expense-categories/actions.ts:9`.

---

## 2. Карта экранов

Обозначения источника: **(В)** — из витрины `Dm*`; **(Т)** — из старых таблиц Prisma (`Purchase`, `RawMaterialLot`, `Payment` и др.); **(С)** — из статики/JSON/констант в коде. Итог поиска: ни один экран разделов не читает витрину (в `src` витрина читается только `lib/margin-server.ts`, `lib/mart/read.ts`, `app/…/settings/import/actions.ts`; grep по `mart`, `vDm`, `prisma.dm`).

| Экран / вкладка | Блоки и данные | Функция (файл:строка) | Источник | Куда ведут клики |
|---|---|---|---|---|
| `/lots` вкладка «Мех» (по умолчанию) | Заголовок + год + «i»; ссылка «Аналитика сырья →»; кнопки «+ Закупка меха», «+ Добавить материал»; переключатель источника (Вся закупка / На аукционах / У поставщика); фильтры меха; плитки «Куплено / Использовано / Остаток» с каруселью по видам; плитки оплат; «Динамика по годам»; таблица «Динамика по сырью» (вид→аукцион→лот→ТЗ); `AuctionCompare` | `lots/page.tsx:287-308` (`loadDashboard`, `loadFurLots`, `loadFurKinds`), `components/fur-selection-total.tsx`, `dashboard/raw-block.tsx:88` (`RawCards`), `dashboard/pay-tiles.tsx:27` (`PayTiles`), `components/auction-compare.tsx:29` | Т (+ С: цена в $ из `data/lot-usd-sources.json`, `lib/lot-hammer.ts:8`; синтетические лоты «Заказано, не получено» и «Шкуры подрядчика», `lib/dashboard-data.ts:747-750`) | таблица → `/lots/fur/[вид]`, `/analytics/raw/lot/[id]`, `/production/[id]`, `/lots?auction=…`; «+ Закупка меха» → `/purchases/batch`; «+ Добавить материал» → `/materials/new` → редирект `/materials?new=1` |
| `/lots?tab=lining` («Подкладка») | То же для метров; кнопка «Купить подкладку» | `lots/page.tsx:340-361`, `loadFurLots(kind:"lining")` | Т | → `/lots/lining/[партия]`, `/purchases/lining/new` |
| `/lots?auction=<название>` (режим «Аукцион») | Закупки партии, документы, оплаты партии (плашка `AuctionDocsPay`), лоты по счетам / списком, свои столбцы | `lots/auction-view.tsx:130` (`AuctionView`), `loadAuctionSummaries` (:212), `loadSupplierDebt` (:219) | Т | → `/purchases/[id]`, `/payments?auction=…`, карточка лота; если все позиции в метрах — редирект на `/lots/lining/[партия]` (`lots/page.tsx:88`) |
| `/lots?tab=summary` («Сводка по годам») | Фильтры, строка-ссылка на Главную, две таблицы за `<details>` | `lots/page.tsx:125-192` (`loadDashboard`, `YearsTable`, `RawTable`) | Т | → `/dashboard#years-table`, `/dashboard#raw-table` |
| `/lots/fur/[fur]` | Страница вида меха: плитки, таблица лотов, заказы-потребители, состав цены | `lots/fur/[fur]/page.tsx` (`loadFurLots`, `loadDashboard`, `loadOrderRows`, `priceComposition`) | Т | → `/production/[id]`, `/lots` |
| `/lots/lining/[batch]` | Карточка партии подкладки: плитки, закупки, оплаты партии, документы | `lots/lining/[batch]/page.tsx:43-51` | Т | → `/purchases/[id]`, `/suppliers/[id]` |
| `/lots/contractor-hides` | «Доплата подрядчику: НДС 22 % по сырью заказчика» (бывшие «шкуры подрядчика»): ТЗ-доли и оплаты | `lots/contractor-hides/page.tsx:25-27` (`loadOrderRows`, `loadPaymentsOverview`, `allocateHides`) | Т | → `/production/[id]`, оплаты |
| `/purchases` | Блоки итогов «Куплено / Оплачено / Долг» (мех, подкладка, услуги), дерево «год → партия → закупка → позиции» или список, фильтры, переключатель Все/Мех/Подкладка, строки «Шкуры подрядчика» и «Округление» | `purchases/page.tsx:111-121` (4 загрузки), `:224-230` (округление), `:235-242` (блоки итогов), `purchases-tree.tsx` | Т | → `/purchases/[id]`, `/payments?auction=…#auction-block`, `/documents?auction=…`, `/lots/contractor-hides`, `/analytics/raw` |
| `/purchases/[id]` | Карточка закупки (1025 строк): шапка, позиции, расходы, оплаты, документы, расчёт себестоимости, подтверждение | `purchases/[id]/page.tsx:94-310` (много `prisma.*.find*`), `loadAuctionSummaries` (:276) | Т | → `/lots/fur/[вид]`, `/analytics/raw/lot/[id]`, `/payments?auction=…`, `/suppliers/[id]`, `/supplier/auction-calcs/[id]` |
| `/purchases/batch` | Мастер «Закупка меха» (3 шага: файл/документы → лоты → расходы, сверка с документом) | `purchases/batch/wizard.tsx` (677), `batch/actions.ts:35,69,179,200` | Т | → `/purchases/[id]` |
| `/purchases/lining/new` | Форма «Купить подкладку» (вся партия за раз) | `purchases/lining/new/form.tsx` | Т | → партия |
| `/purchases/new` | Старая форма «Новая закупка» (черновик) | `purchases/new/page.tsx` | Т | входящих ссылок нет (grep по `purchases/new`: только e2e и docs) |
| `/analytics/raw` | Аналитика сырья: переключатель Мех/Подкладка, фильтры, итоги, группировка, CSV, график по месяцам | `analytics/raw/page.tsx:34,51` (`loadRawWithDashboard`, `loadGroupLots`) | Т | → `/analytics/raw/lot/[id]`, `/analytics/raw/recon`, CSV `export/route.ts` |
| `/analytics/raw/recon` | «Сверка лотов» | `analytics/raw/recon/page.tsx:19,41` | Т + **С**: `data/raw-audit-2026-02-09.json` (снимок аудита от 09.02, статика) | → карточка лота, CSV |
| `/analytics/raw/lot/[id]` | Карточка лота: правка полей, привязка к закупке, документы, остаток | `analytics/raw/lot/[id]/page.tsx`, `actions.ts` | Т | → закупка, ТЗ |
| `/lining`, `/raw-materials` | Редиректы на `/lots` (с переносом параметров) | `lining/page.tsx`, `raw-materials/page.tsx` | — | → `/lots` |
| `/expense-categories` | Редирект на `/settings/expense-categories` | `expense-categories/page.tsx:3-5` | — | → Настройки |
| `/settings/expense-categories` | Справочник статей расходов (Закупка / Производство / Общая) | `settings/expense-categories/page.tsx:22-27` | Т | — |
| `/payments` (по умолчанию «Реестр») | Таблица всех оплат (поставщику и подрядчику): п/п, счёт, получатель, дата, вид, тип, к чему отнесено, сумма, документ, статус; фильтры; сегмент «Тип»; «Колонки»; итоги; кнопка «+ Внести оплату» | `payments/registry-tab.tsx:62` → `lib/payments-registry.ts:65` (`loadPaymentsRegistryFull`) → `lib/payments-overview.ts:63` (`loadPaymentsOverviewImpl`) | Т (расчёт «мех/подкладка» оценивается по лотам: `payments-overview.ts:66-67,107-108`) | → `/payments/[код]`, `/suppliers/[id]`, `/purchases/[id]`, `/production/[id]`, `/payments?tab=all` |
| `/payments?tab=suppliers` («За сырьё») | Плитки «Оплачено / Долг» с составом; таблица партий (аукционов) с оплатами; фильтры; карточка выбранной партии с оплатами и формами; «Закупки без аукциона» (`?noauction=1`) | `payments/page.tsx:154-206` (6 загрузок), `:339-343` (`loadPaymentsOverview`, `loadDashboard`, `payNumbers`), `:820-823` (`PaymentTiles`) | Т + **С**: `INVOICES_FOR_DRAFTS` в `lib/supplier-debt.ts:42-47` (счета Веллмех зашиты в код) | → `/payments?auction=…#auction-block`, `/lots?auction=…`, `/purchases/[id]` |
| `/payments?tab=clients` («За работу») | Плитки «Работа / Оплачено / Долг подрядчику» + разбивка по партиям, список оплат за работу | `payments/page.tsx:612-640`, `loadClientDebt` | Т | → `/production/[id]`, карточка платежа |
| `/payments?tab=all` («Все», скрыта) | Прежний разбор по статьям (`PaymentsOverview`) | `payments/page.tsx:695-753` | Т | ссылка «Разбор оплат по статьям →» из Реестра (`registry-tab.tsx`) |
| `/payments/[id]` (код `s-…` / `c-…`) | Карточка оплаты: сумма/дата/получатель, 4 проверки статуса, документы, правка, история | `payments/[id]/page.tsx:33-37` (`loadPaymentsRegistryFull` целиком ради одной строки) | Т | → закупка/ТЗ/поставщик |
| `/payments/cashflow` | Редирект на `/cashflow` | `payments/cashflow/page.tsx` | — | — |

---

## 3. Действия пользователя и пересборка витрины

Общий итог: **ни одно действие разделов не вызывает `refreshMartInBackground`**. Пересборка витрины запускается только из `app/…/settings/import/actions.ts:52,65` (загрузка отчёта/прайса/прихода и откат) и `lib/margin-server.ts:104` (когда витрина устарела). Все записи разделов заканчиваются `revalidateAll(orgId)` (`lib/revalidate-all.ts:10-16`): он сбрасывает кэш страниц и кэш вариантов фильтров, а счётчики «Контроля» — только если передан `orgId`. Статус «свежести» витрины для цепочки сырья и платежей не отслеживается: `martFreshForReport` (`lib/mart/read.ts:20-31`) смотрит только отчёт, прайс, журналы загрузок и строки прихода. После любой закупки или платежа таблицы `DmPurchase/DmLot/DmLotUse/DmPayment/DmPaymentAlloc/DmOrderExpense` (`lib/mart/chain.ts`) молча устаревают.

| Действие | Роли | Что пишет | Файл:строка | Пересборка витрины |
|---|---|---|---|---|
| Закупка меха пачкой (мастер) | ACCESS.purchases | `Purchase`, `PurchaseItem`, при «принять сразу» лоты и склад (`receivePurchaseInTx`), `Invoice`, `PurchaseDocument`, новые `RawMaterial`/`ColorRef`, `AuditLog` (ключ `BatchIntake`); одна транзакция, защита от двойной отправки | `lib/batch-create.ts:53,101,157-218,247` (`createBatchCore`), вход `purchases/batch/actions.ts:200` | нет (только `revalidateAll`) |
| Закупка подкладки | ACCESS.purchases | закупка + позиции + при необходимости аукцион; откат вручную при ошибке | `purchases/actions.ts:1338-1463` | нет |
| Новая закупка (старая форма) | ACCESS.purchases | черновик `Purchase` | `purchases/actions.ts:101-186` | нет |
| Принять на склад / отменить принятую / сменить статус | ACCESS.purchases | лоты, склад, статус; `resetByPurchase` | `purchases/actions.ts:1282,565,580` | нет |
| Позиции, расходы, курс, расчёт стоимости закупки (добавить/правка/удалить, вставка пачкой) | ACCESS.purchases | `PurchaseItem`, `PurchaseExpense`, `exchangeRate`, план стоимости | `purchases/actions.ts:233,272,334,621,668,715,934,954,978,988` | нет; 11 вызовов `revalidateAll()` без `orgId` — счётчики «Контроля» не сбрасываются (кэш 20 с) |
| Оплата закупки из карточки | ACCESS.purchases | `Payment` | `purchases/actions.ts:1031,1105,1134` (`add/remove/updatePurchasePayment`) | нет. Форма `PurchasePaymentForm` (`purchases/[id]/payment-form.tsx`) и `addPurchasePayment` не вызываются нигде (grep по `src`) |
| Документы закупки / партии | ACCESS.purchases | `PurchaseDocument` + файл на диске | `purchases/doc-actions.ts:18,62,85,124` | нет |
| Правка лота, остатка, даты, материала, привязки к закупке, документы лота | OWNER/ADMIN/PURCHASER/WAREHOUSE | `RawMaterialLot`, `PurchaseDocument` | `analytics/raw/lot/[id]/actions.ts:35-366` | нет |
| Свои столбцы лотов (создать/переименовать/сдвинуть/удалить/значение) | OWNER/ADMIN/PURCHASER | `CustomField`, значения | `lots/custom-field-actions.ts:46-201` | нет |
| Мастер оплаты «+ Внести оплату» | supplierPayments / PRODUCTION_EDIT_ROLES по стороне | `Payment` (поставщику) или `ProductionPayment` + `PaymentAllocation` (за работу), `DriveDocument` с платёжкой | `payments/wizard-actions.ts:55,185,202-391` | нет |
| Прежний `savePayment` (форма оплаты; используется внутри мастера для возврата и кнопкой «Отметить оплату» в `DocsPayPanel`) | как выше | те же таблицы | `payments/pay-actions.ts:180-507` | нет |
| Аванс без привязки, разнесение аванса | supplierPayments | `Payment` (аванс, разбиение на части) | `payments/actions.ts:43-251` (`create/update/deleteAdvancePayment`, `allocateAdvance`) | нет |
| Оплата аукциона целиком, правка, удаление, «закрыть остаток» | supplierPayments | `Payment` (с `auctionSession`, `purchaseId = null`), `PurchaseDocument` | `payments/actions.ts:316-548` | нет |
| Правка и удаление оплаты в карточке | по виду | `Payment` / `ProductionPayment` (и «соседние» строки одной п/п) | `payments/card-actions.ts:86-275` | нет |
| Приложить платёжку | supplierPayments | `PurchaseDocument` + `Payment.confirmed = true` | `payments/mark-actions.ts:31-64` | нет. Действие `attachSupplierPaymentProof` нигде не вызывается (grep); оно ставит `confirmed`, а не `confirmedAt` (см. п. 5, П6) |
| Статьи расходов (создать/вкл-выкл/правка/удалить) | OWNER/ADMIN/ACCOUNTANT | `ExpenseCategory` | `settings/expense-categories/actions.ts:16-80` | нет |

Прочее: на экранах разделов нет кнопок «Обновить витрину». Скрипт `scripts/mart-refresh.ts` запускается вручную.

---

## 4. Связи с другими разделами и где числа могут расходиться

**Откуда берут числа соседние разделы** (поиск по `loadDashboard|loadPaymentsOverview|loadSupplierDebt|loadAuctionSummaries`):
- **Главная** (`app/…/dashboard/page.tsx:63`): один вызов `loadDashboard` кормит блок «Расходы» (`PayTiles`, :144), блок «Сырьё» (`RawBlock`, :152), «Активы» (`AssetsBlock`, :141, остаток меха и его стоимость из `d.raw`), полосу «Главное» (`lib/main-strip.ts`). Внутри `loadDashboard` (`lib/dashboard-data.ts:310`): лоты через `loadFurLots`, оплаты через `loadPaymentsOverview`/`loadPaymentsLeft` (:346), долг подрядчику через `loadClientDebt` (:600). Главная и `/lots` показывают одни и те же плитки из одного вызова, поэтому между ними расхождений нет по построению.
- **Cashflow** (`app/…/cashflow/page.tsx:20`, `lib/cashflow-server.ts:69`): платежи — из `loadPaymentsOverview` (тот же источник, что реестр), НДС закупок — отдельным запросом `loadPurchaseVat` (`cashflow-server.ts:11-12`, по позициям и расходам закупок).
- **Производство/ТЗ**: расход лотов — `ProductionMaterialUsage` (в витрине `DmLotUse`); доли «шкур подрядчика» — `allocateHides` + `loadPaymentsOverview` (`app/…/production/page.tsx:32,356`); оплаты за работу и разнесение — `PaymentAllocation` (в витрине `DmPaymentAlloc`).
- **Бюджеты**: `lib/raw-balance.ts:34` и `lib/raw-forecast.ts:62` берут `loadDashboard(…, "all", …).syntheticLots` (заказанное, но не полученное) — зависимость бюджетов от структуры синтетических лотов.
- **Поставщики, Продажи, Аналитика изделий**: `app/…/suppliers/[id]/page.tsx:65`, `sales/movement/page.tsx:39`, `analytics/products/page.tsx:73` — тоже `loadPaymentsOverview`. Контроль: `lib/attention.ts:334` — `loadAuctionSummaries`.

**Где числа могут разойтись (по коду):**
1. **«Куплено».** `/purchases` считает как сумму документов (`purchaseTotalInclVat`) + шкуры подрядчика + строка «Округление» (`purchases/page.tsx:235-241`, `:224-230`), `/lots` и Главная — как сумму лотов (`loadDashboard`). Разница сводится искусственной строкой «Округление» (порог `ROUND_MIN = 5 ₽`, `lib/raw-rounding.ts:7`; в `rawRounding` тот же порог записан литералом `5`, `:16`). В витрине это колонки `DmPurchase.itemsGross` и `DmPurchase.lotsCostSum` (`lib/mart/chain.ts:37`), и контроль `purchaseVsLots` (`lib/mart/build.ts:290`).
2. **«Оплачено / Долг» считают четыре независимых расчёта:** `loadSupplierDebt` (`lib/supplier-debt.ts:118`), `loadAuctionSummaries` (`lib/auction-payments.ts:153`), `loadPaymentsOverview` (разбивка мех/подкладка по долям лотов, `payments-overview.ts:107-108`), `lotMoney` в `loadDashboard` (`dashboard-data.ts:754-767`). Экран «За сырьё» склеивает три из них в одних плитках: `rawPaidAll` из обзора (`payments/page.tsx:339`), `debt` из `loadSupplierDebt` (:206, :836), числа главного экрана `payNumbers(supDash)` (:343) и строка «Округление» `rawRounding(supDash)` (:823). Это единственный экран, где расхождения объясняются отдельной строкой.
3. **Год.** Оплаты — по дате платежа (`paymentYear`), закупки — по дате заказа (`purchaseYear`), долг по аукционам — по году из названия (`payments-overview.ts:269-272`, по умолчанию 2026). Один и тот же аукцион может попасть в разные годы на разных экранах (документ `docs/analysis/duplicates-relevance.md` отмечал расхождение «Долг: 2025 ≈ 13,78 млн, 2026 ≈ 172,91 млн» против «всегда за все годы» на сводке; сводка с тех пор перенесена в таблицы Главной, расчёт года `loadSupplierDebt(…, year)` остался).
4. **«Подтверждена».** В схеме два признака: `Payment.confirmed Boolean @default(true)` и `Payment.confirmedAt` (`prisma/schema.prisma:680,689`). Реестр и обзор берут `confirmedAt != null` (`lib/payments-overview.ts:154,240`), витрина копирует булев `confirmed` (`lib/mart/chain.ts:50,52`). Так как по умолчанию `confirmed = true`, витринное «неподтверждённых» (`vDmPaymentsBySupplier.unconfirmed`) будет заниженным относительно реестра.
5. **Валюта.** Все формы пишут `currency: "RUB"` (`pay-actions.ts:385`, `wizard-actions.ts:308`, `actions.ts:369,538`). В схеме нет полей «сумма в валюте» и «курс платёжки». Решение владельца 13.11 (`docs/data-mart/OPEN-QUESTIONS-DETAILED-2026-11-13.md:21`): оплаты хранятся в рублях, сумма в валюте и курс — справочно у платежа. В коде и схеме это пока не реализовано.
6. **Витрина и аукционные платежи.** `DmPayment` не имеет поля `auctionSession` (`prisma/schema.prisma:2636-2659`), а `DmPurchase.paidSum` суммирует только платежи, привязанные к самой закупке (`lib/mart/chain.ts:37`, `p.payments`). Оплаты «аукциона целиком» (`purchaseId = null`, `auctionSession` задан) в витрине не атрибутируются закупкам; долг по аукциону из витрины воспроизвести нельзя.
7. **«Мех / подкладка» в оплате.** Доля подкладки в платеже оценивается по долям стоимости лотов закупки или аукциона (`payments-overview.ts:107-108`), а не хранится; затем переплата подкладки по счёту AME пересчитывается в мех (`:178-187`). Это оценка, а не факт.

---

## 5. Проблемы

Серьёзность: **В** (высокая), **С** (средняя), **Н** (низкая). Статус относительно ревизии 15.11: «осталось» / «исправлено» / «новое».

### В — высокая

**П1. Раздел целиком не на витрине, и пересборка после записи не настроена.** Доказательство: п. 2 (поиск `mart`), п. 3, `lib/mart/read.ts:20-31` (свежесть только для отчёта). Следствие: перевод любого блока раздела на витрину без пересборки даёт устаревшие числа сразу после закупки или платежа. Статус: осталось (подтверждено `docs/data-mart/MIGRATION-STATUS.md`, строки «Куплено…», «Оплачено…»). Что делать: решить «когда пересобирать» (после каждой записи в фоне или по кнопке «Обновить») и добавить проверку свежести для цепочки сырья (по `max(updatedAt)` закупок, лотов, платежей против `DmPurchase.builtAt`). Решение владельца (см. п. 6).

**П2. Витрина цепочки сырья неполна для долга и оплат.** Нет `auctionSession` у `DmPayment`, нет аукционной сводки, `paidSum` без аукционных платежей, нет курса/суммы в валюте, булев `confirmed` не равен `confirmedAt` (п. 4, пп. 4-6). Статус: новое (в ревизии 15.11 указаны только «нет полей валюты»). Что делать: до перевода экранов добавить в `DmPayment` колонки `auctionSession`, `confirmedAt`, затем вид «долг по аукциону»; сверить `mart-verify` с `loadSupplierDebt` до копейки.

**П3. Тяжёлые загрузки ради простых экранов.** Реестр платежей грузит все лоты меха и подкладки (`payments-overview.ts:66-67`) только чтобы разделить сумму оплаты на «мех/подкладка»; карточка одной оплаты `/payments/[id]` грузит весь реестр целиком и ищет в нём строку (`payments/[id]/page.tsx:33-37`); вкладка «За сырьё» дополнительно вызывает `loadDashboard` (`payments/page.tsx:341`). Замеров времени нет (не проверял). Статус: новое. Что делать: для карточки грузить одну оплату; разделение «мех/подкладка» хранить или считать из `DmLot`.

**П4. Данные, зашитые в коде.** Счета Веллмех на неполученные закупки (`lib/supplier-debt.ts:42-47`: FH 06.26 115 723 078; СП 09.26 60 831 100; Подкладка 05.26 5 400 000; Доп. материалы 06.26 19 870) — на каждый новый аукцион нужна правка кода и выкладка. Год 2026 вписан в синтетические лоты (`lib/dashboard-data.ts:748`) и в расчёт «Осталось оплатить» (`payments-overview.ts:269-276`). Статус: новое. Что делать: вынести счета в таблицу (`Invoice` уже есть, `lib/batch-create.ts:168`) или в справочник аукционов; год брать из данных.

### С — средняя

**П5. Вкладка «Сводка по годам» пуста, мёртвый код не удалён.** Вкладка — ссылка на Главную и две таблицы под `<details>` (`lots/page.tsx:125-192`). `lots/summary-view.tsx` (502 строки), `summary-node-action.tsx` (37), `vat-sync.tsx` (18) импортируют только друг друга (grep). Вкладка вшита в e2e: `e2e/drive-structure.spec.ts:29-92`, `e2e/final-regress.spec.ts:30`. Статус: осталось. Что делать: убрать вкладку и три файла, переписать e2e.

**П6. Мёртвые формы и действия.** `PurchasePaymentForm` (`purchases/[id]/payment-form.tsx`, 87 строк) + `addPurchasePayment` (`purchases/actions.ts:1031`) и `attachSupplierPaymentProof` (`payments/mark-actions.ts:31`) нигде не вызываются (grep). Последний проставляет `confirmed`, а не `confirmedAt`, и при случайном подключении подтвердил бы платёж не так, как реестр. Статус: новое. Что делать: удалить после проверки (правило «доказать, что ничего не держится»).

**П7. Пять путей внесения оплаты.** Мастер `PaymentWizard` (`components/payment-wizard.tsx`, `wizard-actions.ts`), форма `PaymentForm` (`components/payment-form.tsx` 462 строки, `pay-actions.ts`), `AuctionPaymentForm` (`payments/auction-payment-form.tsx` 417, `actions.ts`), `AdvanceForms` (`payments/advance-forms.tsx` 309), правка в карточке (`card-edit.tsx`, `card-actions.ts`). Ровно 2 разных серверных действия создают `Payment` с одной и той же логикой (`savePayment` и `saveWizardPayment`). Статус: осталось (`docs/analysis/duplicates-relevance.md` №6). Что делать: свести к мастеру и карточке; остальное убрать после проверки вызовов.

**П8. Дубли экранов и блоков.** Одни и те же лоты показывают `/lots` (по видам), `/purchases` (по закупкам) и `/analytics/raw` (по группам), у каждого свои фильтры и плитки итогов; «Динамика по годам» — на Главной, на `/lots` (`variant="years"`, `fur-selection-total.tsx:768`) и во «Сводке»; плитки оплат живут в четырёх местах: `PayTiles` на Главной («Расходы») и на `/lots` («Оплаты»), `PaymentTiles` на `/payments?tab=suppliers` и блоки «Оплачено/Долг» на `/purchases` (`purchases/page.tsx:426-440`). Статус: осталось. Что делать: п. 7.

**П9. Две главные кнопки раздела, не та, что нужно.** На `/lots` главная — «+ Добавить материал» (`lots/page.tsx:239,359`), а закупка вторичная (:235,355); на `/purchases` главная — «+ Закупка меха» (`purchases/page.tsx:451`). «+ Добавить материал» виден всем внутренним ролям, ведёт на `/materials?new=1` (`materials/new/page.tsx`), а создавать материал разрешено только OWNER/ADMIN/PURCHASER/TECHNOLOGIST (`ACCESS.materials`). Статус: осталось. Что делать: главная — закупка (скрыть для ролей без прав), материал — в Настройки.

**П10. Сирота `/purchases/new`.** Нет входящих ссылок, дублирует мастер (`purchases/new/page.tsx` сам отсылает на `/purchases/batch`). На нём держатся e2e (`e2e/purchases.spec.ts:165`, `auction.spec.ts:1414`, `mobile-edit.spec.ts:44`, `smoke.spec.ts:6`, `dashboard.spec.ts:7`, `final-regress.spec.ts:186`). Статус: осталось (`docs/AUDIT-2026-10-27.md:28`). Что делать: решить, нужна ли форма «одна закупка без файла» (см. п. 6); если нет — удалить страницу, форму, `createPurchase` и правку 6 e2e.

**П11. Меню и вкладки.** Пунктов меню по-прежнему 12 (`nav-links.ts`, правило владельца «6»). Подпункты «Мех/Подкладка» продублированы тремя наборами разметки в `lots/page.tsx` (:143, :243, :366) и собственным классом вместо `tabCls` (`lots/page.tsx:103-122` против `raw-tabs.tsx`). Статус: осталось.

**П12. Реестр платежей: нет пагинации и экспорта.** Все строки рендерятся в одной таблице (`registry-tab.tsx`, `rows.map` без лимита); по данным анализа 07.10 платежей было 313 (`docs/analysis/duplicates-relevance.md`). Нет выгрузки в Excel (при правиле «Excel — источник истины» это нужно для сверки с банком). Счётчик «Ждут документа или проверки» не кликабелен. Статус: осталось.

**П13. Чтение денег доступно всем внутренним ролям** (п. 1). Статус: новое как вопрос доступа. Решение владельца.

**П14. `revalidateAll()` без `orgId`:** 11 вызовов в `purchases/actions.ts` (grep `revalidateAll();`) и в `custom-field-actions.ts`, `doc-actions.ts` — счётчики «Контроля» отстают до 20 с (`lib/revalidate-all.ts:13-14`). Статус: новое. Малое безопасное исправление (п. 6).

**П15. Режимы шапки на `/lots` и `/analytics/raw` остаются «все три»** (`lib/page-modes.ts`: `/lots` — ALL; `/analytics/raw` правилом не указана и получает ALL). `/purchases` (год, НДС, без 4 %) и `/payments` (год, без НДС, без 4 %) приведены в порядок коммитом `55b979da`. Статус: частично исправлено.

### Н — низкая

**П16. Шум.** Подсказок «i»: 8 в `fur-selection-total.tsx`, 8 в `analytics/raw/page.tsx`, 4 в `purchases/page.tsx`, 4 в карточке закупки, 4 в `registry-tab.tsx`, 3 в `payments/page.tsx` (grep `<InfoHint`). Хлебные крошки «Сырьё › Мех» дублируют вкладку и заголовок (`lots/page.tsx:325`). Невидимая выравнивающая строка и строка «Сверка» в плитках (`fur-selection-total.tsx:699-730`). Статус: осталось (`02-raw-purchases.md` разд. 1, п. 4, 10).

**П17. Снимок аудита как статика.** `data/raw-audit-2026-02-09.json` на `/analytics/raw/recon` (`recon/page.tsx:19`) — данные на 09.02 показываются как текущие; цены в $ из `data/lot-usd-sources.json` обновляются только вручную скриптом. Статус: новое, проверить значимость.

**П18. Таблица `/lots` и `AuctionCompare`.** `AuctionCompare` (`lots/page.tsx:380`) — отдельный блок сравнения аукционов под таблицей; в ревизии 15.11 предлагалось проверить нужность. Решение владельца.

---

## 6. Что можно исправить сразу и что требует решения владельца

**Малое и безопасное (без смены чисел), можно делать сразу:**
1. Передавать `orgId` во все `revalidateAll()` в `purchases/actions.ts` (11 мест), `purchases/doc-actions.ts`, `lots/custom-field-actions.ts` (П14). Файл: `lib/revalidate-all.ts` либо сами вызовы.
2. Заменить литерал `5` в `rawRounding` (`lib/raw-rounding.ts:16`) на `ROUND_MIN`.
3. Не показывать «+ Добавить материал» ролям без `ACCESS.materials` и снять с него «главную» кнопку на `/lots` (`lots/page.tsx:239,359`) — поменять местами кнопки (П9).
4. Подставить `hasRole(role, ACCESS.purchases)` вместо массивов в `lots/page.tsx:98`, `purchases/page.tsx:72` (п. 1).
5. Убрать мёртвое после проверки grep и e2e: `lots/summary-view.tsx`, `summary-node-action.tsx`, `vat-sync.tsx`; `purchases/[id]/payment-form.tsx`, `addPurchasePayment`; `attachSupplierPaymentProof` (П5, П6). Пункт требует прогона e2e и по правилу проекта делается отдельным коммитом с возможностью отката.
6. `/payments/[id]`: вместо загрузки всего реестра грузить одну оплату (П3) — без смены чисел, только скорость.
7. Хлебные крошки «Сырьё › Мех» убрать со страницы-корня (`lots/page.tsx:325`).

**Нужно решение владельца:**
- Когда пересобирать витрину: после каждой записи в фоне или по кнопке/расписанию (П1).
- Что показывать как «куплено»: сумма документов или лотов, нужна ли строка «Округление» (П8, разд. 4 п. 1).
- Валюта: внести в схему платежа сумму в валюте и курс платёжки (решение 13.11 принято, реализации нет); счёт №317 ждёт данных (`docs/data-mart/OPEN-QUESTIONS-DETAILED-2026-11-13.md:9,24`).
- Доступ: кто видит оплаты и долги (VIEWER, WAREHOUSE, TECHNOLOGIST) (П13).
- Нужна ли «Новая закупка» (одиночная форма) рядом с мастером (П10).
- Состав вкладок раздела: убрать «Сводку по годам»; оставить ли `/analytics/raw` отдельным экраном или влить в «Сырьё» (П8).
- Состав вкладок «Оплат»: убрать «Все», решить судьбу вкладок «За сырьё» / «За работу» (П7, П8).
- Где хранить счета Веллмех (`INVOICES_FOR_DRAFTS`) и кто их вносит (П4).

---

## 7. Предложение: минимум для демонстрации, что убрать, упростить, объединить

**Минимальный набор данных для демонстрации (демо-база, Dm* на ней пуста, раздел работает на старых таблицах):**
- Сырьё: 2 аукциона мех (например СП и FH) — один принят на склад (3 закупки, 5-6 лотов, из них два лота частично списаны в 2 ТЗ), один «заказано, не получено» (1 закупка, черновик); 1 партия подкладки; 1 закупка у поставщика без аукциона; в каждой партии есть счёт и УПД.
- Оплаты: 1 аванс без привязки, 1 оплата аукциона целиком (частичная), 1 оплата закупки, 1 оплата за работу, разнесённая на 2 ТЗ; один платёж с прикреплённой платёжкой («Подтверждена») и один без («Ждёт документа»); один платёж на несколько строк (одна п/п).
- Функции для показа: `/lots` (плитки Куплено/Использовано/Остаток, таблица по видам, фильтр по аукциону); `/lots?auction=…`; карточка лота; `/purchases` (дерево) и `/purchases/[id]`; мастер «Закупка меха» (файл → лоты → расходы); `/payments` (реестр, фильтр, карточка); «+ Внести оплату» для сырья и работы; «За сырьё» (долг по аукционам).

**Что убрать:** вкладку «Сводка по годам» и три файла мёртвого кода (П5); `PurchasePaymentForm`, `addPurchasePayment`, `attachSupplierPaymentProof` (П6); `/purchases/new` (если владелец согласен, П10); скрытую вкладку `?tab=all` и ссылку «Разбор оплат по статьям →» (П8); дубль «Динамика по годам» на `/lots`; блок «Сверка» в плитках `/lots` (перенести в «Контроль»); хлебные крошки на корневой странице раздела.

**Что упростить:** плитки на `/lots` до трёх строк (количество, сумма, цена ₽), остальное (цена в $, надбавка 4 %, НДС по ставкам) под клик; фильтры `/lots` и `/purchases` до 4 (аукцион, вид, цвет, поиск), остальное в «ещё»; мастер оплаты до 3-4 действий для типовой оплаты по счёту; «Вид» и «Тип» в реестре платежей склеить в один столбец; число «Ждут документа» сделать ссылкой на фильтр.

**Что объединить:** одну страницу «Закупки + Мех + Подкладка» с переключателем «Закупки / По лотам» (одна копия фильтров и итогов вместо трёх) и `/analytics/raw` как режим «Группировка» той же страницы; плитки оплат оставить в одном месте (`/payments?tab=suppliers`), на `/lots` и `/purchases` — только ссылка «→ Оплаты» и одно число долга; пять путей внесения оплаты свести к мастеру и карточке платежа.

**Порядок работ, если решать вместе с витриной:** (1) добавить в витрину `auctionSession`, `confirmedAt`, курс/сумму в валюте, и пересборку после записи закупок, лотов, платежей; (2) сверить `mart-verify` с `loadSupplierDebt` и `loadAuctionSummaries` до копейки; (3) перевести плитки «Оплачено/Долг» на витрину и убрать «мост» и «Округление»; (4) перевести «Куплено/Использовано/Остаток»; (5) удалить старые расчёты после периода без расхождений (правило перевода из `MIGRATION-STATUS.md`).

**Чего не проверял:** время ответа экранов; фактические числа в базе (боевой и демо); вид на iPad; работу `e2e`; поведение `/supplier/raw` и `/supplier/auction-calcs` (кабинет подрядчика, другой участок); экраны `Сверка`, `Cashflow`, `Бюджеты`. Утверждения «не вызывается» основаны на grep по `src`, динамические вызовы и скрипты вне `src` не искал, кроме `e2e`, `scripts`, `docs`.

---

## Главное (кратко)

1. Раздел не читает витрину ни одним экраном; после закупок, лотов и платежей витрина не пересобирается и её свежесть для цепочки сырья не отслеживается.
2. В витрине нет `auctionSession` у платежей, `confirmedAt` и валюты, поэтому долг по аукциону и «подтверждено» оттуда не воспроизвести.
3. Ревизия 15.11 почти целиком осталась: после неё изменены только режимы шапки (`/purchases`, `/payments` в порядке; `/lots` и `/analytics/raw` нет).
4. Мёртвое: вкладка «Сводка по годам» + три файла (557 строк), `PurchasePaymentForm`, `addPurchasePayment`, `attachSupplierPaymentProof`, сирота `/purchases/new` (держится на 6 e2e).
5. Пять путей внесения оплаты и три экрана по одним лотам (`/lots`, `/purchases`, `/analytics/raw`), плитки оплат в четырёх местах.
6. Данные в коде: счета Веллмех (`lib/supplier-debt.ts:42-47`), год 2026 в синтетических лотах и «Осталось оплатить».
7. Реестр платежей и `/payments/[id]` тянут все лоты и весь реестр (скорость, не замерено).
8. Все платежи пишутся в рублях; решение 13.11 про сумму в валюте и курс не реализовано.
9. Оплаты и долги видят все внутренние роли; роли продублированы массивами вне `ACCESS`; на `/lots` главная кнопка «+ Добавить материал» видна всем.
10. Малое безопасное: `orgId` в 11 вызовах `revalidateAll()`, константа `ROUND_MIN` вместо литерала, кнопки по ролям, `/payments/[id]` без полного реестра.
