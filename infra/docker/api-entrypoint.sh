#!/bin/sh
# Applies pending migrations (forward-only) before starting the API when RUN_MIGRATIONS=true.
set -e
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Applying database migrations..."
  node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
fi
# A freshly mounted persistent disk may be owned by root; payslip PDFs need a writable STORAGE_DIR.
if [ -n "${STORAGE_DIR:-}" ]; then
  mkdir -p "$STORAGE_DIR" 2>/dev/null || true
  if ! touch "$STORAGE_DIR/.write-test" 2>/dev/null; then
    echo "WARNING: STORAGE_DIR ($STORAGE_DIR) is not writable by $(id -un); payslip generation will fail." >&2
  else
    rm -f "$STORAGE_DIR/.write-test"
  fi
fi
exec "$@"
