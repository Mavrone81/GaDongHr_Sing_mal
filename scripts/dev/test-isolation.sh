#!/usr/bin/env bash
#
# Cross-tenant isolation tests — DB-backed, one service at a time.
#
#   scripts/dev/test-isolation.sh              # all services
#   scripts/dev/test-isolation.sh payroll      # just one
#
# WHY THIS IS SEPARATE FROM `npm run test:backend`:
#
# These suites need two things the mock-only unit job cannot give them:
#
#   1. A real Postgres. They exercise the Prisma auto-scoping extension against
#      actual rows — that is the whole point, since a mock would prove nothing
#      about whether tenant A can read tenant B's data.
#
#   2. Their OWN generated Prisma client. This is an npm-workspaces repo, so
#      @prisma/client is hoisted to one shared location. `prisma generate` for
#      one service OVERWRITES every other service's client, which is why
#      running all five in a single jest invocation can never work: whichever
#      schema was generated last wins and the other four see undefined models.
#      Docker is unaffected — each image has its own node_modules.
#
# So each service is generated and run in its own pass, sequentially.
#
# Requires: postgres running with the per-service databases created.
#   docker compose up -d postgres
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

env_get() {
  sed -n "s/^$1=//p" "$REPO_ROOT/.env" 2>/dev/null | head -1 | sed -E 's/^"(.*)"$/\1/'
}

PGUSER_VAL="$(env_get POSTGRES_USER)"; PGUSER_VAL="${PGUSER_VAL:-hrms}"
PGPASS_VAL="$(env_get POSTGRES_PASSWORD)"
PGPORT_VAL="$(env_get POSTGRES_PORT)"; PGPORT_VAL="${PGPORT_VAL:-5432}"
PGHOST_VAL="${POSTGRES_HOST:-localhost}"

if [ -z "$PGPASS_VAL" ]; then
  echo "error: POSTGRES_PASSWORD not found in .env" >&2
  exit 1
fi

SERVICES=("${@:-}")
if [ -z "${SERVICES[0]:-}" ]; then
  SERVICES=(auth employee payroll leave attendance)
fi

failed=()
for svc in "${SERVICES[@]}"; do
  dir="services/${svc}-service"
  test_file="$dir/__tests__/tenant-isolation.test.js"
  [ -f "$test_file" ] || { echo "skip ${svc}: no tenant-isolation.test.js"; continue; }

  db="hrms_${svc}"
  echo ""
  echo "── ${svc}-service → ${db} ─────────────────────────────────────"

  url="postgresql://${PGUSER_VAL}:${PGPASS_VAL}@${PGHOST_VAL}:${PGPORT_VAL}/${db}"

  # Regenerate for THIS service before running it — the previous iteration left
  # the shared client pointing at a different schema.
  ( cd "$dir" && DATABASE_URL="$url" npx prisma generate --schema prisma/schema.prisma >/dev/null 2>&1 ) \
    || { echo "  generate FAILED"; failed+=("$svc(generate)"); continue; }

  ( cd "$dir" && DATABASE_URL="$url" npx prisma db push --skip-generate --accept-data-loss >/dev/null 2>&1 ) \
    || { echo "  db push FAILED"; failed+=("$svc(push)"); continue; }

  if ( cd "$dir" && DATABASE_URL="$url" npx jest --runInBand tenant-isolation 2>&1 | tail -20 ); then
    :
  else
    failed+=("$svc")
  fi
done

echo ""
if [ ${#failed[@]} -eq 0 ]; then
  echo "✅ cross-tenant isolation: all services passed"
  exit 0
fi
echo "❌ cross-tenant isolation FAILED: ${failed[*]}"
exit 1
