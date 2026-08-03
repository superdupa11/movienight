---
description: Publish Movie Night - secret-scan, verify build/tests, commit, push to GitHub, then build and push the Docker image on Unraid. Use when the user asks to publish, ship, deploy, or release an update.
---

You are running the production publish flow for Movie Night. This drives a
multi-machine pipeline: local dev Mac -> GitHub -> Unraid (via the
`code-server` container, which shares Unraid's Docker socket) -> Docker Hub.
Unraid pulls the new image itself via its own auto-updater; this skill does
not touch a running container.

This is a shared-state operation (pushes to a public GitHub repo, publishes a
public Docker Hub image). Pause for explicit user confirmation at the two
checkpoints marked below — don't push through them silently. If this is the
very first publish on a new machine, also read "One-time machine setup"
below before starting; on a machine that's already set up, skip straight to
"Steps."

## One-time machine setup (already done on the Mac mini this was built on — skip if already present)

- SSH alias `mtg-publish` in `~/.ssh/config` -> `root@10.11.10.100` (Unraid
  host). Despite the name, this is generic Unraid access, not
  MTG-project-specific — it's reused here as-is rather than adding a
  duplicate alias. If `ssh mtg-publish whoami` fails on a new machine, this
  needs to be re-bootstrapped (generate a key, add the public half to
  Unraid's `/root/.ssh/authorized_keys` via the Unraid web terminal, enable
  SSH under Unraid Settings -> Management Access).
- Docker Hub login lives inside the `code-server` container at
  `/config/.docker/config.json` (`HOME=/config` in that container, not
  `/root`) under account `brianjwalz`. It's shared across every project
  published from this container — nothing project-specific to set up here.
  If missing, run interactively from your own terminal (not via this skill,
  to avoid leaking the token to chat history):
  `ssh -t mtg-publish "docker exec -it code-server docker login -u brianjwalz"`
  using a Docker Hub access token, not the account password.
- GitHub access from inside `code-server` uses a read-only deploy key,
  **one per repo** (this project's mtg-stats siblings each have their own —
  don't reuse another project's key). For Movie Night specifically:
  - Private key: `/config/.ssh/movienight_deploy_key` (generated directly on
    Unraid via `docker exec code-server ssh-keygen ...` — it never touched
    the dev Mac).
  - Registered read-only on `superdupa11/movienight` (GitHub repo settings ->
    Deploy keys), title `unraid-code-server-movienight-readonly`.
  - Repo cloned at `/config/.local/share/code-server/movienight`, with
    `git config core.sshCommand "ssh -i /config/.ssh/movienight_deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/config/.ssh/known_hosts"`
    set on that clone.
  - If any of this is missing on a new machine or was wiped by a
    `code-server` container recreation (its non-`/config` filesystem state
    doesn't persist), redo it: generate the keypair on Unraid, register the
    public half with `gh repo deploy-key add <pubkey-file> --repo superdupa11/movienight --title "unraid-code-server-movienight-readonly"` (omit `--allow-write` — it must stay read-only), then re-clone with the sshCommand above.

## Key facts

| Thing | Value |
|---|---|
| Unraid SSH alias | `mtg-publish` (root@10.11.10.100) — shared, not project-specific |
| Build container | `code-server` (shares Unraid's Docker socket -> native `linux/amd64`, no cross-compile needed for the native modules in package.json) |
| Repo path inside container | `/config/.local/share/code-server/movienight` |
| GitHub repo | `superdupa11/movienight` (public) |
| Docker Hub image | `brianjwalz/movienight` |
| Deploy key | `/config/.ssh/movienight_deploy_key` inside `code-server`, read-only, registered on the GitHub repo above |

## Steps

### 1. Secret preflight — do this before anything is staged

Never trust `.gitignore` alone; verify it actively every run.

```bash
git status --porcelain=v1 -uall | grep -E '^\?\? \.env$' && echo "STOP: .env is untracked and about to be missed by review — confirm .gitignore covers it"
git check-ignore -v .env data .env.local 2>&1   # each should print a matching .gitignore rule; if any line is empty, STOP
```

Then scan every file that's about to be staged (not just changed ones — a
first-time file matters as much as a modified one) for secret-shaped values:

```bash
git add -A -n   # dry run, lists what WOULD be staged, without staging yet
git status --porcelain=v1 | awk '{print $2}' | xargs -I{} grep -lIE \
  '(PLEX_TOKEN|SESSION_SECRET|_TOKEN|_SECRET|_KEY)\s*=\s*[A-Za-z0-9_-]{12,}' {} 2>/dev/null
```

Any hit needs a human look — a placeholder like `.env.example`'s
`SESSION_SECRET=change-me-to-a-long-random-string` is fine and expected; a
real token is not. If genuinely unsure whether a match is a real secret,
stop and ask rather than deciding alone.

### 2. Verify it actually works before publishing

```bash
npm run typecheck && npm test && npm run build
```

If any of these fail, stop — don't publish a build that doesn't pass its own
gates. Fix or ask the user how to proceed; don't skip this step to save time.

### 3. Commit

```bash
git add -A
git status --short   # eyeball the full list — anything unexpected?
git commit -m "<message describing the actual change being published>"
```

If `git status` shows nothing to commit and `HEAD` already matches what's on
`origin/main`, there's nothing new to publish — confirm with the user
whether they still want to force a rebuild/republish of the current `HEAD`,
or stop here.

### 4. Push

**Checkpoint — confirm with the user before this step** (public repo).

```bash
git push origin main
```

### 5. Remote build and push (on Unraid via code-server)

**Checkpoint — confirm with the user before this step**, since it publishes
a public Docker Hub image.

```bash
ssh mtg-publish bash -s <<'REMOTE'
docker exec code-server sh -c '
  cd /config/.local/share/code-server/movienight &&
  git pull &&
  TAG=$(git rev-parse --short HEAD) &&
  docker build -t brianjwalz/movienight:latest -t brianjwalz/movienight:$TAG . &&
  docker push brianjwalz/movienight:latest &&
  docker push brianjwalz/movienight:$TAG &&
  echo "PUBLISHED_TAG=$TAG"
'
REMOTE
```

Watch for the `PUBLISHED_TAG=` line and report it — it's the rollback point
if the new image misbehaves (`docker pull brianjwalz/movienight:<tag>` on
Unraid, then repoint the running container at that explicit tag instead of
`latest`).

Sanity-check the architecture once, or any time a build environment change
is suspected:

```bash
ssh mtg-publish "docker exec code-server docker image inspect brianjwalz/movienight:latest --format '{{.Architecture}}/{{.Os}}'"
# expect: amd64/linux
```

## Failure signatures

| Symptom | Likely cause |
|---|---|
| `npm run typecheck`/`test`/`build` fails | Real bug — fix it, don't publish around it |
| `git push` rejected (non-fast-forward) | `origin/main` has commits this checkout doesn't — `git pull --rebase` and resolve, don't force-push |
| `git pull` on Unraid fails with "could not read Username" | Deploy key / `core.sshCommand` got reset, likely because `code-server` was recreated (its non-`/config` filesystem state doesn't persist) — redo the deploy-key setup above |
| `docker login` missing inside `code-server` after a container update | Same cause as above — `/config/.docker` should survive; reconfirm before assuming a real failure |
| `docker image inspect` reports anything other than `amd64/linux` | Build ran somewhere unexpected (not natively on the Unraid host) — investigate before shipping; Unraid needs `linux/amd64` |
| Secret-shaped grep hit on a real value | Stop. Do not commit. Rotate the credential if it was ever staged/committed, even locally-only — treat as compromised. |

## After publishing

Report: the commit that was pushed, the Docker Hub tag published, and the
architecture check result. Remind the user Unraid's auto-updater (not this
skill) is what pulls the new image onto the running container — this skill
never touches the deployed container directly.
