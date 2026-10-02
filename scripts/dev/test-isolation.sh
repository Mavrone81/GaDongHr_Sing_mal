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
  # Enumerate every service that actually carries a DB-backed suite, rather than
  # naming five. The hardcoded list silently stranded five services' worth of
  # tenant-isolation suites: excluded from test:backend because they need a
  # database, and never reached here because they were not in the list. A list
  # cannot notice the next service to grow one.
  mapfile -t SERVICES < <(
    git ls-files -- 'services/*/__tests__/*' \
      | grep -E '(tenant-isolation|db-contract|tenant-unique)' \
      | sed -E 's#^services/([a-z0-9-]+)-service/.*#\1#' \
      | sort -u
  )
fi
if [ ${#SERVICES[@]} -eq 0 ]; then
  echo "error: no services with DB-backed suites found — refusing to report success" >&2
  exit 1
fi
echo "DB-backed suites found in ${#SERVICES[@]} service(s): ${SERVICES[*]}"

failed=()
for svc in "${SERVICES[@]}"; do
  dir="services/${svc}-service"
  # Runs BOTH DB-backed suites: tenant isolation, and the db-contract tests
  # (real Prisma client + real queries through the route stack — the suites
  # that catch invalid queries the mock-only job answers happily).
  # Any DB-backed suite counts, including the *-tenant-unique.integration
  # convention introduced by the compound-unique work.
  db_suites=$(ls -1 "$dir"/__tests__/ 2>/dev/null \
    | grep -E '(tenant-isolation|db-contract|tenant-unique)' | wc -l)
  if [ "$db_suites" -eq 0 ]; then
    echo "skip ${svc}: no DB-backed suites"; continue
  fi

  db="hrms_${svc}"
  echo ""
  echo "── ${svc}-service → ${db} ─────────────────────────────────────"

  url="postgresql://${PGUSER_VAL}:${PGPASS_VAL}@${PGHOST_VAL}:${PGPORT_VAL}/${db}"

  # Create this service's scratch DB if it does not exist. Previously the five
  # databases were pre-created by the CI workflow, which meant adding a service
  # here also required editing the workflow — and forgetting that is how a
  # service ends up enumerated but unrunnable.
  PGPASSWORD="$PGPASS_VAL" psql -h "$PGHOST_VAL" -p "$PGPORT_VAL" -U "$PGUSER_VAL" -d postgres \
    -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" 2>/dev/null | grep -q 1 \
    || PGPASSWORD="$PGPASS_VAL" psql -h "$PGHOST_VAL" -p "$PGPORT_VAL" -U "$PGUSER_VAL" -d postgres \
         -q -c "CREATE DATABASE ${db};" >/dev/null 2>&1 || true

  # Regenerate for THIS service before running it — the previous iteration left
  # the shared client pointing at a different schema.
  ( cd "$dir" && DATABASE_URL="$url" npx prisma generate --schema prisma/schema.prisma >/dev/null 2>&1 ) \
    || { echo "  generate FAILED"; failed+=("$svc(generate)"); continue; }

  ( cd "$dir" && DATABASE_URL="$url" npx prisma db push --skip-generate --accept-data-loss >/dev/null 2>&1 ) \
    || { echo "  db push FAILED"; failed+=("$svc(push)"); continue; }

  if ( cd "$dir" && DATABASE_URL="$url" npx jest --runInBand "tenant-isolation|db-contract|tenant-unique" 2>&1 | tail -20 ); then
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
