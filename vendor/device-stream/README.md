# Vendored @device-stream/* packages

This directory holds npm-pack tarballs for the `@device-stream/*` packages
that device-farm consumes. Tarballs are committed so that a fresh clone of
device-farm + `npm install` succeeds without requiring a sibling
`../device-stream` repository.

## Contents

- `core-1.1.0.tgz` — @device-stream/core v1.1.0
- `android-1.1.0.tgz` — @device-stream/android v1.1.0
- `ios-simulator-1.1.0.tgz` — @device-stream/ios-simulator v1.1.0

## How device-farm consumes these

`package.json` references each tarball via a local `file:` path, e.g.:

```json
"@device-stream/core": "file:./vendor/device-stream/core-1.1.0.tgz"
```

npm resolves the `file:` spec as if the tarball were published to a
registry. No peer-dependency resolution against a sibling repo happens.

## Refreshing (when a new device-stream version ships)

Run the companion refresh script:

```bash
./scripts/vendor-device-stream.sh [optional-path-to-device-stream-checkout]
```

The script:

1. Runs `npm run build` in each package of the device-stream checkout
2. Runs `npm pack` to produce fresh tarballs
3. Moves them into this directory with `<pkg>-<version>.tgz` naming

After running, update `package.json` to match the new tarball filenames if
versions changed, then commit `vendor/device-stream/*.tgz` + `package.json`
+ `package-lock.json` together.

## Reversibility

The vendored-tarball approach is reversible. To migrate to a published
private npm registry (e.g., GitHub Packages), change the `file:` references
to version specs (e.g., `^1.1.0`) and add an `.npmrc` pointing at the
registry. The `@device-stream/*` source repository already declares
`publishConfig.registry: "https://npm.pkg.github.com"`, so the migration
path is: publish + swap references.

Tarballs in this directory are collapsed in GitHub diff views via
`.gitattributes` (`linguist-generated=true`).

## Why not npm workspaces?

Workspaces require a monorepo layout where device-stream lives under
device-farm's tree. device-stream ships as its own repo and publishes to
its own npm namespace. Vendoring + `file:` is the lowest-friction bridge
until registry publishing lands.
