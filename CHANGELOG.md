# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Shortcut grid **+** tile and empty-state hint for adding sites
- HTML5 drag-and-drop reorder on the desktop grid, with Alt+←/→ keyboard swap
- Undo toast after deleting a shortcut (6 seconds)
- Setting to open shortcuts in a new tab (`openInNewTab`)
- E2E coverage for uncaught `pageerror` on background-migration loads, and that `manifest.json` `icons` / `action.default_icon` files exist as valid PNGs
- Search engines: Baidu, DuckDuckGo, and custom `%s` engines (add / edit / delete)
- Default engine setting, URL/domain jump, shortcut-name Enter with an on-screen hint
- Tab / Shift+Tab engine switch, `/` or type-to-focus when the page has no other focus
- Local search history (20 items, deduped, can be disabled or cleared)
- Open search results in a new tab, plus Ctrl/Cmd+Enter and middle-click
- E2E coverage for the search flow in `tests/search.test.mjs`

### Fixed

- Type-to-search no longer intercepts keys when focus is on a `button`, `a[href]`, `[role=button]`, `summary`, or `[tabindex]`. Space on the + tile, toast Undo, engine buttons, or the todo toggle activates the control instead of inserting a space in the search box. Chinese IME (`Process` / keyCode 229 / `compositionstart`) focuses search without `preventDefault`.

### Changed

- Shortcut, tool, and SSH icons render as real `<a href>` links (middle-click / Ctrl / Cmd open a new tab)
- Escape closes the topmost UI layer (context menu, modal, settings, timezone, calendar, drawer, todos)
- README documents + add, drag reorder, middle-click, undo delete, and Esc
- Replaced the application icon and three bundled default backgrounds with project-owned assets (Apache-2.0; stills and icon composition Created with Grok Imagine; SVG/PNGs hand-traced and rasterized). Saved Pexels preset paths migrate to the matching new images (or fall back to the Bing default) so existing installs do not 404.
- Search logic lives in `search.js`; `home.js` only wires icons into name matching and backup

### Security

- Removed the `tabs` permission; the toolbar popup reads the current page with `activeTab`
- AC7: narrowed extension-page `connect-src` (dropped blanket `https:` / `ws:` / `wss:`; keep Bing, wttr.in, and loopback WebSocket). `img-src` retains `https:` for shortcut favicons and custom wallpaper URLs (product decision). Baidu, DuckDuckGo, and custom engines are navigations, not `connect-src` hosts. Chrome rejects `ws://[::1]:*` as a CSP source, so IPv6 loopback is not listed.

### Breaking

- **SSH gateway URLs are loopback-only.** After dropping blanket `ws:` / `wss:` from `connect-src`, the extension can no longer open a WebSocket to a non-loopback SSH gateway. Saved shortcuts that used another host (LAN IP, hostname, IPv6 `[::1]`, etc.) will fail to connect until the URL is changed to `127.0.0.1` or `localhost`. `SSH_GATEWAY_HOST` must bind loopback (`127.0.0.1` / `localhost`); a non-loopback bind is blocked by CSP.

### Removed

- `contextMenus` permission and the unused page context-menu item “Add Icon”

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
