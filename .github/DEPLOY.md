# Production deploy

The `deploy` job in `.github/workflows/pr-tests.yml` SSHes into the production
host on every push to `main` (after tests + e2e pass), pulls the latest
commit, and runs `docker compose up -d --build` to rebuild only the services
whose layers changed.

## Required GitHub secrets

Add these under **Repo → Settings → Secrets and variables → Actions →
Repository secrets**:

| Name | Value | Notes |
|------|-------|-------|
| `DEPLOY_HOST`    | `157.230.240.163` (or the DNS name) | The production server's reachable address |
| `DEPLOY_USER`    | `root` | SSH login user |
| `DEPLOY_PATH`    | `/root/NEWHRMS` | Absolute path to the repo on the server |
| `DEPLOY_SSH_KEY` | full contents of an OpenSSH private key | See "SSH key setup" below |
| `DEPLOY_PORT`    | `22` (optional) | Override if SSH listens on a non-default port |

## SSH key setup

On your local machine (or any machine you trust):

```bash
# 1. Generate a dedicated deploy key — don't reuse a personal key.
ssh-keygen -t ed25519 -f vorkhive-deploy -N "" -C "github-actions-deploy"

# 2. Copy the PUBLIC key to the production host's authorized_keys.
ssh-copy-id -i vorkhive-deploy.pub root@157.230.240.163
# Or manually:
#   cat vorkhive-deploy.pub | ssh root@157.230.240.163 \
#     "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 3. Verify the key works.
ssh -i vorkhive-deploy root@157.230.240.163 'echo OK'

# 4. Paste the PRIVATE key (whole file, BEGIN/END lines included) into the
#    DEPLOY_SSH_KEY GitHub secret.
cat vorkhive-deploy

# 5. Delete the local key file once it's in GitHub.
rm vorkhive-deploy vorkhive-deploy.pub
```

## First-time setup on the server

Ensure the repo is already cloned at `DEPLOY_PATH` and the deploy user can run
docker without sudo:

```bash
# On the production host:
git clone https://github.com/Mavrone81/HrMS.git /root/NEWHRMS
cd /root/NEWHRMS
# Verify docker access (should print container list, not "permission denied"):
docker compose ps
```

## How a deploy plays out

1. Push to `main` → GitHub Actions kicks off `pr-tests.yml`
2. Backend + frontend unit/integration tests run (~5 min)
3. e2e suite runs (~8 min)
4. **`deploy` job** SSHes in, runs:
   - `git fetch + reset --hard origin/main`
   - `docker compose up -d --build --remove-orphans`
   - `docker image prune -f` to reclaim disk space
5. Smoke check probes `/health` on the API gateway and the frontend root
6. Failure at any step surfaces in the Actions log; deploy is **idempotent** —
   re-running the workflow safely re-applies state

## Manual triggers

The current setup runs only on `push: [main]`. To allow manual re-deploys
(e.g. after a config change on the server that doesn't touch the repo), add
this stanza near the top of the workflow:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:   # adds a "Run workflow" button in the Actions UI
```

Then trigger from **Actions → PR tests → Run workflow → main**.

## Rollback

```bash
# On the production host, revert to a known-good commit:
cd /root/NEWHRMS
git log --oneline -10               # find the commit hash to roll back to
git reset --hard <hash>
docker compose up -d --build
```
