#!/usr/bin/env bash
# Изолированная среда для сквозных тестов: своя копия боевой базы + свой
# `next start` на своём порту (одна общая боевая сборка .next, только чтение).
#   scripts/e2e.sh up   <имя> <порт>   — создать базу fur_erp_e2e_<имя> из fur_erp и поднять сервер
#   scripts/e2e.sh down <имя>          — остановить сервер и удалить базу
#   scripts/e2e.sh reset <имя> <порт>  — down + up
# Перед первым запуском (и после правок кода) нужна сборка: `npx next build`.
set -euo pipefail
cd "$(dirname "$0")/.."
cmd="${1:?up|down|reset}"; name="${2:?имя}"
db="fur_erp_e2e_${name}"
dir="/tmp/fur-e2e"; mkdir -p "$dir"
pg() { docker exec fur-erp-db-1 psql -q -U fur_erp -d postgres -v ON_ERROR_STOP=1 "$@"; }

down() {
  if [ -f "$dir/$name.pid" ]; then kill "$(cat "$dir/$name.pid")" 2>/dev/null || true; rm -f "$dir/$name.pid"; fi
  pg -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$dir/$name-uploads"
  echo "down: $name"
}
up() {
  port="${1:?порт}"
  [ -d .next ] && [ -f .next/BUILD_ID ] || { echo "нет боевой сборки: запустите npx next build"; exit 1; }
  pg -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" -c "CREATE DATABASE $db" >/dev/null
  docker exec fur-erp-db-1 pg_dump -U fur_erp fur_erp | docker exec -i fur-erp-db-1 psql -q -U fur_erp -d "$db" >/dev/null
  mkdir -p "$dir/$name-uploads"
  UPLOAD_DIR="$dir/$name-uploads" AUTH_TRUST_HOST=true \
  DATABASE_URL="postgresql://fur_erp:fur_erp@localhost:5436/$db" NEXTAUTH_URL="http://localhost:$port" \
    nohup node --env-file=.env node_modules/.bin/next start -p "$port" > "$dir/$name.log" 2>&1 &
  echo $! > "$dir/$name.pid"
  for i in $(seq 1 60); do
    curl -sf -o /dev/null "http://localhost:$port/login" && { echo "up: http://localhost:$port  база=$db  лог=$dir/$name.log"; return; }
    sleep 1
  done
  echo "сервер не поднялся, лог: $dir/$name.log"; tail -20 "$dir/$name.log"; exit 1
}
case "$cmd" in
  up) up "${3:-}" ;;
  down) down ;;
  reset) down; up "${3:-}" ;;
  *) echo "up|down|reset"; exit 1 ;;
esac
