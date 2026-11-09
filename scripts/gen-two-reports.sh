#!/usr/bin/env bash
# Два Excel-отчёта: «Отчёт: поставки» и «Отчёт: продажи». В каждом: лист «Данные», лист «Пивот» (настоящая сводная таблица Excel по «Данные») и лист «Отчёт» в оформлении отчёта владельца.
#   bash scripts/gen-two-reports.sh [папка]     (по умолчанию docs-inventory/reports)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-docs-inventory/reports}"; mkdir -p "$OUT"
D=$(date +%F); TMP=$(mktemp -d)
TSX="node --conditions=react-server --env-file=.env node_modules/.bin/tsx"
# Поставки
$TSX scripts/gen-report-supply-xlsx.ts "$OUT/Отчёт_поставки_$D.xlsx"
python3 scripts/add-excel-pivot.py "$OUT/Отчёт_поставки_$D.xlsx"
# Продажи
$TSX scripts/gen-fw26-sales-data-v06.ts "$TMP"
$TSX scripts/build-report-sales-xlsx.ts "$TMP/FW26_массив_$D.xlsx" "$OUT/Отчёт_продажи_$D.xlsx"
python3 scripts/add-excel-pivot.py "$OUT/Отчёт_продажи_$D.xlsx"
rm -rf "$TMP"
# Загрузить файлы в базу: кнопка «Excel» в окнах «Отчёт: продажи / поставки» каталога (отключить: PUBLISH=0)
if [ "${PUBLISH:-1}" = "1" ]; then $TSX scripts/publish-report-xlsx.ts "$OUT/Отчёт_продажи_$D.xlsx" "$OUT/Отчёт_поставки_$D.xlsx"; fi
echo "Готово: $OUT/Отчёт_поставки_$D.xlsx, $OUT/Отчёт_продажи_$D.xlsx"
