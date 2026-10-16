#!/usr/bin/env bash
# Последовательный прогон всех scripts/test-*.ts. Живую БД только ЧИТАЕМ (pg_dump);
# каждый тест идёт на своей свежей копии (CREATE DATABASE ... TEMPLATE шаблон), в конце всё удаляется.
#   bash scripts/run-all-tests.sh [маска-имени]      например: bash scripts/run-all-tests.sh supplier
# Переменные: DB_CONTAINER (fur-erp-db-1), DB_USER (fur_erp), DB_HOST_PORT (5436), TEST_TIMEOUT (300 с).
# «нужен сервер» — тесты, требующие поднятый сервер или боевую сборку; они не запускаются.
set -u
cd "$(dirname "$0")/.."
C="${DB_CONTAINER:-fur-erp-db-1}"; U="${DB_USER:-fur_erp}"; PORT="${DB_HOST_PORT:-5436}"; TMO="${TEST_TIMEOUT:-300}"
FILTER="${1:-}"
NEEDS_SERVER="test-security test-demo-sanitize"
TPL="fur_erp_runall_tpl_$$"; CUR="fur_erp_runall_cur_$$"
psqlc() { docker exec -i "$C" psql -U "$U" -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
cleanup() { psqlc -c "DROP DATABASE IF EXISTS $TPL" >/dev/null 2>&1; }
trap cleanup EXIT

psqlc -c "CREATE DATABASE $TPL" || exit 2
docker exec "$C" pg_dump -U "$U" -d fur_erp --no-owner | docker exec -i "$C" psql -U "$U" -d "$TPL" -q -v ON_ERROR_STOP=0 >/dev/null 2>&1

RES=(); FAILS=0
for f in scripts/test-*.ts; do
  n=$(basename "$f" .ts)
  [[ -n "$FILTER" && "$n" != *"$FILTER"* ]] && continue
  if [[ " $NEEDS_SERVER " == *" $n "* ]]; then RES+=("$n|нужен сервер|-"); continue; fi
  # имя копии должно содержать слово, которое проверяет защита самого теста
  case "$n" in
    test-audit-log) sfx=audit_test;; test-comments) sfx=comments_test;;
    test-draft-edit|test-editability|test-purchase-receive-parity) sfx=edit_test;;
    test-payment-allocation) sfx=alloc_test;; test-payment-form|test-tz-import|test-tz-multi) sfx=wiz_test;;
    test-shipments) sfx=shipment_test;; test-task-center) sfx=task_test;; *) sfx=scratch;;
  esac
  CUR="fur_erp_${sfx}_runall_$$"
  psqlc -c "DROP DATABASE IF EXISTS $CUR" >/dev/null 2>&1
  psqlc -c "CREATE DATABASE $CUR TEMPLATE $TPL" >/dev/null || { RES+=("$n|упал (нет копии)|-"); FAILS=$((FAILS+1)); continue; }
  URL="postgresql://$U:${DB_PASSWORD:-$U}@localhost:$PORT/$CUR"
  start=$(date +%s)
  env DATABASE_URL="$URL" SCRATCH_URL="$URL" ALLOC_TEST_URL="$URL" AUDIT_TEST_URL="$URL" BATCH_TEST_URL="$URL" \
      COMMENTS_TEST_URL="$URL" EDIT_TEST_URL="$URL" SHIPMENT_TEST_URL="$URL" TASK_TEST_URL="$URL" WIZ_TEST_URL="$URL" \
      perl -e 'alarm shift; exec @ARGV' "$TMO" node --conditions=react-server --env-file=.env node_modules/.bin/tsx "$f" >"/tmp/${n}.$$.log" 2>&1
  code=$?
  psqlc -c "DROP DATABASE IF EXISTS $CUR" >/dev/null 2>&1
  t=$(( $(date +%s) - start ))
  if [[ $code -eq 0 ]]; then RES+=("$n|ок|${t}с"); rm -f "/tmp/${n}.$$.log"
  else RES+=("$n|упал (код $code)|${t}с"); FAILS=$((FAILS+1)); echo "--- $n: хвост вывода (/tmp/${n}.$$.log)"; tail -n 6 "/tmp/${n}.$$.log"; fi
done

echo; echo "Итог:"; printf '%-36s %-20s %s\n' "тест" "результат" "время"
for r in "${RES[@]}"; do IFS='|' read -r a b c <<<"$r"; printf '%-36s %-20s %s\n' "$a" "$b" "$c"; done
echo "Упало: $FAILS"
[[ $FAILS -eq 0 ]]
