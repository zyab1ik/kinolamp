# Releases

`VERSION` is the release version. The plugin's VERSION constant must match it; `make check-version` rejects a mismatch. Go binaries and Docker images receive that version at build time, so `/health` and the KinoPub device description identify the same release.

## Publish a version

1. Update `VERSION` and `VERSION` in `web/plugin/config.js` in a pull request, for example to `0.3.7`. Run `make build-plugin` to regenerate `web/static/kp.js` and commit it with the sources. Adjust the device-version assertion in the plugin test.
2. Merge the pull request after CI passes. The main pipeline tests and deploys the verified image, checks public HTTPS, and completes its pipeline summary.
3. The final **Release** stage automatically packages and publishes the new version. No local tag or manual GitHub release action is required.

Release is a reusable workflow called only after every required main job succeeds and deployment reports `deployed=true`. Pull requests, failed/cancelled checks, disabled deployment and outdated commits whose deployment was skipped cannot publish. A tag push alone does not start publication.

The workflow checks out the exact tested/deployed commit, validates VERSION and main ancestry, repeats quality/coverage/release checks, then packages the archives. Only the final publishing job receives repository write permission. GitHub creates the version tag at the deployed commit; it is never moved. The existing version is skipped without rebuilding or modifying its assets. Bump VERSION in the next version PR; documentation-only merges do not republish an existing version.

`make release-check` still validates a clean, synchronized main. `make release` is an optional manual pre-tagging command; it does not bypass or trigger publication. A pre-existing tag for an unreleased version must point to the deployed commit, otherwise release fails safely. To retry a failed release, rerun the failed main pipeline jobs in GitHub Actions.

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

Release publication is the final main pipeline stage and never starts another deployment. Creating a release does not make a private repository public.
