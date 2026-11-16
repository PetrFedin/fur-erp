#!/usr/bin/env bash
# Recovery admission — restore a validated historical dump to a NEW scratch
# database. NEVER alters fur_erp, the source dump, or Docker volume.
# Usage: bash scripts/restore-scratch-from-backup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="${FUR_RESTORE_ARCHIVE:-$HOME/Backups/fur-erp/fur_erp_20261028_194227.sql.gz}"
CONTEXT="${FUR_DOCKER_CONTEXT:-desktop-linux}"
CONTAINER="${FUR_DB_CONTAINER:-fur-erp-db-1}"
DB_USER="${FUR_DB_USER:-fur_erp}"
DB_NAME="fur_erp_recovery_20261028_$(date +%Y%m%d_%H%M%S)_$$"

[[ -f "$ARCHIVE" ]] || { echo "Archive missing: $ARCHIVE" >&2; exit 2; }
command -v gzip >/dev/null
command -v docker >/dev/null
echo "Checking archive integrity (read-only)..."
gzip -t "$ARCHIVE"

# Verify the existing container uses the established data volume. Unlike
# docker compose, this script never creates or replaces containers/volumes.
MOUNTS="$(docker --context "$CONTEXT" inspect -f '{{range .Mounts}}{{println .Name .Destination}}{{end}}' "$CONTAINER")"
grep -Fxq 'fur-erp_fur_erp_db_data /var/lib/postgresql/data' <<< "$MOUNTS" || {
  echo "Unexpected volume. Refusing to proceed." >&2; exit 3;
}
docker --context "$CONTEXT" exec "$CONTAINER" pg_isready -U "$DB_USER" -d fur_erp >/dev/null || {
  echo "Existing PostgreSQL is not ready" >&2; exit 4;
}
echo "Creating isolated scratch DB: $DB_NAME"
docker --context "$CONTEXT" exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE \"$DB_NAME\""

echo "Restoring into SCRATCH database (originals remain unchanged)..."
# Pipefail ensures either decompression or PostgreSQL errors stop this step.
gzip -dc "$ARCHIVE" | docker --context "$CONTEXT" exec -i "$CONTAINER" \
  psql -X -q -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" >/dev/null

echo "Verifying recovered dataset..."
docker --context "$CONTEXT" exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -c '
SELECT
  (SELECT count(*) FROM "Organization") AS organizations,
  (SELECT count(*) FROM "Purchase") AS purchases,
  (SELECT count(*) FROM "ProductionOrder") AS production_orders,
  (SELECT count(*) FROM "SalesReceiptLine") AS sales_lines,
  (SELECT count(*) FROM "BudgetScenario") AS budgets,
  (SELECT count(*) FROM "BudgetScenario" WHERE
    jsonb_typeof(lines) = '\''array'\'' AND
    jsonb_array_length(lines) > 0) AS budgets_with_rows,
  (SELECT count(*) FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS completed_migrations;'

echo "Original DB: fur_erp (unchanged)"
echo "Scratch DB:  $DB_NAME"
echo "Do not import scratch into live automatically. Compare PKs/updates and review the result."
