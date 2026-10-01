#!/usr/bin/env bash
# Резервная копия боевой базы и загруженных файлов (документы закупок, фото примерок).
#   scripts/backup.sh [каталог]   (по умолчанию ~/Backups/fur-erp)
# Делает fur_erp_<дата>.sql.gz и uploads_<дата>.tar.gz, хранит последние 30 копий.
# Восстановление: gunzip -c файл.sql.gz | docker exec -i fur-erp-db-1 psql -U fur_erp -d fur_erp
set -euo pipefail
cd "$(dirname "$0")/.."
dest="${1:-$HOME/Backups/fur-erp}"; mkdir -p "$dest"
stamp="$(date +%Y%m%d_%H%M%S)"
docker exec fur-erp-db-1 pg_dump -U fur_erp --no-owner fur_erp | gzip > "$dest/fur_erp_$stamp.sql.gz"
up="${UPLOAD_DIR:-./uploads}"
[ -d "$up" ] && tar -czf "$dest/uploads_$stamp.tar.gz" -C "$up" . || true
ls -1t "$dest"/fur_erp_*.sql.gz 2>/dev/null | tail -n +31 | xargs -I{} rm -f {}
ls -1t "$dest"/uploads_*.tar.gz 2>/dev/null | tail -n +31 | xargs -I{} rm -f {}
echo "готово: $dest/fur_erp_$stamp.sql.gz"
