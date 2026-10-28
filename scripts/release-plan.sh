#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
make check-version
[[ ${RELEASE_REVISION:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required' >&2; exit 1; }
[[ $(git rev-parse HEAD) == "$RELEASE_REVISION" ]] || { echo 'Checkout does not match the deployed revision' >&2; exit 1; }
git merge-base --is-ancestor HEAD origin/main
release_tag="v$(cat VERSION)"
publish=true
if draft=$(gh release view "$release_tag" --json isDraft --jq .isDraft 2>/dev/null); then
  if [[ "$draft" == false ]]; then
    publish=false
    echo "Release $release_tag is already published. Bump VERSION for a new release." >> "$GITHUB_STEP_SUMMARY"
  fi
fi
if [[ "$publish" == true ]] && git show-ref --verify --quiet "refs/tags/$release_tag"; then
  [[ $(git rev-parse "$release_tag^{commit}") == "$RELEASE_REVISION" ]] || { echo 'Existing tag does not match the deployed revision' >&2; exit 1; }
fi
printf 'tag=%s\npublish=%s\n' "$release_tag" "$publish" >> "$GITHUB_OUTPUT"
