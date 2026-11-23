# Worker deploys on ss-core

The RQ worker that runs analyses and Author draft checks lives on ss-core, in `/var/lib/docker/secretsource-worker`
(the repo root, unpacked, with its own `.env`). `.github/workflows/deploy-worker.yml` deploys
it on every push to main that touches `backend/`, by running `deploy-worker.sh` as root on
the self-hosted runner there (#412).

## Why it is built this way

The runner runs as `ghrunner`, and it also runs every PR's CI jobs. Giving `ghrunner` Docker
access would let any PR run code as root on the host that holds the production Redis (#338).
So `ghrunner` may run exactly one root-owned script through sudo, and that script:

- takes only a commit SHA from the caller,
- fetches the repo itself, with a read-only deploy key that only root can read,
- refuses any commit that is not on `origin/main`.

A PR job can therefore at most redeploy main. It cannot deploy its own code.

## What a deploy does

1. Unpacks the commit into the worker directory and builds the image. The code is copied
   into the image at build time, so the running worker is not affected yet.
2. Waits up to 45 minutes for the worker to have no job.
3. Copies `secretsource-worker-worker:deployed`, the image the worker last started on, to
   `:pre-<sha>`, then restarts the worker on the new image. The first deploy has no
   `:deployed` yet and says so.
4. Once the worker logs `Listening on analyses`, tags the new image `:deployed` and writes
   `REVISION`. If it does not start within 2 minutes, it puts `:pre-<sha>` back and fails.

To deploy by hand: run the workflow from the Actions tab (Run workflow, branch main), or on
the host run `sudo /usr/local/bin/deploy-worker <sha>`.

To roll back:
`sudo docker tag secretsource-worker-worker:pre-<sha> secretsource-worker-worker:latest`, then
`sudo sh -c "cd /var/lib/docker/secretsource-worker && docker compose up -d --no-deps --no-build worker"`.

### Cloud Run and direct upload retirement

Before switching traffic, confirm whether any clients still use the old Cloud Run gateway or
the Vercel edge proxy that authenticates to it. Verify PDF submission through the replacement
gateway. If the old gateway still issues upload sessions, stop issuing new sessions before
cutover. Keep its upload completion and `POST /analyses/from-upload` claim routes available
until completed uploads have been claimed or affected users have been notified to resubmit;
do not end the drain based only on upload completion or session expiry. If an upload was
interrupted at cutover, ask the user to submit the original PDF again through the replacement
gateway. Before retiring the bucket, copy each PDF referenced by a retained analysis into
`PAPERS_DIR` under its saved file name so completed analyses remain readable after cutover,
confirm the bucket's retention policy, and account for any completed but unclaimed PDFs.

After traffic and uploads have moved, verify that no workloads still depend on each Cloud Run
service and retire the confirmed-unused services first. Only then delete the old project and
region Cloud Scheduler jobs (`gpu-guard-*`, `scale-guard-*`) and Cloud Monitoring alert
policies tied to those retired services, including "GPU Cloud Run service billed
continuously". Check which service account the scheduler jobs used and whether any proxy,
scheduled job, or other workload still uses its credentials or permissions before revoking
them. The repository change does not alter those external resources.

### One-time cleanup after removing `status-bot`

`deploy-worker.sh` only recreates `worker` without `--remove-orphans`, so an existing
`status-bot` container from before its removal stays running with `restart: unless-stopped`.
After rolling out this change, verify the container identity and remove only that container:

```bash
sudo docker ps -a \
  --filter "label=com.docker.compose.project=secretsource-worker" \
  --filter "label=com.docker.compose.service=status-bot"
sudo docker rm -f secretsource-worker-status-bot-1
```

## Install

Done once, as a user with sudo on ss-core. Do it again for step 3 whenever `deploy-worker.sh`
changes: the installed copy is not updated from the repo by itself, so a change to it is
reviewed before it runs as root.

1. Deploy key, readable by root only:
   `sudo ssh-keygen -t ed25519 -N "" -C ss-core-worker-deploy -f /root/.ssh/secretsource_deploy`.
   Add `/root/.ssh/secretsource_deploy.pub` to the repo as a read-only deploy key.
2. GitHub's host key for root: `sudo sh -c 'ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts'`.
   Check the fingerprint against https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints.
3. The script: `sudo install -o root -g root -m 755 deploy/ss-core/deploy-worker.sh /usr/local/bin/deploy-worker`.
4. The sudoers line, checked before it takes effect:
   `echo 'ghrunner ALL=(root) NOPASSWD: /usr/local/bin/deploy-worker' | sudo tee /etc/sudoers.d/deploy-worker`,
   then `sudo chmod 440 /etc/sudoers.d/deploy-worker && sudo visudo -c`.
