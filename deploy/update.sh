#!/bin/sh
# Обновление сервера до свежей версии из GitHub. Запуск из папки проекта:  sh deploy/update.sh
# Порядок: 1) копия базы и файлов  2) свежий код  3) сборка образа (внутри: prisma generate → next build)
#          4) запуск (при старте контейнера выполняется prisma migrate deploy — миграции применяются автоматически)  5) проверка.
set -eu
COMPOSE="docker compose -f docker-compose.prod.yml"
echo "== 1/5 Резервная копия"; sh deploy/backup.sh
echo "== 2/5 Свежий код";      git pull --ff-only
echo "== 3/5 Сборка (5–10 минут)"; $COMPOSE build
echo "== 4/5 Запуск и миграции";    $COMPOSE up -d
echo "== 5/5 Проверка"
i=0
until $COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i+1)); [ $i -gt 30 ] && { echo "Приложение не ответило за 2,5 минуты. Логи: $COMPOSE logs --tail=100 app"; exit 1; }
  sleep 5
done
$COMPOSE ps
echo "Готово. Если что-то не так — откат: git checkout <прежний коммит> && $COMPOSE up -d --build; база восстанавливается из ~/backups/fur-erp (docs/DEPLOY.md)."
