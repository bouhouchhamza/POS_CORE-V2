#!/bin/sh
set -eu
umask 077

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
day="$(date -u +%u)"
month_day="$(date -u +%d)"
root="/backups/snapshot-${stamp}"
archive="/backups/corepos-saas-${stamp}.tar.gz"
archive_sha="${archive}.sha256"
control_db="${CONTROL_PLANE_DB:-${PGDATABASE}}"

cleanup() { rm -rf "$root"; }
trap cleanup EXIT INT TERM
mkdir -p "$root/databases"

# Never allow shell/database option injection through a registry value.
safe_db_name() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$'
}

backup_db() {
  db="$1"
  label="$2"
  safe_db_name "$db" || { echo "Unsafe database name in tenant registry: $db" >&2; exit 1; }
  out="$root/databases/${label}.dump"
  echo "Backing up database: $db"
  pg_dump --dbname="$db" --format=custom --compress=9 --no-owner --no-acl --file="$out"
  pg_restore --list "$out" >/dev/null
}

backup_db "$control_db" "control-plane"

# One operational database per active/non-closed SaaS tenant. The registry is
# read from the control plane only; client-supplied names are never used here.
psql --dbname="$control_db" -Atq \
  -c "select database_name from saas_tenants where status <> 'closed' order by database_name" \
  > "$root/tenant-databases.txt"

while IFS= read -r tenant_db; do
  [ -n "$tenant_db" ] || continue
  backup_db "$tenant_db" "tenant-${tenant_db}"
done < "$root/tenant-databases.txt"

# Tenant uploads are already isolated under /uploads/tenants/<tenant-slug>.
# Store one archive in the same snapshot so DB + files travel together.
tar -czf "$root/uploads.tar.gz" -C /uploads .

(
  cd "$root"
  find databases -type f -name '*.dump' -print | sort | xargs sha256sum > SHA256SUMS.txt
  sha256sum uploads.tar.gz >> SHA256SUMS.txt
)

cat > "$root/MANIFEST.txt" <<EOF
CORE_POS_SAAS_BACKUP_V1
created_at_utc=${stamp}
control_plane_database=${control_db}
tenant_count=$(grep -c . "$root/tenant-databases.txt" || true)
EOF

# Bundle a complete recoverable snapshot; no plaintext DB passwords are stored.
tar -czf "$archive" -C "$root" .
sha256sum "$archive" > "$archive_sha"

test -n "${BACKUP_S3_URI:-}" || {
  echo "BACKUP_S3_URI is required for production off-site backups." >&2
  exit 1
}

upload_copy() {
  tier="$1"
  aws s3 cp "$archive" "$BACKUP_S3_URI/$tier/$(basename "$archive")" --only-show-errors
  aws s3 cp "$archive_sha" "$BACKUP_S3_URI/$tier/$(basename "$archive_sha")" --only-show-errors
}

upload_copy daily
[ "$day" = 7 ] && upload_copy weekly
[ "$month_day" = 01 ] && upload_copy monthly

prune_tier() {
  tier="$1"
  keep="$2"
  aws s3 ls "$BACKUP_S3_URI/$tier/" \
    | awk '$4 ~ /^corepos-saas-[0-9]{8}T[0-9]{6}Z\.tar\.gz$/ {print $4}' \
    | sort -r \
    | awk -v keep="$keep" 'NR>keep' \
    | while IFS= read -r key; do
        [ -n "$key" ] || continue
        aws s3 rm "$BACKUP_S3_URI/$tier/$key" --only-show-errors
        aws s3 rm "$BACKUP_S3_URI/$tier/$key.sha256" --only-show-errors || true
      done
}

prune_tier daily 7
prune_tier weekly 4
prune_tier monthly 12

# Staging is not the disaster-recovery copy; off-site S3 is. Keep two days
# locally for diagnostics and avoid unbounded disk growth.
find /backups -maxdepth 1 -type f -name 'corepos-saas-*.tar.gz*' -mtime +2 -delete

echo "BACKUP_RESULT=PASS"
echo "BACKUP_ARCHIVE=$(basename "$archive")"
echo "TENANT_COUNT=$(grep -c . "$root/tenant-databases.txt" || true)"
