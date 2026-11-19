# THE FUR (fur-erp): МехУчёт

Мультитенантное веб-приложение для учёта закупок сырья, остатков, производства, себестоимости, оплат и продаж.
Каждая компания (Organization) видит только свои данные; роли внутри компании: владелец, администратор, закупщик,
кладовщик, технолог, бухгалтер, наблюдатель, а также кабинет поставщика/подрядчика.

**Стек:** Next.js 16 (App Router, TypeScript) · Tailwind CSS · PostgreSQL + Prisma · Auth.js (email и пароль, JWT-сессии) · Recharts.

## Быстрый старт с нуля

Нужны: Node 22, Docker (для PostgreSQL). Проверено на чистой копии с GitHub.

```bash
git clone https://github.com/PetrFedin/fur-erp.git
cd fur-erp
npm ci
cp .env.example .env              # порт базы 5436; секрет сессий см. комментарий в файле
docker compose up db -d           # PostgreSQL на порту 5436
npx prisma generate
npx prisma migrate deploy         # применить все миграции
npm run dev -- -p 3200            # http://localhost:3200
```

**Данные.** Репозиторий хранит только код, миграции и обезличенную демо-базу; реальных данных и паролей в нём нет.
- *Пустая база:* откройте `/register` (в режиме разработки регистрация включена) и заведите компанию.
- *Демо-данные:* создайте базу и загрузите дамп, затем задайте пароль пользователю:
  ```bash
  docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c "create database fur_erp_demo"
  gzip -dc deploy/demo/demo.sql.gz | grep -vE '^\\(un)?restrict ' | docker exec -i fur-erp-db-1 psql -U fur_erp -d fur_erp_demo -q
  # в .env: DATABASE_URL=.../fur_erp_demo; затем:
  node --env-file=.env node_modules/.bin/tsx scripts/set-user-password.ts <email> <пароль не короче 8 знаков>
  ```
- *Боевой режим* (`next start`, Docker): нужен `NEXTAUTH_SECRET` не короче 32 символов (`openssl rand -base64 32`); регистрация и демо-вход там выключены по умолчанию.

Типы для `tsc` создаются Next.js при первом `npm run dev` или `npx next build`.

## Карта документов

| Что нужно | Документ |
|---|---|
| Где что лежит, ветки, порядок работы, бэкапы, как поднять проект | [docs/PROJECT-LAYOUT.md](docs/PROJECT-LAYOUT.md) |
| Боевой деплой, Docker, резервные копии на сервере | [docs/DEPLOY.md](docs/DEPLOY.md), [docs/PRODUCTION_ADMISSION.md](docs/PRODUCTION_ADMISSION.md) |
| Безопасность данных | [docs/DATA-SAFETY.md](docs/DATA-SAFETY.md) |
| Тесты и проверки | [docs/TESTING.md](docs/TESTING.md) |
| Единая витрина данных (массив), перевод экранов, открытые вопросы | [docs/data-mart/](docs/data-mart/), [MIGRATION-STATUS](docs/data-mart/MIGRATION-STATUS.md) |
| Ревизия интерфейса (разборы по разделам) | [docs/ux-review/](docs/ux-review/) |
| Стиль интерфейса | [docs/ui-style-guide.md](docs/ui-style-guide.md) |
| Накопленные описания функций и решений (бывший README) | [docs/FEATURES-NOTES.md](docs/FEATURES-NOTES.md) |
| Планы и дорожная карта | [docs/ROADMAP.md](docs/ROADMAP.md) |

## Правила работы

Одна рабочая папка, одна основная ветка `main`, любая работа в короткой ветке или сразу в `main` с проверкой
(`npx prisma validate`, `npx tsc --noEmit`, `npx next build`); после работы с данными: `scripts/backup.sh`.
Данные клиентов, пароли и ключи в репозиторий не кладутся (`.env`, `uploads/`, `docs-inventory/` в `.gitignore`).
Подробности и исключения: [docs/PROJECT-LAYOUT.md](docs/PROJECT-LAYOUT.md).
