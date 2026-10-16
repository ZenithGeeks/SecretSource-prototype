#!/usr/bin/env bash
# Deploy the RQ worker on ss-core from a commit on main (#412).
#
#   sudo /usr/local/bin/deploy-worker <commit-sha>
#
# Run by .github/workflows/deploy-worker.yml on the self-hosted runner, as user ghrunner, through
# one sudoers line. That runner also runs every PR's CI jobs, so this script trusts nothing from
# the caller but the SHA: it fetches the repo itself with a read-only deploy key that only root
# can read, and refuses any commit that is not on origin/main. A PR job can at most redeploy main.
#
# The installed copy is root-owned and is not updated from the repo by itself. After changing this
# file, install it again by hand (see "Install" in deploy/ss-core/README.md).
set -euo pipefail

SHA_ARG="${1:-}"
REPO="git@github.com:ZenithGeeks/SecretSource-prototype.git"
MIRROR=/var/lib/secretsource-deploy/repo.git
WORKER_DIR=/var/lib/docker/secretsource-worker
CONTAINER=secretsource-worker-worker-1
IMAGE=secretsource-worker-worker
KEY=/root/.ssh/secretsource_deploy
WAIT_MINUTES=45 # an analysis takes ~25 min on ss-core's CPU
export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"

say() { echo "deploy-worker: $*"; }
fail() { say "$*" >&2; exit 1; }

[[ $SHA_ARG =~ ^[0-9a-f]{7,40}$ ]] || fail "expected a commit SHA, got '${SHA_ARG}'"
[[ $(id -u) -eq 0 ]] || fail "run with sudo"

# One deploy at a time: a second merge waits here rather than building over the first.
exec 9>/run/lock/deploy-worker.lock
flock 9

if [[ ! -d $MIRROR ]]; then
  git clone --quiet --bare "$REPO" "$MIRROR"
fi
git -C "$MIRROR" fetch --quiet --prune origin '+refs/heads/main:refs/heads/main'
sha=$(git -C "$MIRROR" rev-parse --verify --quiet "${SHA_ARG}^{commit}") || fail "no commit ${SHA_ARG}"
git -C "$MIRROR" merge-base --is-ancestor "$sha" main || fail "${sha:0:7} is not on main"
short=${sha:0:7}

deployed=$(awk '{print $1; exit}' "$WORKER_DIR/REVISION" 2>/dev/null || true)
if [[ $deployed == "$short" ]]; then
  say "$short is already deployed"
  exit 0
fi

# The code is copied into the image at build time, so replacing the files and building do not
# touch the running worker. Only the restart has to wait for it to be idle.
git -C "$MIRROR" archive "$sha" | tar -x -C "$WORKER_DIR"
say "building $short"
(cd "$WORKER_DIR" && docker compose build --quiet worker)

worker_is_idle() {
  docker exec "$CONTAINER" python -c '
import os, sys, redis
from rq import Queue, Worker
r = redis.from_url(os.environ["REDIS_URL"])
busy = any(w.get_current_job_id() for w in Worker.all(connection=r))
sys.exit(1 if busy else 0)'
}
for ((minute = 0; minute < WAIT_MINUTES; minute++)); do
  worker_is_idle && break
  [[ $minute -eq 0 ]] && say "waiting for the running analysis to finish"
  sleep 60
done
worker_is_idle || fail "the worker was busy for ${WAIT_MINUTES} min; $short is built but not running, run again later"

# Tag what the running container uses, not :latest: the build above already moved :latest.
rollback="pre-$short"
docker tag "$(docker inspect --format '{{.Image}}' "$CONTAINER")" "$IMAGE:$rollback"
started=$(date -u +%FT%TZ)
(cd "$WORKER_DIR" && docker compose up -d --no-deps --no-build worker)

# The worker logs this line once its start-up check (backend/app/native.py) has passed.
for _ in $(seq 24); do
  if docker logs --since "$started" "$CONTAINER" 2>&1 | grep -q "Listening on analyses"; then
    echo "$short deployed $started by deploy-worker" > "$WORKER_DIR/REVISION"
    say "$short is running"
    exit 0
  fi
  sleep 5
done

say "$short did not start within 2 min; rolling back to $IMAGE:$rollback" >&2
docker logs --since "$started" "$CONTAINER" 2>&1 | tail -20 >&2
docker tag "$IMAGE:$rollback" "$IMAGE:latest"
(cd "$WORKER_DIR" && docker compose up -d --no-deps --no-build worker)
exit 1
