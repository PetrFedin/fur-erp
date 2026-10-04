#!/bin/sh
# Ночная копия: база + загруженные файлы. Запуск из папки проекта на сервере: sh deploy/backup.sh
# Хранит 14 последних копий в ~/backups/fur-erp. Скопируйте их ещё и вне сервера (см. docs/DEPLOY.md, шаг 12).
set -e
DIR="$HOME/backups/fur-erp"
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$DIR"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U fur_erp --no-owner fur_erp | gzip > "$DIR/db_$STAMP.sql.gz"
docker run --rm -v fur-erp_fur_erp_uploads:/data -v "$DIR":/out alpine tar czf "/out/uploads_$STAMP.tgz" -C /data .
ls -1t "$DIR"/db_*.sql.gz | tail -n +15 | xargs -r rm -f
ls -1t "$DIR"/uploads_*.tgz | tail -n +15 | xargs -r rm -f
echo "готово: $DIR ($STAMP)"
