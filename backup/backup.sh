#!/bin/sh
# Dump every database in the hrms-postgres instance (all DBs + roles/globals)
# into one timestamped, gzip-compressed pg_dumpall file, then prune old ones.
#
# Run on a schedule by crond (see entrypoint.sh) and on demand via:
#   docker exec hrms-db-backup /usr/local/bin/backup.sh
set -eu

# crond runs jobs with a minimal env, so the connection settings are sourced
# from a file the entrypoint writes from the container environment.
[ -f /etc/db-backup.env ] && . /etc/db-backup.env

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
ts="$(date -u +%Y%m%d-%H%M%S)"
out="${BACKUP_DIR}/hrms-all-${ts}.sql.gz"
tmp="${out}.tmp"

mkdir -p "${BACKUP_DIR}"
echo "[db-backup] $(date -u +%FT%TZ) starting pg_dumpall (host=${PGHOST} user=${PGUSER}) -> ${out}"

# --clean --if-exists makes the dump safely restorable onto an existing cluster.
# Write to a .tmp first and rename only on success so a partial dump is never
# mistaken for a good backup.
if pg_dumpall --clean --if-exists | gzip -c > "${tmp}"; then
  mv "${tmp}" "${out}"
  size="$(du -h "${out}" | cut -f1)"
  echo "[db-backup] $(date -u +%FT%TZ) OK ${out} (${size})"
else
  rc=$?
  rm -f "${tmp}"
  echo "[db-backup] $(date -u +%FT%TZ) FAILED (pg_dumpall exit ${rc})" >&2
  exit "${rc}"
fi

# Retention: drop local dumps older than RETENTION_DAYS days.
find "${BACKUP_DIR}" -maxdepth 1 -name 'hrms-all-*.sql.gz' -type f -mtime +"${RETENTION_DAYS}" -print -delete \
  | sed 's/^/[db-backup] pruned /' || true

# ── Off-box copy to S3-compatible object storage (optional) ──────────────────
# Enabled when S3_BUCKET is set. Works with any S3-compatible provider:
# AWS S3 (leave S3_ENDPOINT empty), Cloudflare R2, Backblaze B2, DigitalOcean
# Spaces, MinIO, … — set S3_ENDPOINT to the provider's endpoint URL.
# Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION.
upload_rc=0
if [ -n "${S3_BUCKET:-}" ]; then
  ep_arg=""
  [ -n "${S3_ENDPOINT:-}" ] && ep_arg="--endpoint-url ${S3_ENDPOINT}"
  key="s3://${S3_BUCKET}/${S3_PREFIX:-hrms-db-backups}/$(basename "${out}")"
  echo "[db-backup] $(date -u +%FT%TZ) uploading -> ${key}"
  # shellcheck disable=SC2086
  if aws s3 cp "${out}" "${key}" ${ep_arg} --only-show-errors; then
    echo "[db-backup] $(date -u +%FT%TZ) upload OK"
  else
    upload_rc=$?
    echo "[db-backup] $(date -u +%FT%TZ) upload FAILED (aws exit ${upload_rc}) — LOCAL backup is intact at ${out}" >&2
  fi
else
  echo "[db-backup] S3_BUCKET unset — off-box upload disabled (local backup only)"
fi

echo "[db-backup] $(date -u +%FT%TZ) done (retention ${RETENTION_DAYS}d)"
# Surface an upload failure to the exit code so monitoring/cron logs flag it,
# without losing the fact that the local dump already succeeded above.
exit "${upload_rc}"
