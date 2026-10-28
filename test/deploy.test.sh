#!/usr/bin/env bash
# Exercise the real deployment function with isolated Docker/HTTP command doubles.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin"
cat > "$scratch/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$MOCK_STATE/commands"
case "$1" in
  load) exit 0 ;;
  image) printf '%s\n' "${MOCK_LABEL:-$MOCK_REVISION}" ;;
  inspect)
    if [[ $* == *'.Image'* ]]; then echo sha256:previous; exit 0; fi
    count=$(cat "$MOCK_STATE/updates" 2>/dev/null || echo 0)
    if [[ ${MOCK_ROLLBACK_FAIL:-0} == 1 || ( ${MOCK_HEALTH_FAIL:-0} == 1 && $count == 1 ) ]]; then
      echo unhealthy
    else
      echo healthy
    fi
    ;;
  compose)
    count=$(cat "$MOCK_STATE/updates" 2>/dev/null || echo 0)
    echo $((count + 1)) > "$MOCK_STATE/updates"
    echo "$KINOLAMP_IMAGE" >> "$MOCK_STATE/images"
    if [[ ${MOCK_COMPOSE_FAIL:-0} == 1 && $count == 0 ]]; then exit 1; fi
    ;;
  *) exit 99 ;;
esac
MOCK
for name in curl sleep flock; do
  printf '#!/bin/sh\nexit 0\n' > "$scratch/bin/$name"
done
# macOS stat has a different CLI; the receiver uses Debian's stat -c.
cat > "$scratch/bin/stat" <<'MOCK'
#!/bin/sh
if [ "${MOCK_OVERSIZE:-0}" = 1 ]; then echo 134217729; else wc -c < "$3" | tr -d ' '; fi
MOCK
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH"
export MOCK_REVISION=0123456789012345678901234567890123456789
printf 'test image' | gzip > "$scratch/image.gz"
printf 'invalid archive' > "$scratch/invalid.gz"
run_case() {
  name=$1 expected=$2 input=$3
  shift 3
  export MOCK_STATE="$scratch/$name"
  mkdir -p "$MOCK_STATE"
  code=0
  env "$@" bash -c 'source "$1"; deploy_image "$MOCK_REVISION" "$MOCK_STATE/.env" "$MOCK_STATE/state" "$MOCK_STATE/compose.yaml"' bash "$root/scripts/deploy-receiver.sh" < "$input" > "$MOCK_STATE/output" 2>&1 || code=$?
  if [[ $code != "$expected" ]]; then cat "$MOCK_STATE/output"; echo "FAIL $name: $code != $expected"; exit 1; fi
  if compgen -G "$MOCK_STATE/state/image.*.gz" > /dev/null; then echo "FAIL $name: leftover upload"; exit 1; fi
  echo "PASS $name"
}
run_case success 0 "$scratch/image.gz"
test "$(cat "$MOCK_STATE/state/revision")" = "$MOCK_REVISION"
test "$(cat "$MOCK_STATE/images")" = "kinolamp:$MOCK_REVISION"
run_case oversized-upload 65 "$scratch/image.gz" MOCK_OVERSIZE=1
test ! -e "$MOCK_STATE/commands"
run_case bad-label 65 "$scratch/image.gz" MOCK_LABEL=wrong
test ! -e "$MOCK_STATE/updates"
run_case broken-archive 1 "$scratch/invalid.gz"
test ! -e "$MOCK_STATE/commands"
run_case failed-start 1 "$scratch/image.gz" MOCK_COMPOSE_FAIL=1
test "$(tail -1 "$MOCK_STATE/images")" = sha256:previous
test ! -e "$MOCK_STATE/state/revision"
run_case failed-health 1 "$scratch/image.gz" MOCK_HEALTH_FAIL=1
test "$(tail -1 "$MOCK_STATE/images")" = sha256:previous
run_case failed-rollback 70 "$scratch/image.gz" MOCK_ROLLBACK_FAIL=1
for command in '' 'bash' 'deploy ../../etc/passwd' 'deploy 0123456789012345678901234567890123456789; id'; do
  code=0
  SSH_ORIGINAL_COMMAND="$command" bash "$root/scripts/deploy-receiver.sh" < /dev/null > /dev/null 2>&1 || code=$?
  test "$code" = 64
done
echo 'PASS restricted SSH command validation'
