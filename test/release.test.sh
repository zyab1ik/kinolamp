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
cp "$root/scripts/tag-release.sh" "$root/scripts/release-plan.sh" scripts/
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
mkdir -p "$work/bin"
cat > "$work/bin/gh" <<'GH'
#!/bin/bash
[[ "$*" == 'release view '* ]] || exit 99
case "${TEST_DRAFT:-missing}" in
  true|false) printf '%s\n' "$TEST_DRAFT" ;;
  *) exit 1 ;;
esac
GH
chmod +x "$work/bin/gh"
export PATH="$work/bin:$PATH"
export RELEASE_REVISION=$(git rev-parse HEAD)
export GITHUB_OUTPUT="$work/outputs" GITHUB_STEP_SUMMARY="$work/summary"
expect 0 release-plan-new-version bash scripts/release-plan.sh
grep -q '^publish=true$' "$GITHUB_OUTPUT"
expect 1 release-plan-invalid-sha env RELEASE_REVISION=invalid bash scripts/release-plan.sh
expect 1 release-plan-wrong-checkout env RELEASE_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bash scripts/release-plan.sh
expect 0 release-plan-draft env TEST_DRAFT=true bash scripts/release-plan.sh
expect 0 release-plan-published env TEST_DRAFT=false bash scripts/release-plan.sh
test "$(tail -1 "$GITHUB_OUTPUT")" = publish=false
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
export RELEASE_REVISION=$(git rev-parse HEAD)
expect 0 release-plan-valid-existing-tag bash scripts/release-plan.sh
printf 'another\n' >> extra.txt
git add extra.txt
git commit --quiet -m another
git push --quiet origin main
expect 1 tag-cannot-move bash scripts/tag-release.sh
export RELEASE_REVISION=$(git rev-parse HEAD)
expect 1 release-plan-tag-cannot-move bash scripts/release-plan.sh
expect 0 release-plan-existing-version env TEST_DRAFT=false bash scripts/release-plan.sh
git tag -d "v$(cat VERSION)" >/dev/null
git switch --quiet -c unmerged
printf 'unmerged\n' > unmerged.txt
git add unmerged.txt
git commit --quiet -m unmerged
export RELEASE_REVISION=$(git rev-parse HEAD)
expect 1 release-plan-unmerged-commit bash scripts/release-plan.sh
