#!/bin/bash
# tokyo-01 hourly Coinglass coin snapshot -> commit+push to oi-radar (deploy key).
set -eu
REPO=/opt/alpha-card/oi-radar
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/oiradar_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
cd "$REPO"
git pull --rebase --quiet origin main || true
python3 cg-snapshot-collector.py --top 140 --workers 6 --output cg-snapshot.json
git add cg-snapshot.json
if git diff --cached --quiet; then
  echo "no changes"
else
  git -c user.name=alpha-collector -c user.email=alpha-collector@tokyo commit -q -m "chore: refresh coinglass snapshot"
  git push -q origin main
  echo "pushed"
fi
