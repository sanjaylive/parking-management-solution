#!/usr/bin/env bash
# npm run deploy — push main to GitHub; GitHub Actions tests, builds and deploys to the VPS (.github/workflows/deploy.yml).
# Refuses to run with uncommitted changes so what you deploy is exactly what's in git.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REMOTE=${DEPLOY_REMOTE:-origin}
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = main ] || { echo "✖ Deploys go from main (you're on '$BRANCH'). Merge first, then run again." >&2; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  echo "✖ Uncommitted changes — commit or stash them first:" >&2
  git status --short >&2
  exit 1
fi

SHA=$(git rev-parse HEAD)
echo "→ Pushing $(git log -1 --format='%h %s') to $REMOTE/main"
git push "$REMOTE" main

if ! command -v gh >/dev/null; then
  echo "✓ Pushed. Follow the deploy at https://github.com/sanjaylive/parking-management-solution/actions"
  exit 0
fi

echo "→ Waiting for the GitHub Actions run…"
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID=$(gh run list --workflow deploy.yml --commit "$SHA" --event push --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)
  [ -n "$RUN_ID" ] && break
  sleep 2
done
[ -n "$RUN_ID" ] || { echo "✓ Pushed, but no workflow run appeared yet. Check: gh run list" ; exit 0; }
gh run watch "$RUN_ID" --exit-status --interval 10 && echo "✓ Deployed $SHA → https://park.2all.co.in" \
  || { echo "✖ Deploy failed. Logs: gh run view $RUN_ID --log-failed" >&2; exit 1; }
