# Releases

`VERSION` is the release version. The plugin's VERSION constant must match it; `make check-version` rejects a mismatch. Go binaries and Docker images receive that version at build time, so `/health` and the KinoPub device description identify the same release.

## Publish a version

1. Update `VERSION` and the VERSION/header in `web/static/kp.js` in a pull request, for example to `0.3.1`. Adjust the device-version assertion in the plugin test.
2. Merge the pull request after CI passes. The existing main workflow automatically deploys the verified image.
3. Synchronize a clean local main and run:

   ```sh
   make release-check
   make release
   ```

`make release` validates the version, requires a clean main matching origin/main, and pushes an annotated `v<VERSION>` tag. It never moves an existing tag to a different commit.

The Release workflow accepts tags matching the committed version, checks that the tag commit belongs to main, then runs quality checks, complete Go/JavaScript coverage and release-guard tests. It builds artifacts before granting the publishing job write access.

## Assets

- `kp.js`: plugin for Lampa.
- `icon.svg`: scalable logo.
- `kinolamp-v<VERSION>-linux-amd64.tar.gz` and `...-linux-arm64.tar.gz`: standalone Go server with embedded web assets, blank example configuration, license and startup instructions.
- `SHA256SUMS`: checksums for all uploaded assets.

The standalone binary does not read `.env` automatically. Start it with environment variables set; the included `.env.example` is a reference. No personal `.env`, credentials or account tokens are packaged.

To build and check assets locally:

```sh
make dist
(cd dist && shasum -a 256 --check SHA256SUMS)
make test-release
```

Publication first creates/updates a draft, uploads all verified assets, then publishes it with generated release notes. A retry may replace draft assets but does not overwrite an already published release. A failed publication leaves a draft for retry rather than presenting an incomplete release as final.

Publishing a tag does not independently deploy the VPS: deployment belongs to the main CI workflow. Creating a release does not make a private repository public.
