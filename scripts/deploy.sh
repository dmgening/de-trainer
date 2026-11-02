#!/usr/bin/env bash
# Pull-based deploy inside the LXC, run as root:
#   deploy.sh <git-ref>     build the ref (tag or origin/<branch>) into a new release and switch to it
#   deploy.sh --rollback    switch back to the previous release
# Migrations must stay additive so that a rollback of the code keeps working on the new schema.
set -euo pipefail

ROOT=${DE_TRAINER_ROOT:-/opt/de-trainer}
REPO=$ROOT/repo
RELEASES=$ROOT/releases
ENV_FILE=/etc/de-trainer/env
SERVICE=de-trainer
KEEP=5

health() {
  for _ in $(seq 1 20); do
    curl -fsS "http://127.0.0.1:${PORT:-8080}/healthz" >/dev/null && return 0
    sleep 1
  done
  return 1
}

switch_to() {
  ln -sfn "$1" "$ROOT/current.tmp"
  mv -Tf "$ROOT/current.tmp" "$ROOT/current"
  systemctl restart "$SERVICE"
}

set -a
. "$ENV_FILE"
set +a

if [[ "${1:-}" == "--rollback" ]]; then
  previous=$(ls -1dt "$RELEASES"/*/ | sed -n 2p)
  [[ -n "$previous" ]] || { echo "no previous release" >&2; exit 1; }
  switch_to "${previous%/}"
  health && echo "rolled back to ${previous%/}"
  exit
fi

ref=${1:?usage: deploy.sh <git-ref> | --rollback}
git -C "$REPO" fetch --tags --prune origin
sha=$(git -C "$REPO" rev-parse --short "$ref^{commit}")
dir=$RELEASES/$(date +%Y%m%d-%H%M%S)-$sha

mkdir -p "$dir"
git -C "$REPO" archive "$sha" | tar -x -C "$dir"
cd "$dir"
pnpm install --frozen-lockfile
pnpm build
runuser -u de-trainer -- node apps/server/dist/migrate.js

switch_to "$dir"
health || { echo "health check failed; run: deploy.sh --rollback" >&2; exit 1; }
ls -1dt "$RELEASES"/*/ | tail -n +$((KEEP + 1)) | xargs -r rm -rf
echo "deployed $sha → $dir"
