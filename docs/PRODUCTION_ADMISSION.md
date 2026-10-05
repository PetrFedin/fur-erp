# Fur ERP — Production Admission

Цель: не считать развертывание рабочим только потому, что сайт открылся.

Production PASS разрешён только когда одновременно выполнены все условия ниже.

## 1. Liveness

`GET /api/health`

Ожидается HTTP 200 и:

```json
{"ok":true,"service":"fur-erp"}
```

Эта проверка не подтверждает готовность данных. Она означает только, что Next.js процесс отвечает.

## 2. Deep readiness

`GET /api/ready`

Публично возвращает только:

- `production_ready`;
- `checked_at`;
- `blockers`.

HTTP 200 означает Production PASS.
HTTP 503 означает, что хотя бы один обязательный слой не готов.

Для авторизованного пользователя:

`GET /api/ready?details=1`

добавляет диагностику БД, покрытие DriveDocument и reconciliation queue.

## 3. Обязательные слои

### PostgreSQL

Должны быть доступны обязательные таблицы:

- Organization
- User
- Purchase
- PurchaseItem
- Payment
- RawMaterialLot
- StockMovement
- ProductionOrder
- ProductionMaterialUsage
- ProductionPayment
- ProductionBatch
- DriveDocument

Не должно быть незавершённых Prisma migrations.

### Core data

Минимально должны быть загружены:

- организация;
- пользователи;
- закупки;
- лоты сырья;
- ТЗ производства.

Пустая после migrations база не является production-ready.

### Drive document authority

DriveDocument — слой доказательств. Для production admission:

- в БД должны существовать DriveDocument;
- не менее 95% записей должны иметь проверенный `viewUrl`;
- fileId/path/url должны указывать на актуальную структуру папки «Мех».

Автоматическая онлайн-синхронизация Drive не считается включённой только из-за наличия ссылок. До отдельного OAuth/service-account authority поле `online_sync` остаётся false.

### Reconciliation

Используется текущий `src/data/reconciliation.json`.

Правило суммы:
расхождение до **3,96 ₽ включительно** считается совпадением.

Очередь:

- `ok` — полностью сходится;
- `docs` — по документам сходится, но есть особенности привязки;
- `unpaid` — нет подтверждения факта оплаты;
- `review` — арифметика понятна, но нужен первичный документ/решение человека;
- `conflict` — документы и/или БД реально противоречат друг другу;
- `empty` — данных недостаточно.

Наличие `review`, `unpaid` или `conflict` не делает сам runtime неработоспособным: это бизнес-очередь контроля. Но эти строки нельзя автоматически переводить в подтверждённые операции.

## 4. Blocker codes

- `DATABASE_UNREACHABLE`
- `DATABASE_SCHEMA_INCOMPLETE`
- `DATABASE_MIGRATION_FAILED`
- `PRODUCTION_DATA_NOT_LOADED`
- `DRIVE_DOCUMENT_AUTHORITY_INCOMPLETE`
- `RECONCILIATION_DATASET_STALE_OR_EMPTY`

Production PASS только когда `blockers=[]`.

## 5. Порядок первого production запуска

1. Создать отдельную PostgreSQL именно для fur-erp.
2. Восстановить актуальный дамп рабочей БД.
3. Выполнить `prisma migrate deploy`.
4. Восстановить persistent uploads, если они используются.
5. Запустить приложение.
6. Проверить `/api/health`.
7. Авторизоваться и проверить `/api/ready?details=1`.
8. Исправить все infrastructure blockers.
9. Провести smoke-тест: закупка → лот → ТЗ → списание → документы → оплаты → сверка.
10. Только после этого считать контур production-ready.

## 6. Источник текущего состояния

На 05.10.2026 актуальная доказательная сверка синхронизирована с пересобранной папкой «Мех».
Excel остаётся контрольным экспортом/внешним способом проверки, но операционная система истины после Production PASS — PostgreSQL + связанный Drive document authority.
