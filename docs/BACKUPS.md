# PostgreSQL Server Backup & Disaster Recovery Guide

**Database:** PostgreSQL 14+  
**Target Application:** Anonymous Audio Calling App  
**Document Location:** `docs/BACKUPS.md`  

---

## 1. Backup Strategy Overview

To safeguard user accounts, transaction ledgers, subscription status, and audit logs while preventing data loss, the production database relies on a multi-tiered backup strategy:

1. **Daily Automated Full Backups (`pg_dump`):** Custom archive format (`-Fc`) generated every night at off-peak hours (02:00 UTC).
2. **Local Retention Rotation:** Retain 7 daily snapshots on the local database host disk.
3. **Offsite Cloud Archival:** Synchronize snapshots daily to an encrypted, access-restricted cloud object store (AWS S3 with Lifecycle Rules or Google Cloud Storage).
4. **Point-In-Time Recovery (Optional High-Availability):** Continuous Write-Ahead Log (WAL) archiving via `pgBackRest` or `wal-g` for high-throughput production clusters.

---

## 2. Secure Authentication (`.pgpass`)

Never hardcode database passwords in shell commands, script arguments, or crontab definitions. PostgreSQL natively supports credentials stored in `~/.pgpass`.

### Setup Instructions (on the server host):
```bash
# 1. Open or create the .pgpass file for the postgres or app user
nano ~/.pgpass

# 2. Add the connection record in hostname:port:database:username:password format:
localhost:5432:anonymous_calling_db:app_user:YourStrongPasswordHere

# 3. Enforce strict Unix permissions (PostgreSQL refuses to read .pgpass if permissions are open)
chmod 0600 ~/.pgpass
```

---

## 3. The `pg_dump` Command

The core command produces a compressed, flexible custom format backup (`-Fc`), enabling parallel restoration, schema selection, and table-level recovery:

```bash
pg_dump \
  -h localhost \
  -p 5432 \
  -U app_user \
  -d anonymous_calling_db \
  -Fc \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -f "/var/backups/postgres/anon_audio_$(date +%Y%m%d_%H%M%S).dump"
```

### Flag Explanations:
- `-Fc` (Format: Custom): Emits PostgreSQL's proprietary compressed binary format. It is significantly faster to restore than plain SQL and supports selective table extraction.
- `--clean`: Emits SQL commands to clean (drop) database objects prior to creating them.
- `--if-exists`: Uses conditional `DROP ... IF EXISTS` to prevent errors during restoration into an empty database.
- `--no-owner`: Prevents dump from outputting commands to set ownership of objects, allowing seamless restoration to different database users/roles.
- `--no-privileges`: Omits access privileges (`GRANT`/`REVOKE`) commands.

---

## 4. Automated Backup Script

Save the following automated script to `/usr/local/bin/backup_postgres.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Configuration
BACKUP_DIR="/var/backups/postgres"
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="${DATABASE_NAME:-anonymous_calling_db}"
DB_USER="${DATABASE_USER:-app_user}"
RETENTION_DAYS=7
TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.dump"
LOG_TAG="POSTGRES_BACKUP"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

logger -t "${LOG_TAG}" "Starting PostgreSQL backup for database '${DB_NAME}'..."

# Execute pg_dump
if pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  -Fc \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -f "${BACKUP_FILE}"; then

  FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  logger -t "${LOG_TAG}" "Backup completed successfully: ${BACKUP_FILE} (Size: ${FILE_SIZE})"
else
  logger -t "${LOG_TAG}" "ERROR: pg_dump failed!"
  exit 1
fi

# Local Retention Policy: Prune backups older than RETENTION_DAYS
logger -t "${LOG_TAG}" "Pruning local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "${DB_NAME}_*.dump" -type f -mtime +"${RETENTION_DAYS}" -delete

# Cloud Sync (AWS S3 Example - optional)
if command -v aws >/dev/null 2>&1 && [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  logger -t "${LOG_TAG}" "Syncing backups to AWS S3: ${BACKUP_S3_BUCKET}..."
  aws s3 sync "${BACKUP_DIR}" "s3://${BACKUP_S3_BUCKET}/postgres/" --delete
fi

# Cloud Sync (GCS Example - optional)
if command -v gcloud >/dev/null 2>&1 && [ -n "${BACKUP_GCS_BUCKET:-}" ]; then
  logger -t "${LOG_TAG}" "Syncing backups to GCS: ${BACKUP_GCS_BUCKET}..."
  gcloud storage rsync "${BACKUP_DIR}" "gs://${BACKUP_GCS_BUCKET}/postgres/" --delete
fi

logger -t "${LOG_TAG}" "PostgreSQL backup workflow completed."
```

### Make Executable:
```bash
chmod +x /usr/local/bin/backup_postgres.sh
```

---

## 5. Server Cron Schedule

Configure the scheduled task using `crontab -e` (for the user owning the `.pgpass` file) or place in `/etc/cron.d/postgres_backup`:

```cron
# Daily database backup at 02:00 AM UTC
0 2 * * * /usr/local/bin/backup_postgres.sh >> /var/log/postgres_backup.log 2>&1
```

---

## 6. Restoration & Verification Procedure

Test restoration periodically on a staging/sandbox database to ensure dump integrity:

### 1. Create Temporary Restoration Database:
```bash
createdb -h localhost -p 5432 -U app_user anon_audio_staging
```

### 2. Run `pg_restore`:
```bash
pg_restore \
  -h localhost \
  -p 5432 \
  -U app_user \
  -d anon_audio_staging \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -v \
  /var/backups/postgres/anon_audio_20261122_020000.dump
```

### 3. Verify Integrity & Data Counts:
```bash
psql -h localhost -U app_user -d anon_audio_staging -c "
  SELECT 
    (SELECT count(*) FROM users) as users_count,
    (SELECT count(*) FROM call_sessions) as calls_count,
    (SELECT count(*) FROM wallet_transactions) as tx_count,
    (SELECT count(*) FROM _migrations) as migrations_count;
"
```

### 4. Cleanup Staging Database:
```bash
dropdb -h localhost -p 5432 -U app_user anon_audio_staging
```
