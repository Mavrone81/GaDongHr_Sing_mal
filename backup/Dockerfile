# hrms-db-backup — pg_dumpall (matching server major) + aws-cli for off-box S3 copy.
FROM postgres:16-alpine

# aws-cli works with AWS S3 and any S3-compatible provider (Cloudflare R2,
# Backblaze B2, DigitalOcean Spaces, MinIO, …) via --endpoint-url.
RUN apk add --no-cache aws-cli

COPY backup.sh /usr/local/bin/backup.sh
COPY entrypoint.sh /usr/local/bin/db-backup-entrypoint.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/db-backup-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/db-backup-entrypoint.sh"]
