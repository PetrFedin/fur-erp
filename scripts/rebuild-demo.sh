#!/bin/bash
# ПЕРЕСБОРКА ДЕМО-ДАМПА ОДНОЙ КОМАНДОЙ:  bash scripts/rebuild-demo.sh   (или npm run demo:rebuild)
# Живая БД (fur_erp) только ЧИТАЕТСЯ (pg_dump). Всё остальное — во временных базах fur_erp_rb_*, которые удаляются в конце.
#  1. временная копия живой базы → обезличивание (make-demo-db, деньги НАСТОЯЩИЕ: DEMO_MONEY_SCALE=1) → дамп;
#  2. проверки на второй временной базе, загруженной ИЗ НОВОГО ДАМПА (суммы = исходной копии, вход по паролям, тесты, утечки, патч фото);
#  3. только если всё прошло: старый deploy/demo/demo.sql.gz и demo-logins.txt уходят в ~/Backups/fur-erp/*.bak-<время>, новые ложатся на место.
# Параметры окружения: CONTAINER (fur-erp-db-1), LIVE_DB (fur_erp), DEMO_MONEY_SCALE (1; другое — только для опытов, проверки сумм тогда не сойдутся),
#   KEEP_TMP=1 — не удалять временные базы (для разбора расхождений);
#   REBUILD_PHOTOS=1 — принудительно пересобрать пакет фото (иначе — только если набор артикулов с фото в живой базе изменился).
set -euo pipefail
cd "$(dirname "$0")/.."
CONTAINER="${CONTAINER:-fur-erp-db-1}"
LIVE="${LIVE_DB:-fur_erp}"
export DEMO_MONEY_SCALE="${DEMO_MONEY_SCALE:-1}"
SRC=fur_erp_rb_src; DEMO=fur_erp_rb_demo; CHK=fur_erp_rb_chk
STAMP=$(date +%Y%m%d_%H%M%S)
BK="$HOME/Backups/fur-erp"; OUT="$BK/demo"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/rebuild-demo.XXXXXX")
mkdir -p "$BK" "$OUT"; chmod 700 "$BK" 2>/dev/null || true
ENVFILE=.env; [ -f .env.local ] && ENVFILE=.env.local
BASEURL=$(grep -E '^DATABASE_URL=' "$ENVFILE" | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//; s#/[^/?]+(\?.*)?$##')
pg() { docker exec "$CONTAINER" psql -U fur_erp -d "$1" -X -q -v ON_ERROR_STOP=1 "${@:2}"; }
drop_tmp() { for d in $SRC $DEMO $CHK; do docker exec "$CONTAINER" psql -U fur_erp -d postgres -qc "drop database if exists $d" >/dev/null 2>&1 || true; done; }
cleanup() { if [ "${KEEP_TMP:-0}" = "1" ]; then echo "KEEP_TMP=1: временные базы $SRC $DEMO $CHK и каталог $WORK оставлены (удалите вручную)"; return; fi; drop_tmp; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "ОШИБКА: $*" >&2; echo "Старый дамп и логины НЕ тронуты. Временные базы удаляются." >&2; exit 1; }
run_ts() { # run_ts <база> <скрипт.ts> [аргументы…]  (DATABASE_URL задаём явно: --env-file не перезаписывает уже заданное)
  local db="$1"; shift
  DATABASE_URL="$BASEURL/$db" node --conditions=react-server --env-file="$ENVFILE" node_modules/.bin/tsx "$@"
}

echo "== 1/6 Временные базы из ТЕКУЩЕЙ живой ($LIVE → $SRC)"
drop_tmp
docker exec "$CONTAINER" psql -U fur_erp -d postgres -qc "create database $SRC"
docker exec "$CONTAINER" pg_dump -U fur_erp "$LIVE" | docker exec -i "$CONTAINER" psql -U fur_erp -d "$SRC" -q -v ON_ERROR_STOP=1 >/dev/null

echo "== 2/6 Обезличивание и дамп (коэффициент денег $DEMO_MONEY_SCALE)"
BEFORE=$(ls -t "$OUT"/fur_erp_demo_*.sql.gz 2>/dev/null | head -1 || true)
DEMO_LOGINS_FILE="$WORK/demo-logins.txt" sh scripts/make-demo-db.sh "$SRC" "$DEMO"
DUMP=$(ls -t "$OUT"/fur_erp_demo_*.sql.gz | head -1)
[ -n "$DUMP" ] && [ "$DUMP" != "$BEFORE" ] || fail "новый дамп не появился"
[ -s "$WORK/demo-logins.txt" ] || fail "файл логинов не создан"

echo "== 3/6 Загрузка нового дампа во временную проверочную базу ($CHK) тем же способом, что и demo-start.mjs"
docker exec "$CONTAINER" psql -U fur_erp -d postgres -qc "create database $CHK"
gzip -dc "$DUMP" | grep -vE '^\\(un)?restrict ' | docker exec -i "$CONTAINER" psql -U fur_erp -d "$CHK" -X -q --single-transaction -v ON_ERROR_STOP=1 -o /dev/null || fail "дамп не загрузился"

echo "== 4/6 Проверки"
# (а) суммы: проверочная база = исходная копия, ТОЧНО (JSON без допусков); при коэффициенте ≠ 1 — только справочно
run_ts "$SRC" scripts/check-demo-money.ts > "$WORK/money-src.json"
run_ts "$CHK" scripts/check-demo-money.ts > "$WORK/money-demo.json"
if [ "$DEMO_MONEY_SCALE" = "1" ]; then
  cmp -s "$WORK/money-src.json" "$WORK/money-demo.json" || { diff "$WORK/money-src.json" "$WORK/money-demo.json" | head -20; fail "суммы демо не равны основной системе"; }
  echo "  OK  суммы закупок, оплат, себестоимости, «Куплено мех» и ТЗ 172 равны основной системе (точно)"
else echo "  коэффициент $DEMO_MONEY_SCALE ≠ 1: равенство сумм не проверяется"; fi
grep -E 'furBoughtIncl' "$WORK/money-demo.json" | head -1 | sed 's/^/  /'
node -e 'const j=require(process.argv[1]);console.log("  ТЗ 172 (полная себестоимость):",JSON.stringify(j.tz172&&j.tz172[0]&&j.tz172[0].total))' "$WORK/money-demo.json"
# (б) вход
run_ts "$CHK" scripts/check-demo-logins.ts "$WORK/demo-logins.txt" || fail "вход демо-пользователей не прошёл"
# (в) тесты на проверочной базе (допуски без масштаба)
SC=""; [ "$DEMO_MONEY_SCALE" != "1" ] && SC="$DEMO_MONEY_SCALE"
RECON_TOL_SCALE="$SC" run_ts "$CHK" scripts/test-reconciliation.ts | tail -3 || fail "test-reconciliation"
SYNC_TOL_SCALE="$SC" run_ts "$CHK" scripts/test-supplier-sync.ts | tail -3 || fail "test-supplier-sync"
run_ts "$CHK" scripts/test-demo-sanitize.ts | tail -3 || fail "test-demo-sanitize"
run_ts "$CHK" scripts/test-no-external-refs.ts | tail -3 || fail "test-no-external-refs"
# (г) нет реальных названий, ИНН, имён, MVST, Drive/Google; в шапке «THE FUR» без «Демо»
{
  pg "$SRC" -Atc "select name from \"Supplier\" union select name from \"Client\" union select inn from \"Supplier\" where inn is not null union select inn from \"Client\" where inn is not null union select name from \"User\" union select email from \"User\"" | awk 'length($0)>=5'
  printf '%s\n' MVST mvst Вельмакин Павлов Коношенко Желнин Киржнер "Google" "drive.google"
} | grep -v -x -E 'Демо.*|.*@demo\.local|Веллмех-демо.*' | sort -u > "$WORK/needles.txt"
gzip -dc "$DUMP" > "$WORK/dump.sql"
LEAK=$(grep -i -F -f "$WORK/needles.txt" "$WORK/dump.sql" | grep -v -E '^(COPY|--)' | cut -c1-120 | head -5 || true)
[ -z "$LEAK" ] || { echo "$LEAK"; fail "в дампе остались реальные названия/ИНН/имена"; }
echo "  OK  в дампе нет реальных названий контрагентов, ИНН, имён, MVST, Google/Drive ($(wc -l < "$WORK/needles.txt" | tr -d ' ') образцов)"
ORG=$(pg "$CHK" -Atc 'select name from "Organization" order by "createdAt" limit 1')
[ "$ORG" = "THE FUR" ] || fail "название организации «$ORG», ожидалось «THE FUR»"
echo "  OK  в шапке: $ORG"
# (д) согласованность с demo-start.mjs: миграции и патч фото
MIG=$(ls -d prisma/migrations/*/ | wc -l | tr -d ' ')
DONE=$(pg "$CHK" -Atc 'select count(*) from "_prisma_migrations" where finished_at is not null and rolled_back_at is null')
if [ "$MIG" = "$DONE" ]; then echo "  OK  схема в дампе актуальна ($DONE из $MIG миграций)"; else echo "  ВНИМАНИЕ: в дампе $DONE из $MIG миграций — demo-start.mjs доедет их сам (prisma migrate deploy)"; fi

echo "== 5/6 Фото артикулов"
PATCH=deploy/demo/article-photos-patch.sql
pg "$LIVE" -Atc "select substr(key,16) from \"SystemState\" where key like 'article-photos:%' order by 1" > "$WORK/live-photo-ids.txt"
{ grep -o "'article-photos:[a-z0-9]*'" "$PATCH" | tr -d "'" | sed 's/^article-photos://' | sort -u; } > "$WORK/patch-photo-ids.txt" || true
if [ "${REBUILD_PHOTOS:-0}" = "1" ] || ! cmp -s "$WORK/live-photo-ids.txt" "$WORK/patch-photo-ids.txt"; then
  echo "  набор артикулов с фото изменился (или REBUILD_PHOTOS=1): пересобираю пакет фото (живая база и uploads только читаются)"
  node --env-file="$ENVFILE" node_modules/.bin/tsx scripts/build-demo-photos.ts || fail "build-demo-photos"
else echo "  OK  артикулы с фото не менялись ($(wc -l < "$WORK/live-photo-ids.txt" | tr -d ' ')): пакет и патч оставлены как есть"; fi
# патч применяется к проверочной базе дважды (идемпотентность), как это сделает demo-start.mjs при каждом старте
for i in 1 2; do docker exec -i "$CONTAINER" psql -U fur_erp -d "$CHK" -X -q -v ON_ERROR_STOP=1 -o /dev/null < "$PATCH" || fail "патч фото не применился (проход $i)"; done
NP=$(pg "$CHK" -Atc "select count(*) from \"SystemState\" where key like 'article-photos:%'")
echo "  OK  патч фото применяется дважды без ошибок: артикулов с фото в проверочной базе $NP"

echo "== 6/6 Установка"
SZ=$(stat -f%z "$DUMP" 2>/dev/null || stat -c%s "$DUMP")
[ "$SZ" -gt 100000 ] || fail "дамп подозрительно мал ($SZ байт)"
if [ -f deploy/demo/demo.sql.gz ]; then cp -p deploy/demo/demo.sql.gz "$BK/demo.sql.gz.bak-$STAMP"; fi
cp "$DUMP" deploy/demo/demo.sql.gz
if [ -f "$BK/demo-logins.txt" ]; then cp -p "$BK/demo-logins.txt" "$BK/demo-logins.txt.bak-$STAMP"; fi
cp "$WORK/demo-logins.txt" "$BK/demo-logins.txt"; chmod 600 "$BK/demo-logins.txt"
HASH=$(shasum -a 256 deploy/demo/demo.sql.gz | cut -d' ' -f1)
echo
echo "Готово. deploy/demo/demo.sql.gz: $(ls -l deploy/demo/demo.sql.gz | awk '{print $5}') байт, sha256 $HASH"
echo "Старый дамп: $BK/demo.sql.gz.bak-$STAMP; старые логины: $BK/demo-logins.txt.bak-$STAMP"
echo "Логины (полный список — в $BK/demo-logins.txt):"
for e in owner@demo.local wellmekh@demo.local; do
  awk -v e="$e" '$1=="email:"&&$2==e{f=1;next} f&&$1=="пароль:"{print "  " e "  " $2; exit}' "$BK/demo-logins.txt"
done
echo "Дальше: git add deploy/demo && git commit && git push; на Render — только по вашему решению."
