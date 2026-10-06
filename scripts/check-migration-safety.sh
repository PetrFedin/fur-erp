#!/bin/sh
# Проверка новых миграций базы на разрушающие операции (удаление таблиц/колонок, смена типа, NOT NULL без значения).
#   sh scripts/check-migration-safety.sh            — только миграции новее базовой (scripts/.migration-baseline)
#   sh scripts/check-migration-safety.sh --all      — все миграции
#   sh scripts/check-migration-safety.sh папка...   — перечисленные папки миграций
# Код выхода 1 — найдено опасное: ПЕРЕД обновлением сделайте копию (sh deploy/backup.sh) и прочитайте миграцию вручную.
set -e
cd "$(dirname "$0")/.."
MIG=prisma/migrations
BASE_FILE=scripts/.migration-baseline
PATTERN='DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|DROP[[:space:]]+TYPE|TRUNCATE|DELETE[[:space:]]+FROM|ALTER[[:space:]]+COLUMN[^;]*[[:space:]]TYPE|SET[[:space:]]+NOT[[:space:]]+NULL|RENAME[[:space:]]+(COLUMN|TO)|will be lost|required column|cannot be cast'

if [ "$1" = "--all" ]; then
  LIST=$(ls -1 "$MIG" | grep -E '^[0-9]{14}_')
elif [ $# -gt 0 ]; then
  LIST=$(for d in "$@"; do basename "$d"; done)
else
  BASE=$(cat "$BASE_FILE" 2>/dev/null || echo 0)
  LIST=$(ls -1 "$MIG" | grep -E '^[0-9]{14}_' | awk -v b="$BASE" '{ if (substr($0,1,14) > b) print }')
fi

[ -n "$LIST" ] || { echo "Новых миграций нет — проверять нечего."; exit 0; }

BAD=0
for m in $LIST; do
  f="$MIG/$m/migration.sql"
  [ -f "$f" ] || continue
  HITS=$(grep -nEi "$PATTERN" "$f" || true)
  if [ -n "$HITS" ]; then
    BAD=1
    echo "ОПАСНО: требуется бэкап и ручная проверка — $m"
    echo "$HITS" | sed 's/^/    /' | cut -c1-200
  else
    echo "ок: $m"
  fi
done

if [ "$BAD" = 1 ]; then
  echo
  echo "Что делать: sh deploy/backup.sh (на сервере) или scripts/backup.sh (на ноутбуке), затем прочитать указанные миграции."
  exit 1
fi
echo "Разрушающих операций не найдено."
