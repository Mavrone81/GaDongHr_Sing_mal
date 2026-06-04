#!/bin/sh
# Entrypoint for the hrms-db-backup container.
#
# Persists the DB connection settings (crond jobs get a minimal environment,
# so backup.sh sources them from this file), installs the crontab, and runs
# crond in the foreground. The container stays in UTC; the default schedule
# 0 19 * * * is 19:00 UTC = 03:00 SGT (Asia/Singapore, fixed UTC+8, no DST).
set -eu

BACKUP_CRON="${BACKUP_CRON:-0 19 * * *}"

cat > /etc/db-backup.env <<EOF
export PGHOST='${PGHOST:-postgres}'
export PGPORT='${PGPORT:-5432}'
export PGUSER='${PGUSER:-hrms}'
export PGPASSWORD='${PGPASSWORD:-}'
export PGDATABASE='${PGDATABASE:-postgres}'
export BACKUP_DIR='${BACKUP_DIR:-/backups}'
export BACKUP_RETENTION_DAYS='${BACKUP_RETENTION_DAYS:-14}'
export S3_BUCKET='${S3_BUCKET:-}'
export S3_PREFIX='${S3_PREFIX:-hrms-db-backups}'
export S3_ENDPOINT='${S3_ENDPOINT:-}'
export AWS_ACCESS_KEY_ID='${AWS_ACCESS_KEY_ID:-}'
export AWS_SECRET_ACCESS_KEY='${AWS_SECRET_ACCESS_KEY:-}'
export AWS_DEFAULT_REGION='${AWS_DEFAULT_REGION:-auto}'
EOF
chmod 600 /etc/db-backup.env

mkdir -p /backups
# busybox crond reads /etc/crontabs/root; append output to a log we can tail.
echo "${BACKUP_CRON} /usr/local/bin/backup.sh >> /backups/backup.log 2>&1" > /etc/crontabs/root

echo "[db-backup] scheduled '${BACKUP_CRON}' (container TZ=UTC; 0 19 * * * = 03:00 SGT)"
echo "[db-backup] backups -> /backups, log -> /backups/backup.log"
if [ -n "${S3_BUCKET:-}" ]; then
  echo "[db-backup] off-box upload ENABLED -> s3://${S3_BUCKET}/${S3_PREFIX:-hrms-db-backups}/ (endpoint: ${S3_ENDPOINT:-AWS})"
else
  echo "[db-backup] off-box upload DISABLED (S3_BUCKET unset) — local backups only"
fi
echo "[db-backup] manual run: docker exec hrms-db-backup /usr/local/bin/backup.sh"

# -f foreground, -l 8 log level to container stdout.
exec crond -f -l 8
