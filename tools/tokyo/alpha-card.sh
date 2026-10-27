#!/bin/bash
# tokyo-01 hourly alpha-card snapshot -> commit+push to oi-radar (deploy key).
set -eu
REPO=/opt/alpha-card/oi-radar
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/oiradar_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
cd "$REPO"
git pull --rebase --quiet origin main || true
python3 alpha-card-collector.py --limit "${ALPHA_LIMIT:-60}" --output alpha-card-cache.json
git add alpha-card-cache.json
if git diff --cached --quiet; then
  echo "no changes"
else
  git -c user.name=alpha-collector -c user.email=alpha-collector@tokyo commit -q -m "chore: refresh Alpha card cache"
  git push -q origin main
  echo "pushed"
fi
