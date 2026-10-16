# Куда что класть (МехУчёт / fur-erp)

Это единственный документ-указатель: где живёт проект, куда писать изменения и как поднять всё с нуля.
Решение владельца (07.10.2026): **одна рабочая папка, одна основная ветка, никаких параллельных копий.**

## 1. Что считать основным

| Что | Единственное значение |
|---|---|
| Рабочая папка на компьютере | `/Users/petr/Projects/fur-erp` |
| Репозиторий | GitHub `PetrFedin/fur-erp` (приватный) |
| Основная ветка | `main` (на GitHub и локально в основной папке) |
| Dev-сервер | один, порт `3200` (`npm run dev -- -p 3200`), запускается из основной папки |
| База для разработки | docker-контейнер `fur-erp-db-1`, порт `5436` (см. `docker-compose.yml`) |

## 2. Как вести ветки

- Основная ветка одна — `main`. Всё, что в ней, должно собираться (`npx tsc --noEmit`, `npx next build`).
- Любая работа — в короткоживущей ветке от свежего `main`: `feat/…`, `fix/…`, `data/…`, `docs/…`, `ops/…`.
- В `main` ветка попадает после зелёной сборки (merge в `main`, push). Влитую ветку удалять: локально и на GitHub.
- Если ветка не влита, но больше не нужна — сначала поставить аннотированный тег `archive/<имя-ветки>`, запушить тег, потом удалять ветку.
- Параллельные клоны проекта запрещены. Worktree (`git worktree add`) — только на время одной задачи, затем `git worktree remove`.
- Никаких `push --force`, `reset --hard`, `clean -fd` без предварительного архива.

## 3. Порядок работы (каждый раз)

1. `cd /Users/petr/Projects/fur-erp && git switch main && git pull`
2. `git switch -c fix/что-делаем` — работа.
3. Проверка: `npx prisma validate`, `npx tsc --noEmit`; перед `npx next build` остановить dev-сервер (`:3200`) и не запускать build там, где работает чужой dev-сервер.
4. Коммит, `git push -u origin fix/что-делаем`, слияние в `main`, `git push origin main`.
5. После работы с данными — `scripts/backup.sh` (дамп БД + загрузки в `~/Backups/fur-erp`).

## 4. Структура каталогов

| Каталог / файл | Что хранится | В git |
|---|---|---|
| `src/` | приложение (Next.js App Router): `app/(app)/…` страницы, `components/`, `lib/` (бизнес-логика), `data/` (реестр сверки `reconciliation.json` и снимки). Меню — `components/nav-links.ts` (8 пунктов), вкладки «Контроль» — `components/control-tabs.tsx` (счётчики — `lib/control-counts.ts`), центр задач — `lib/task-center.ts` | да |
| `prisma/` | `schema.prisma` и `migrations/` (только вперёд; проверка — `scripts/check-migration-safety.sh`) | да |
| `scripts/` | разовые скрипты работы с данными: `apply-*`, `fix-*`, `seed-*`, `import-*`, `link-*`, `attach-*`; каждый пишет журнал в `docs-inventory/corrections-journal-*.json`; плюс `backup.sh`, `build-reconciliation.ts` | да |
| `docs/` | постоянная документация: `DEPLOY`, `TESTING`, `DATA-SAFETY`, `ROADMAP`, `PRODUCTION_ADMISSION`, `analysis/`, этот файл | да |
| `docs/inventory/` | отобранные (curated) копии рабочих отчётов и журналов операций: Markdown-отчёты, `corrections-journal-*.json`, `dates-pending.json`, `crosscheck-pending.json`, `full-crosscheck.json`, `detail-audit.json` | да |
| `docs/archive/` | снимки незавершённой работы других сессий (patch + описание) | да |
| `docs-inventory/` | рабочие выгрузки и журналы операций, в т. ч. сырые выгрузки документов (`extract/`, `*.pkl`) и журнал очистки от внешних ссылок | **нет** (в `.gitignore`) |
| `uploads/` | загруженные файлы (документы закупок, фото примерок); копируются `scripts/backup.sh` | **нет** |
| `deploy/` | боевой запуск: `Caddyfile`, `backup.sh`; `docker-compose.prod.yml` и `Dockerfile` в корне | да |
| `e2e/` | сквозные тесты Playwright | да |
| `.github/workflows/` | CI (lint/build) | да |
| `.env` | локальные настройки (в git нет), шаблон — `.env.example` | нет |

## 5. Где лежат бэкапы и архивы

- База и загрузки: `~/Backups/fur-erp/` (создаёт `scripts/backup.sh`, хранит 30 последних копий).
- Снимок папок перед объединением 07.10.2026: `~/Backups/folders-2026-10-07/` (tar без node_modules/.next, git patch, список untracked, `all-refs.bundle` — все ветки репозитория).
- Убранные из работы лишние папки: `~/Backups/archived-folders/`.
- Восстановление БД из дампа: `gunzip -c ~/Backups/fur-erp/fur_erp_<дата>.sql.gz | docker exec -i fur-erp-db-1 psql -U fur_erp -d fur_erp`; загрузки: `tar -xzf uploads_<дата>.tar.gz -C uploads/`.

## 6. Правила для агентов и сессий

- Не создавать копии проекта (`fur-erp-*`, `cp -r`, новые клоны) и не работать в чужих worktree/папках.
- Перед `next build` остановить dev-сервер основной папки; один dev-сервер на порту `3200`.
- Не трогать БД-контейнер `fur-erp-db-1` (не останавливать, не пересоздавать том); пробные записи — только на scratch-базе.
- Прежде чем удалять что-либо — убедиться, что на этом ничего не держится; при сомнении — архив.
- Разовые временные скрипты (`.tmp-*`) не коммитить и не оставлять в корне после работы.
- Ничего не писать в `docs-inventory/` вместо `docs/`: постоянное — в `docs/`, рабочее — в `docs-inventory/`, а ценное из рабочего копировать в `docs/inventory/`.

## 7. Поднять проект с нуля

```bash
git clone https://github.com/PetrFedin/fur-erp.git /Users/petr/Projects/fur-erp
cd /Users/petr/Projects/fur-erp
npm ci
cp .env.example .env                 # при необходимости поправить DATABASE_URL / секреты
docker compose up db -d              # PostgreSQL на порту 5436
npx prisma migrate deploy            # применить миграции
npx prisma generate
npm run dev -- -p 3200
```

Внимание: 08.10.2026 проект ПЕРЕНЕСЁН из `~/Documents/claude/fur-erp` (синхронизация iCloud выгружала и портила тысячи файлов `node_modules`, `tsc`/`next build` и dev-сервер зависали) в `/Users/petr/Projects/fur-erp` — вне iCloud. Единственная рабочая папка теперь `/Users/petr/Projects/fur-erp`; в `~/Documents/claude/fur-erp` остаётся только символическая ссылка на неё (для старых путей) — не работать через неё и не создавать там файлов. Если `node_modules` когда-нибудь повредится: `rm -rf node_modules && npm ci` (или `cp -cR` из копии с тем же `package-lock.json`). Символическая ссылка `node_modules -> node_modules.nosync` НЕ годится: Turbopack падает с `there must be a path to a root`. Перед `next build` нужен свежий `npx next typegen` (иначе `tsc` не знает `PageProps`). Запуск dev-сервера из панели: `.claude/launch.json` (`cd /Users/petr/Projects/fur-erp && PORT=3200 npm run dev`).

Данные: восстановить БД из дампа (см. раздел 5), положить `uploads/` из архива. Если дампа нет — данные пересобираются скриптами из `scripts/` (порядок и журналы — `docs/inventory/`, `docs/DATA-SAFETY.md`).
Боевой деплой — `docs/DEPLOY.md`; допуск production — `docs/PRODUCTION_ADMISSION.md`; тесты — `docs/TESTING.md`.
