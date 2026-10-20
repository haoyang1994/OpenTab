# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Replaced the application icon and three bundled default backgrounds with original OpenTab artwork (Apache-2.0). Saved Pexels preset paths migrate to the matching new images (or fall back to the Bing default) so existing installs do not 404.

## [1.1.0] - 2026-10-20

### Added

- Apache License 2.0 `LICENSE` file
- `NOTICE` with third-party software and asset attributions
- Bilingual README (`README.md` English, `README.zh-CN.md` Chinese)
- Community files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- GitHub issue templates, pull request template, and `CI` workflow
- `tests/repo-hygiene.test.mjs` (included in `npm test`)
- Release notes at `docs/releases/v1.1.0.md`

### Changed

- Project license documented as Apache-2.0 (README previously claimed MIT, but no `LICENSE` file existed)
- Version number set to 1.1.0 in `manifest.json` and `package.json`
- GitHub Actions workflow replaced: `.github/workflows/e2e.yml` → `.github/workflows/ci.yml` (`CI`, `npm test`)
- Historical design notes moved to `docs/SPEC.md`
- `NOTICE` has no project copyright line; the FIX dictionary is attributed to QuickFIX/J under the QuickFIX Software License 1.0
- `npm test` runs on Linux without a display and in CI by wrapping headed Chromium with xvfb (#1)
- Calendar (flatpickr) and SSH terminal (xterm) load from committed `vendor/` copies, so loading the unpacked extension does not need `npm install` (#2)

### Security

- Local SSH gateway requires an extension-ID Origin allowlist and an access token; it does not load `~/.ssh/id_rsa` unless `SSH_PRIVATE_KEY_PATH` is set; compress arguments are POSIX single-quoted (#3)

### Removed

- Unused `FIX50SP2.xml`
- Unused `fix_values.js`
- Unused `fix_tags_new.js`
- Unused `test.mjs` (redundant E2E entry)

## [1.0.0] - 2026-06-26

### Added

- Initial OpenTab Chrome Manifest V3 new tab extension snapshot

<!-- The v1.0.0 git tag already exists. This change does not create a v1.1.0 tag or GitHub Release. -->

[Unreleased]: https://github.com/haoyang1994/OpenTab/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/haoyang1994/OpenTab/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/haoyang1994/OpenTab/releases/tag/v1.0.0
