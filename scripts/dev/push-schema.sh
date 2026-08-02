#!/usr/bin/env bash
#
# Push one service's Prisma schema to the local database, from the HOST.
#
#   scripts/dev/push-schema.sh auth-service
#   scripts/dev/push-schema.sh statutory-sg-service
#   scripts/dev/push-schema.sh employee-service hrms_employee   # explicit db
#
# WHY THIS EXISTS: the documented route is
# `docker compose exec <svc> npx prisma db push`, which requires building and
# starting that service's container first. Pushing from the host against the
# published Postgres port produces the identical result in a fraction of the
# time — only Postgres needs to be up.
set -euo pipefail

SVC="${1:?usage: scripts/dev/push-schema.sh <service-name> [database]}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEMA="$REPO_ROOT/services/$SVC/prisma/schema.prisma"

[ -f "$SCHEMA" ] || { echo "error: no schema at services/$SVC/prisma/schema.prisma" >&2; exit 1; }

# Read individual values instead of sourcing .env. Even with the quoting fixed,
# sourcing a secrets file into the current shell exports everything in it —
# reading only what is needed keeps the blast radius small.
env_get() {
  sed -n "s/^$1=//p" "$REPO_ROOT/.env" 2>/dev/null | head -1 | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

# auth-service -> hrms_auth ; statutory-sg-service -> hrms_statutory_sg
default_db() { local base="${SVC%-service}"; echo "hrms_${base//-/_}"; }

DB="${2:-$(default_db)}"
PGUSER_VAL="$(env_get POSTGRES_USER)"; PGUSER_VAL="${PGUSER_VAL:-hrms}"
PGPASS_VAL="$(env_get POSTGRES_PASSWORD)"
PGPORT_VAL="$(env_get POSTGRES_PORT)"; PGPORT_VAL="${PGPORT_VAL:-5432}"

if [ -z "$PGPASS_VAL" ]; then
  echo "error: POSTGRES_PASSWORD not found in .env" >&2
  exit 1
fi

echo "pushing services/$SVC schema -> $DB on localhost:$PGPORT_VAL"

cd "$REPO_ROOT/services/$SVC"
DATABASE_URL="postgresql://$PGUSER_VAL:$PGPASS_VAL@localhost:$PGPORT_VAL/$DB" \
  npx prisma db push --skip-generate
