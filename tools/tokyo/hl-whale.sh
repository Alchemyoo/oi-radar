#!/bin/bash
# tokyo-01 hourly Hyperliquid whale snapshot -> commit+push (deploy key).
set -eu
REPO=/opt/alpha-card/oi-radar
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/oiradar_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
cd "$REPO"
git pull --rebase --quiet origin main || true
python3 hl-whale-collector.py --users "${HL_USERS:-1500}" --output hl-whale-cache.json
git add hl-whale-cache.json
if git diff --cached --quiet; then
  echo "no changes"
else
  git -c user.name=alpha-collector -c user.email=alpha-collector@tokyo commit -q -m "chore: refresh HL whale cache"
  git push -q origin main
  echo "pushed"
fi
