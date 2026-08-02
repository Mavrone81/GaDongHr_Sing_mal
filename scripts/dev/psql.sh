#!/usr/bin/env bash
#
# psql against the local hrms-postgres container.
#
#   scripts/dev/psql.sh hrms_auth -c 'SELECT * FROM tenants;'
#   scripts/dev/psql.sh hrms_auth < some-file.sql
#   scripts/dev/psql.sh hrms_auth <<'SQL'
#   SELECT 1;
#   SQL
#
# WHY THIS EXISTS: `docker exec` without -i does not attach stdin. A heredoc
# piped into it is silently discarded — psql exits 0 having executed nothing,
# so the command *looks* like it succeeded and you debug the wrong thing. This
# wrapper always passes -i, and sets ON_ERROR_STOP so a failing statement is a
# non-zero exit rather than a warning buried in output.
set -euo pipefail

CONTAINER="${HRMS_PG_CONTAINER:-hrms-postgres}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "error: container '$CONTAINER' is not running." >&2
  echo "hint:  docker compose up -d postgres" >&2
  exit 1
fi

DB="${1:-postgres}"
[ $# -gt 0 ] && shift

exec docker exec -i "$CONTAINER" \
  psql -U "${POSTGRES_USER:-hrms}" -d "$DB" -v ON_ERROR_STOP=1 "$@"
