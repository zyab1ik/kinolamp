#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
make check-version
version=$(cat VERSION)
tag="v$version"
[[ $(git branch --show-current) == main ]] || { echo 'Release must be tagged from main' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Working tree must be clean' >&2; exit 1; }
git fetch --quiet origin main
[[ $(git rev-parse HEAD) == "$(git rev-parse origin/main)" ]] || { echo 'main must match origin/main' >&2; exit 1; }
if git show-ref --verify --quiet "refs/tags/$tag"; then
  [[ $(git rev-parse "$tag^{commit}") == "$(git rev-parse HEAD)" ]] || { echo 'Tag already refers to another commit' >&2; exit 1; }
fi
if [[ ${1:-} == --check ]]; then
  echo "Ready to tag $tag at $(git rev-parse --short HEAD)"
  exit 0
fi
[[ $# == 0 ]] || { echo 'Usage: tag-release.sh [--check]' >&2; exit 64; }
if ! git show-ref --verify --quiet "refs/tags/$tag"; then
  git tag --annotate "$tag" --message "Kinolamp $tag"
fi
git push origin "refs/tags/$tag"
echo "Tag $tag pushed; Release workflow will validate and publish it"
