# Production deploy — GaDongHR Singapore + Malaysia (`gdr`)

> ⚠️ **This repository is public.** Host addresses, credentials and private keys must never appear
> in this file or anywhere else in the tree. Concrete values live with the operator and in the
> deployment's own `.env` on the server — not in git. Use the placeholders below as-is.

## Which product this is

| | |
|---|---|
| Repository | `Mavrone81/GaDongHr_Sing_mal` — the **Singapore + Malaysia** fork line, where the fork line *is* `main` |
| Checkout on the server | `/root/gdr` |
| Compose project | this repo's `docker-compose.yml` (28 services) |
| Frontend port | **3100** (bound to `127.0.0.1`) |
| API gateway port | **4100** (bound to `127.0.0.1`) |
| Service ports | **4101–4122** (bound to `127.0.0.1`) |
| Host | `<DEPLOY_HOST>` — **deliberately not recorded here.** Ask the deploy owner. |

🔴 **Do not confuse this with its two siblings.** The host also runs a *different* product that is
also branded GaDongHR, from a different repository and a different checkout, and this codebase's
upstream (`Mavrone81/HrMS`) is a *third*, separate product deployed elsewhere. Before running
anything on the server, confirm `git remote -v` in the checkout you are standing in. Earlier
revisions of this document named the wrong repository (`Mavrone81/HrMS`) and the wrong path
(`/root/NEWHRMS`), which would have pointed a deploy at another product's tree.

### Why these ports

Every port in `docker-compose.yml` is env-overridable (`${API_GATEWAY_PORT:-4000}` and friends) and
every one binds `127.0.0.1`, never `0.0.0.0`. The defaults in the compose file are 3000/4000/4001–4022;
`gdr` shifts to 3100/4100/4101–4122 via its `.env` so it can never contend with the other stack on
the same host. **Nothing is published on 3000 or 4000 for this deployment** — a health probe against
those ports is probing nothing. See `B3` for the correct smoke check.

## How a deploy happens

🔴 **Being replaced.** The `deploy` job in `.github/workflows/pr-tests.yml` SSHes into the
production host as `root` using a private key stored in a GitHub Actions secret. That design is
being withdrawn (Track B2) in favour of a pull-based deployer that runs on the server, so that **no
root SSH key for production has to exist in a public repository's settings.**

**Until B2 lands:**
- The Actions `deploy` job is **inert** — it is gated on secrets that are intentionally left unset.
- 🔴 **Do not set `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_SSH_KEY` or `DEPLOY_PORT`.**
  Setting them does not "finish" the setup; it arms a second deployer alongside the one already
  running on the server, and both do `git reset --hard`, against the same tree.
- Deploys are **not** self-service. They need the deploy owner's explicit go.

A previous version of this file contained step-by-step instructions to generate an SSH key, copy it
to a host by IP address, and paste the **private** half into a GitHub secret. Those instructions
have been removed. If you followed them at any point, treat that key as compromised and have it
rotated and removed from the server's `authorized_keys`.

## Deploy preconditions

Check these **before** starting a deploy, not after:

1. **Disk headroom.** This stack builds 27 images on the host, 22 of which run `prisma generate`.
   A full rebuild needs well more free space than a nearly-full disk has, and a build that runs out
   of space partway can leave containers stopped rather than failing cleanly. Check free space and
   the build cache first.
2. **Which stack you are touching.** `docker compose ps` from `/root/gdr`, and confirm the other
   product's containers are not in the list.
3. **A rollback target.** Know the commit you would go back to before you move forward from it.

## Rollback

```bash
cd "$DEPLOY_PATH"
git log --oneline -10            # pick a known-good commit
git reset --hard <commit>
docker compose up -d --build
```

⚠️ `git reset --hard` **discards any change made on the server**, including configuration edited in
place. Anything that must survive a deploy belongs in the repo or in the server's `.env`, never as a
working-tree edit.

⚠️ Rollback is **not** free here: it rebuilds, so it is subject to the same disk precondition as a
deploy, and it is not instantaneous. Re-running a deploy is **not** reliably idempotent — an earlier
revision of this document claimed it was. A deploy interrupted partway can need a manual
`docker compose start` to bring the stack back up.

## Manual trigger

The workflow currently runs on `pull_request` and `push` to `main`. Adding `workflow_dispatch:`
would add a "Run workflow" button — **do not add it while the `deploy` job still exists in its
current form**, because it would make a production deploy a one-click action for anyone with write
access to the repository.

## Note on this file's history

The host addresses removed from this file are still present in the repository's **git history**;
editing the tip does not remove them. Scrubbing history is a separate, coordinated operation and has
not been done. Assume anything ever committed here is public.
