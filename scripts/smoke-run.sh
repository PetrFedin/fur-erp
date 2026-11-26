#!/usr/bin/env bash
# Сквозная проверка собранного сервера на заготовке (обезличенная база демо + витрина), без живой базы и файлов владельца:
#   1) база fur_erp_smoke_test из deploy/demo/demo.sql.gz, витрина собирается текущим кодом;
#   2) `next start` (боевой режим, нужна готовая сборка `npm run build`) на порту SMOKE_PORT;
#   3) scripts/test-smoke.ts (все страницы разделов у владельца) и scripts/test-security.ts (периметр ролей, заголовки, вход);
#   4) сервер останавливается, база удаляется.
#   bash scripts/smoke-run.sh
# Переменные — как у run-all-tests.sh: DB_CONTAINER (fur-erp-db-1; «none» — psql на этой машине, как в CI), DB_USER, DB_PASSWORD,
#   DB_HOST_PORT, PGHOST; SMOKE_PORT (3301).
set -u
cd "$(dirname "$0")/.."
C="${DB_CONTAINER:-fur-erp-db-1}"; U="${DB_USER:-fur_erp}"; PORT="${DB_HOST_PORT:-5436}"; APP="${SMOKE_PORT:-3301}"
DB="fur_erp_smoke_test"
if [[ "$C" == none ]]; then
  export PGPASSWORD="${DB_PASSWORD:-$U}"
  psqld() { local d="$1"; shift; psql -h "${PGHOST:-127.0.0.1}" -p "$PORT" -U "$U" -d "$d" "$@"; }
else
  psqld() { local d="$1"; shift; docker exec -i "$C" psql -U "$U" -d "$d" "$@"; }
fi
[[ -f .next/BUILD_ID ]] || { echo "нет сборки: сначала npm run build"; exit 2; }
ENVFILE=""; [[ -f .env ]] && ENVFILE="--env-file=.env"
URL="postgresql://$U:${DB_PASSWORD:-$U}@${PGHOST:-localhost}:$PORT/$DB"
SRV=""
cleanup() {
  [[ -n "$SRV" ]] && kill "$SRV" 2>/dev/null && wait "$SRV" 2>/dev/null
  psqld postgres -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
}
trap cleanup EXIT

psqld postgres -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
psqld postgres -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB" || exit 2
gunzip -c deploy/demo/demo.sql.gz | grep -v '^\\\(un\)\?restrict ' | psqld "$DB" -q -v ON_ERROR_STOP=1 >/dev/null || { echo "дамп демо не загрузился"; exit 2; }
DATABASE_URL="$URL" node --conditions=react-server $ENVFILE node_modules/.bin/tsx scripts/mart-refresh.ts | head -1

# Сервер: боевой режим, своя база; фоновая пересборка витрины не нужна (витрина уже собрана).
# ALLOW_ROLE_SWITCH=true — как на демо: test-security проверяет изоляцию в режиме «владелец смотрит как поставщик» (ROLE_SWITCH_EXPECT=on).
# Свой случайный секрет: боевой режим отказывается стартовать со слабым AUTH_SECRET (src/lib/security-env.ts), а в CI он нарочно простой.
SECRET=$(openssl rand -base64 48 | tr -d '\n')
LOG="/tmp/smoke-server.$$.log"
env DATABASE_URL="$URL" NODE_ENV=production MART_AUTO_REFRESH=0 ALLOW_ROLE_SWITCH=true AUTH_SECRET="$SECRET" NEXTAUTH_SECRET="$SECRET" AUTH_URL="http://localhost:$APP" NEXTAUTH_URL="http://localhost:$APP" \
  node_modules/.bin/next start -p "$APP" >"$LOG" 2>&1 &
SRV=$!
for _ in $(seq 1 90); do
  curl -s -o /dev/null "http://localhost:$APP/login" && break
  kill -0 "$SRV" 2>/dev/null || { echo "сервер не запустился:"; tail -20 "$LOG"; exit 1; }
  sleep 2
done

FAILS=0
for t in test-smoke test-security; do
  echo "=== $t"
  env DATABASE_URL="$URL" BASE_URL="http://localhost:$APP" node node_modules/.bin/tsx "scripts/$t.ts" || FAILS=$((FAILS+1))
done
if [[ $FAILS -gt 0 ]]; then echo "--- лог сервера (хвост)"; grep -iE "error|ошиб" "$LOG" | tail -20; fi
rm -f "$LOG"
echo "Упало: $FAILS"
[[ $FAILS -eq 0 ]]
