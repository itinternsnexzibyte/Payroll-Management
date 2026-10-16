#!/bin/sh
# Applies pending migrations (forward-only) before starting the API when RUN_MIGRATIONS=true.
set -e
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Applying database migrations..."
  node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
fi
exec "$@"
