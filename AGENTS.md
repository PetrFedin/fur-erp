<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Куда что класть

Полный указатель: [docs/PROJECT-LAYOUT.md](docs/PROJECT-LAYOUT.md). Коротко:

- Единственная рабочая папка — `/Users/petr/Documents/claude/fur-erp`; единственная основная ветка — `main`. Копии проекта и параллельные клоны не создавать; worktree только на время, потом `git worktree remove`.
- Работа — в короткоживущих ветках `feat/…`, `fix/…`, `data/…` от свежего `main`; в `main` — после зелёной сборки (`npx tsc --noEmit`, `npx next build`).
- Код — `src/`, схема и миграции — `prisma/`, разовые скрипты данных — `scripts/`, постоянная документация — `docs/`, отобранные отчёты и журналы — `docs/inventory/`; рабочие выгрузки `docs-inventory/` и `uploads/` в git не попадают.
- Перед `next build` остановить dev-сервер; один dev-сервер на порту 3200; БД-контейнер `fur-erp-db-1` не трогать; после работы с данными — `scripts/backup.sh`.
