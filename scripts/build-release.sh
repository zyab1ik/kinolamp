#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
version=$(cat VERSION)
make check-version
out="$root/dist"
mkdir -p "$out"
# Only remove prior Kinolamp distribution assets, not arbitrary build directories.
rm -f "$out"/kinolamp-* "$out/kp.js" "$out/icon.svg" "$out/SHA256SUMS"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for arch in amd64 arm64; do
  name="kinolamp-v${version}-linux-${arch}"
  mkdir "$work/$name"
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -buildvcs=false -ldflags="-s -w -X github.com/zyab1ik/kinolamp/internal/app.Version=$version" -o "$work/$name/kinolamp" ./cmd/kinolamp
  cp configs/kinolamp.env.example "$work/$name/.env.example"
  cp LICENSE "$work/$name/LICENSE"
  cat > "$work/$name/README.txt" <<INFO
Kinolamp $version — Linux $arch
The binary contains the plugin, logo and installation page.
Start: ./kinolamp (default: http://127.0.0.1:3000)
Set LISTEN_ADDR and the optional proxy environment variables when needed.
The .env.example file is a reference; the standalone binary does not load .env automatically.
Documentation: https://github.com/zyab1ik/kinolamp
INFO
  tar -czf "$out/$name.tar.gz" -C "$work" "$name"
done
cp web/static/kp.js web/static/icon.svg "$out/"
(cd "$out" && shasum -a 256 kinolamp-*.tar.gz kp.js icon.svg > SHA256SUMS)
echo "Release assets: $out"
