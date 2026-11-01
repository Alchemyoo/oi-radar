#!/bin/bash
# tokyo-01 hourly Binance OI cache -> commit+push (deploy key).
set -eu
REPO=/opt/alpha-card/oi-radar
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/oiradar_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
cd "$REPO"
git pull --rebase --quiet origin main || true
python3 oi-cache-collector.py --limit "${CACHE_LIMIT:-50}" --output oi-radar-live.json
git add oi-radar-live.json
if git diff --cached --quiet; then
  echo "no changes"
else
  git -c user.name=alpha-collector -c user.email=alpha-collector@tokyo commit -q -m "chore: refresh OI radar cache"
  git push -q origin main
  echo "pushed"
fi
