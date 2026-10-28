#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init --bare --quiet "$work/origin.git"
git init --quiet -b main "$work/repo"
cd "$work/repo"
git config user.name 'Release test'
git config user.email 'release-test@example.invalid'
mkdir -p scripts web/static
cp "$root/scripts/tag-release.sh" scripts/
cp "$root/Makefile" "$root/VERSION" .
cp "$root/web/static/kp.js" web/static/
git add .
git commit --quiet -m initial
git remote add origin "$work/origin.git"
git push --quiet origin main
expect() {
  expected=$1 name=$2
  shift 2
  result=0
  "$@" > "$work/output" 2>&1 || result=$?
  if [[ $result != "$expected" ]]; then cat "$work/output"; echo "FAIL $name ($result != $expected)"; exit 1; fi
  echo "PASS $name"
}
expect 0 clean-check bash scripts/tag-release.sh --check
! git show-ref --verify --quiet "refs/tags/v$(cat VERSION)"
expect 64 invalid-argument bash scripts/tag-release.sh --invalid
printf '\n' >> web/static/kp.js
expect 1 dirty-tree bash scripts/tag-release.sh --check
git restore web/static/kp.js
git switch --quiet -c feature
expect 1 non-main-branch bash scripts/tag-release.sh --check
git switch --quiet main
expect 2 version-mismatch make check-version VERSION=invalid
printf 'ahead\n' > extra.txt
git add extra.txt
git commit --quiet -m ahead
expect 1 unsynchronized-main bash scripts/tag-release.sh --check
git push --quiet origin main
expect 0 publish-tag bash scripts/tag-release.sh
test "$(git --git-dir="$work/origin.git" rev-parse "v$(cat VERSION)^{commit}")" = "$(git rev-parse HEAD)"
expect 0 repeat-same-tag bash scripts/tag-release.sh
printf 'another\n' >> extra.txt
git add extra.txt
git commit --quiet -m another
git push --quiet origin main
expect 1 tag-cannot-move bash scripts/tag-release.sh
