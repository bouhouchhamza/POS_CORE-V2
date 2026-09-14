#!/bin/sh
set -eu
umask 077

archive="${1:-}"
[ -n "$archive" ] && [ -f "$archive" ] || {
  echo "Usage: verify-backup.sh /path/corepos-saas-YYYYMMDDTHHMMSSZ.tar.gz" >&2
  exit 2
}

sha_file="${archive}.sha256"
if [ -f "$sha_file" ]; then
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$sha_file")")
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

tar -xzf "$archive" -C "$tmp"
[ -f "$tmp/MANIFEST.txt" ]
[ -f "$tmp/SHA256SUMS.txt" ]
(
  cd "$tmp"
  sha256sum -c SHA256SUMS.txt
)

count=0
for dump in "$tmp"/databases/*.dump; do
  [ -f "$dump" ] || continue
  pg_restore --list "$dump" >/dev/null
  count=$((count+1))
done
[ "$count" -gt 0 ] || { echo "No database dumps found." >&2; exit 1; }

echo "BACKUP_VERIFY=PASS"
echo "DATABASE_DUMPS=$count"
cat "$tmp/MANIFEST.txt"
