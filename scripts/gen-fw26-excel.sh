#!/usr/bin/env bash
# Excel FW26: лист «Данные» + настоящая сводная таблица Excel на листе «Пивот».
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-docs-inventory/reports}"
EXCEL_PIVOT=1 NODE_PATH="${NODE_PATH:-/private/tmp/claude-501/stub/node_modules}" node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/gen-fw26-massiv-xlsx.ts "$OUT"
python3 scripts/add-excel-pivot.py "$OUT/FW26_массив_$(date +%F).xlsx"
