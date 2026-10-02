#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Deploys the built site (web/site, from `npm run site`) to the gh-pages branch as a single
# orphan commit, replacing whatever was there. GitHub Pages serves that branch.
#
#   scripts/deploy-gh-pages.sh            # build first: cd web && npm run site
#   scripts/deploy-gh-pages.sh --dry-run  # assemble the commit, show it, push nothing
#
# DEPLOY_REMOTE overrides the push URL (CI passes one carrying its token).

if [[ ! -f web/site/index.html || ! -f web/site/gallery/index.html ]]; then
  echo "Missing web/site (run 'cd web && npm run site' first)"
  exit 1
fi

dry=false
[[ "${1:-}" == "--dry-run" ]] && dry=true

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

remote="${DEPLOY_REMOTE:-$(git remote get-url origin)}"
git -C "$tmpdir" init -q -b gh-pages
cp -R web/site/. "$tmpdir/"
touch "$tmpdir/.nojekyll" # serve files as they are; no Jekyll processing

source_commit=$(git rev-parse --short HEAD)
git -C "$tmpdir" add -A
git -C "$tmpdir" \
  -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name)}" \
  -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email)}" \
  commit -q -m "Deploy site from ${source_commit}"

if $dry; then
  git -C "$tmpdir" show --stat --oneline HEAD | head -20
  echo "(dry run: nothing pushed)"
  exit 0
fi
git -C "$tmpdir" push -q -f "$remote" gh-pages
echo "Deployed site from ${source_commit} to gh-pages"
