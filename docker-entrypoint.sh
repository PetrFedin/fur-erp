#!/bin/sh
set -e

echo "Applying database migrations..."
npx --no-install prisma migrate deploy

echo "Starting server..."
exec node server.js
