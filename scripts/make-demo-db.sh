#!/bin/sh
# Создаёт обезличенную демо-базу из КОПИИ базы и кладёт дамп для переноса на хостинг.
#   sh scripts/make-demo-db.sh [база-источник, по умолчанию fur_erp_sec] [база-демо, по умолчанию fur_erp_demo]
# Деньги в демо НАСТОЯЩИЕ (коэффициент 1). Чтобы скрыть масштаб: DEMO_MONEY_SCALE=N (целое 2…9) перед командой.
# Источник — копия (НЕ боевая fur_erp). Скрипт ничего не пишет в источник и в боевую базу.
# Требуется: Docker с контейнером БД (CONTAINER, по умолчанию fur-erp-db-1) и файл .env или .env.local с DATABASE_URL (используется только пароль/хост).
set -eu
SRC="${1:-fur_erp_sec}"
DEMO="${2:-fur_erp_demo}"
CONTAINER="${CONTAINER:-fur-erp-db-1}"
case "$DEMO" in *_demo) ;; *) echo "Имя демо-базы должно оканчиваться на _demo"; exit 2;; esac
[ "$SRC" != "fur_erp" ] || { echo "Источником должна быть копия, а не боевая fur_erp: сначала сделайте копию (docs/DEPLOY.md)"; exit 2; }
ENVFILE=.env; [ -f .env.local ] && ENVFILE=.env.local
BASEURL=$(grep -E '^DATABASE_URL=' "$ENVFILE" | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//; s#/[^/?]+(\?.*)?$##')
OUT="$HOME/Backups/fur-erp/demo"
mkdir -p "$OUT"; chmod 700 "$HOME/Backups/fur-erp" 2>/dev/null || true

echo "== 1/4 Копия $SRC → $DEMO"
docker exec "$CONTAINER" psql -U fur_erp -d postgres -qc "drop database if exists $DEMO" -c "create database $DEMO"
docker exec "$CONTAINER" pg_dump -U fur_erp "$SRC" | docker exec -i "$CONTAINER" psql -U fur_erp -d "$DEMO" -q -v ON_ERROR_STOP=1 >/dev/null

echo "== 2/4 Обезличивание"
DATABASE_URL="$BASEURL/$DEMO" npx tsx scripts/make-demo-db.ts

echo "== 3/4 Дамп для переноса на хостинг"
STAMP=$(date +%Y%m%d_%H%M%S)
docker exec "$CONTAINER" pg_dump -U fur_erp --no-owner "$DEMO" | gzip > "$OUT/fur_erp_demo_$STAMP.sql.gz"
tar czf "$OUT/demo_uploads_$STAMP.tgz" -C "$OUT/uploads" .
chmod 600 "$OUT"/*.gz "$OUT"/*.tgz
chmod 700 "$OUT/uploads"

echo "== 4/4 Готово"
ls -la "$OUT" | tail -5
echo "Логины демо-пользователей: $HOME/Backups/fur-erp/demo-logins.txt (права 600)"
