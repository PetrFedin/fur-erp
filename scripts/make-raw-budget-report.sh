#!/usr/bin/env bash
# Excel «Сырьё и бюджет FW27» (лоты, непроизведённые FW26, остаток на конец 2026, план и закупка 2027, расход по ТЗ; формулы и сводные) из текущей базы: docs-inventory/reports/Сырьё_и_бюджет_FW27_<дата>.xlsx (попадает в реестр 12_ОТЧЁТЫ).
#   bash scripts/make-raw-budget-report.sh
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
T() { node --conditions=react-server --env-file=.env node_modules/.bin/tsx "$@"; }
T scripts/export-raw-lots-json.ts "$tmp/lots.json"
T scripts/export-raw-budget-data.ts "$tmp/data.json"
T scripts/export-fur-usage-json.ts "$tmp/usage.json"
mkdir -p docs-inventory/reports
out="docs-inventory/reports/Сырьё_и_бюджет_FW27_$(date +%Y-%m-%d_%H%M).xlsx"
python3 -I scripts/build-raw-budget-xlsx.py "$tmp/lots.json" "$tmp/data.json" "$out" "$tmp/usage.json"
