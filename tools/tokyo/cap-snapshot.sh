#!/bin/bash
# tokyo-01 hourly cap-snapshot -> commit+push to oi-radar (deploy key).
set -eu
REPO=/opt/alpha-card/oi-radar
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/oiradar_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
cd "$REPO"
git pull --rebase --quiet origin main || true
python3 cap-snapshot-collector.py --output cap-snapshot.json
git add cap-snapshot.json
if git diff --cached --quiet; then
  echo "no changes"
else
  git -c user.name=alpha-collector -c user.email=alpha-collector@tokyo commit -q -m "chore: refresh cap snapshot"
  git push -q origin main
  echo "pushed"
fi
