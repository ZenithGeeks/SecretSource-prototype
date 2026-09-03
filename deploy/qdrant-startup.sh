#! /bin/bash
# Formats the data disk on first boot, mounts it, runs qdrant. COS ships docker.
set -e
DISK=/dev/disk/by-id/google-qdrant-data
MNT=/mnt/disks/qdrant
if ! blkid "$DISK" >/dev/null 2>&1; then
  mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DISK"
fi
mkdir -p "$MNT"
mountpoint -q "$MNT" || mount -o discard,defaults "$DISK" "$MNT"
KEY=$(curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/qdrant-api-key")
docker rm -f qdrant 2>/dev/null || true
docker run -d --name qdrant --restart always -p 6333:6333 \
  -v "$MNT":/qdrant/storage -e QDRANT__SERVICE__API_KEY="$KEY" \
  qdrant/qdrant:v1.13.4
