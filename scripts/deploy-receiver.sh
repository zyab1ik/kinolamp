#!/bin/bash
# Restricted SSH command; stdin is one gzip-compressed docker save archive.
set -euo pipefail
umask 077

deploy_image() {
  revision=$1
  export KINOLAMP_IMAGE="kinolamp:$revision"
  export KINOLAMP_ENV_FILE=$2
  state=$3
  compose_file=$4
  mkdir -p "$state"
  exec 9>"$state/lock"
  flock -w 600 9
  archive=$(mktemp "$state/image.XXXXXX.gz")
  trap 'rm -f "$archive"' EXIT
  # Bound uploads to 128 MiB. Kinolamp's runtime image is considerably smaller.
  head -c 134217729 > "$archive"
  if (( $(stat -c %s "$archive") > 134217728 )); then
    echo 'Image archive exceeds 128 MiB' >&2
    exit 65
  fi
  gzip -t "$archive"
  docker load --input "$archive" > /dev/null
  actual=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$KINOLAMP_IMAGE")
  [[ $actual == "$revision" ]] || { echo 'Image revision does not match deployment' >&2; exit 65; }
  previous=$(docker inspect --format '{{.Image}}' kinolamp-kinolamp-1)
  compose() {
    docker compose --project-name kinolamp --env-file "$KINOLAMP_ENV_FILE" -f "$compose_file" "$@"
  }
  healthy() {
    for attempt in {1..30}; do
      if [[ $(docker inspect --format '{{.State.Health.Status}}' kinolamp-kinolamp-1 2>/dev/null) == healthy ]] &&
        curl --fail --silent --max-time 5 http://127.0.0.1:8788/health > /dev/null; then
        return 0
      fi
      sleep 2
    done
    return 1
  }
  if compose up --detach --no-build --pull never && healthy; then
    printf '%s\n' "$revision" > "$state/revision.tmp"
    mv "$state/revision.tmp" "$state/revision"
    echo "Deployed $revision; container is healthy"
  else
    echo 'Deployment failed; restoring previous image' >&2
    export KINOLAMP_IMAGE="$previous"
    compose up --detach --no-build --pull never
    healthy || { echo 'Rollback health check failed; operator attention required' >&2; exit 70; }
    echo 'Previous image restored' >&2
    exit 1
  fi
}

main() {
  export PATH=/usr/bin:/bin
  if [[ ! ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
    echo 'Expected: deploy <40-character commit SHA>' >&2
    exit 64
  fi
  deploy_image "${BASH_REMATCH[1]}" /home/debian/kinolamp/.env /home/debian/.local/state/kinolamp-deploy /etc/kinolamp/compose.yaml
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main
fi
