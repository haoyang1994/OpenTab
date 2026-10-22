# Offline extension release candidate

This builds an **unsigned local candidate**, not a Chrome Web Store release or a
signed CRX. It does not publish, upload, create tags, fetch dependencies, generate
keys, or change the manifest. The optional SSH gateway remains a separate Node
process and is deliberately not distributed inside the extension ZIP.

## Build and inspect

Requirements: Git checkout and Python 3.9+ (standard library only). No `npm ci`,
network access, signing key, or globally installed archive tool is needed.

```sh
python3 scripts/package-release.py
# Equivalent convenience command:
npm run package:release
# Optional destination (must be a .zip):
python3 scripts/package-release.py --output /tmp/opentab-candidate.zip
python3 -m zipfile -l dist/opentab-1.1.0.zip
```

The default destination is `dist/opentab-<manifest-version>.zip`. The command
prints the SHA-256 of the actual ZIP bytes. `dist/` and ZIPs remain gitignored.
A failed validation leaves any previous candidate untouched: never mistake an
old file for the output of a failed build.

ZIP entries are the sorted, individually reviewed paths in
`scripts/release-files.json`, not a recursive copy of the checkout. The current
baseline has 99 entries: extension pages/scripts/styles, manifest, icons and
catalog, default wallpapers, browser libraries, both Chrome message locales,
three application translation bundles, and redistribution licenses/notices.
`vendor/README.md` records the actual vendored dependency versions. Package
metadata, SSH gateway code, tests, documentation, screenshots, `.git`,
`node_modules`, build outputs, keys and environment files are excluded.

Every entry must be tracked, nonignored, a regular nonsymlink file under the
checkout, and in the runtime inventory. Symlink ancestors, traversal, duplicate
or unsorted paths, ignored files (including force-added files), missing files,
and new tracked runtime files absent from the allowlist fail closed. Untracked
files are never included. The output preserves source bytes exactly, including
manifest version, permissions and CSP. Local working-tree edits are included;
use a clean reviewed commit when preparing a release.

Entries use stored (uncompressed) bytes, sorted names, fixed 1980 timestamps and
0644 regular-file modes, with no directory entries, comments or extra metadata.
This trades a little download size for reproducibility independent of zlib,
source timestamps, permissions, timezone or npm versions.

## Review changes to runtime inventory

When adding, renaming or removing a runtime file, review the exact path and its
purpose, update the sorted explicit JSON allowlist, and rerun both package tests
and browser smoke. Do not replace it with globs or automatic directory discovery.
The current inventory includes the keyboard focus helper
`lib/core-accessibility.js` from the preceding UI iteration.

Closure validation checks manifest page/worker/icon paths, HTML resources,
CSS URLs, worker imports, local script path literals, icon catalog SVGs,
default-locale presence and manifest message keys in every shipped locale.
Historical wallpaper migration keys are explicitly exempt because they are not
loaded assets. This is intentionally a conservative static check, not a full JS
parser: dynamically constructed resources require an explicit inventory review
and real-browser coverage.

## Required validation before distribution

```sh
npm run test:package          # Offline Python + navigation/fixture regression tests
npm test                      # Existing 13 Node + 8 MV3 suites, plus package tests
npm run test:package:smoke    # Additional real MV3 smoke of freshly extracted ZIP
```

`test:package` verifies two builds have identical SHA-256 after source timestamp
and mode changes, compares every entry byte-for-byte with source, verifies ZIP
metadata, rechecks extracted asset closure and exercises rejection cases.

The separate packaged smoke requires the existing Playwright installation and
Chromium. On Linux without a display it uses `xvfb-run`, matching the normal
headed MV3 strategy. It builds the candidate in `dist/` and extracts a temporary copy, loads **only
the extracted directory**, checks the installed service worker and manifest,
opens all four extension pages, verifies actual extension-document identity and
clock/i18n/vendor initialization, and exercises the JSON buttons with synthetic
fixtures. It accepts a nullable navigation Response only alongside the correct
loaded document, and rejects console/page errors or missing extension resources.
The SSH page checks terminal initialization and its expected missing-parameter
state, not a real server connection. Temporary profiles and
extracted files are removed afterward. It is additive: it does not replace or
weaken the existing E2E suites. It is not silently skipped when Chromium fails.

CI runs the extracted-candidate smoke after all existing tests, then retains the
exact tested ZIP and its SHA-256 list as an unsigned candidate artifact.
Do not distribute or label a candidate verified until the full tests and the
extracted-artifact smoke pass in a browser-capable environment. A successful
static package test alone is not browser or release approval.
