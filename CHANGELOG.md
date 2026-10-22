# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Opt-in city weather settings with Celsius/Fahrenheit, manual refresh, 30-minute cache reuse, and a bounded offline fallback; weather state remains local-only.
- Weather unit and mocked-network extension regressions for opt-in privacy, storage failures, cross-tab units and cancelled/late requests.

### Fixed

- Delayed Bing wallpaper responses no longer save an old shortcut workspace over a newly imported backup; importing or changing wallpaper invalidates pending responses.
- Offline wallpaper tests wait for the cached full image instead of racing a fixed delay. Import regressions cover delayed wallpaper responses in the same and a second tab, persisted data, and reload.

### Privacy

- Weather no longer reads device location or falls back to an automatic IP-location request. It is off until explicitly enabled with a saved city, and the unused `geolocation` permission is removed.
- Weather and About settings no longer expose internal development placeholders.

### Existing unreleased additions

- Settings panel section nav (appearance, wallpaper, shortcuts and layout, search, weather placeholder, import/sync, advanced, about): click a section to jump, scroll-spy highlight, and a top tab row below 720px
- Settings search (Chinese/English, case-insensitive) with a 「没有找到」 empty state; Esc clears the query before it closes the panel
- Layout settings: icon size (small/medium/large or 48–96px), columns (auto or 4–12), show/hide names, and grid max width; live CSS-variable preview, persisted, and included in browser sync keys (shards still count stored JSON bytes, BUG-022)
- Per-section and global 「恢复默认」 with the existing in-page confirm and undo toast (shortcuts are left untouched)
- Advanced toggle for SSH / JSON / FIX entries (off by default; existing SSH/tool shortcuts keep it on)
- `layout.js` / `settings-nav.js` plus `specs/iter-7.md`; weather nav/slot reserved for the parallel first-screen iteration
- Built-in HD shortcut icon library (44 Simple Icons tiles, 22 Chinese / 22 international) with letter placeholders when a site is not in the library
- Right-click **更换图标**: re-fetch, upload a local image, or pick a letter placeholder and color
- Idle migration assigns bundled library tiles and compresses oversized data URL icons (`requestIdleCallback`, does not fetch, does not block first paint)
- After `opentab:grid-ready`, unknown-site shortcuts load a remote favicon with a deferred `<img>` (no `fetch`, no `crossorigin`) so first paint stays at 0 third-party icon requests
- `icons.js` owns icon lookup / fetch / compression; `home.js` only wires it
- Import Chrome bookmarks (optional `bookmarks` permission, requested on click) into a new folder/group
- Import the first 12 Chrome most-visited sites (optional `topSites` permission)
- Import Infinity / WeTab / iTab backup files, with an automatic snapshot and one-click undo
- Optional `chrome.storage.sync` for shortcuts, folders/groups, and settings (sharded near the 100KB / 8KB quotas; falls back to local-only when over quota)
- Local storage usage in Settings → 导入与同步
- Bundled `assets/default_background/default.webp` (WebP of `bg-mountain-dawn.jpg` at native 1280×720) as the first-install wallpaper
- Bing daily wallpaper Cache Storage (`opentab-bing-v1`) with once-per-day checks
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
- Desktop folders: hover one shortcut on another for ~500ms to create a folder named 「文件夹」; drop onto a folder to add; both are undoable
- Folder overlay: reorder, drag out to the desktop, inline rename, Esc/outside to close; a folder with one leftover icon dissolves
- Open all: folder middle-click and context menu; in-page confirm when opening more than 10 tabs
- Group tabs above the grid (click, wheel, Alt+1–9, create/rename/delete). Deleting a group asks whether to move icons to the default group or delete them too (undoable)
- `folders.js` groups API (`HOME_GROUP_ID`, `STORAGE_KEYS`, `ensureGroups`, `addGroupRecord`, `removeGroupRecord`, `iconsInGroup`, `assignIconGroup`) for later bookmark import

### Fixed

- Type-to-search no longer intercepts keys when focus is on a `button`, `a[href]`, `[role=button]`, `summary`, or `[tabindex]`. Space on the + tile, toast Undo, engine buttons, or the todo toggle activates the control instead of inserting a space in the search box. Chinese IME (`Process` / keyCode 229 / `compositionstart`) focuses search without `preventDefault`.
- Importing a backup or restoring a snapshot keeps nested folder children (`repairIconGraph` now uses the payload's own folder ids)
- Search Enter on a folder name opens the folder overlay instead of "网址无效"
- Dragging a nested icon onto a group tab dissolves a leftover-1 folder
- Merge-hover timer clears on `dragleave`; group-tab wheel switching is throttled
- Browser sync no longer reloads in a loop: payloads carry `deviceId` and a content hash, local echoes are ignored, pages do not push on load, remote applies re-render in place, and writes are debounced 2s (BUG-016)
- Applying a sync payload merges icons by id and keeps local-only `data:` icon fields (BUG-017)
- Sync shards and quota checks use UTF-8 bytes with 7800-byte chunks (BUG-018)
- Sync shards are sized by stored `JSON.stringify(chunk)` UTF-8 bytes plus the key, so escaped quotes and backslashes cannot blow the 8KB item cap (BUG-022)
- Enabling browser sync on a second device with local shortcuts no longer silently overwrites them; choose 用云端 / 用本机, and 用云端 first writes a local snapshot with an undo toast (BUG-023)
- Applying remote sync data closes an open folder overlay and re-renders from storage
- `currentFolderId` stays on the local device and is not written to `chrome.storage.sync`
- Startup migrates leftover plaintext SSH secrets into the encrypted vault
- Importing or restoring a backup no longer deletes SSH secrets that were only absent from the file (BUG-020)
- Clock no longer flashes the host timezone or 12-hour time over the boot mirror before storage loads (BUG-024)
- Custom layout no longer flashes the 56px default on first grid paint: layout keys are written into the boot mirror, `layout.js` applies them at parse, and `loadState` applies storage before `refreshIconViews` (BUG-030)
- E2E console allowlist is shared and URL-based (`example.com` / `bing.com`); tests no longer blanket-skip `Failed to load resource` (BUG-031)
- Global 「恢复默认」 no longer turns off browser sync; only the import/sync section restore does, and its confirm copy says 会关闭浏览器同步 (BUG-032)
- Auto icon load no longer `fetch()`es third-party favicons (BUG-025); popup/import shortcuts still show a real icon via deferred `<img>` (BUG-026); user `customIconUrl` beats the bundled library (BUG-027); sync strips `iconCacheState` and `chrome-extension:` / `blob:` `customIconUrl` (BUG-028)
- **更换图标** preview follows `--layout-icon-size`; Esc/Tab treat that modal above the settings panel so layout search and icon size controls stay intact

### Changed

- First paint applies theme, wallpaper, clock, and timezone from a local boot mirror (`boot.js`) so placeholder copy never flashes
- Bing wallpaper checks once per day (and at most once per hour when the date has not changed), caches images in Cache Storage, and falls back to the local default when offline
- Shortcut, tool, and SSH icons render as real `<a href>` links (middle-click / Ctrl / Cmd open a new tab)
- Escape closes the topmost UI layer (context menu, modal, folder overlay, inline dialog, settings, timezone, calendar, todos) and restores focus from a stack
- Icon `data-id` selectors use `CSS.escape`
- Folder/group `prompt` / `confirm` / `alert` replaced with in-page controls (the SSH incomplete-config `alert` remains)
- README documents + add, drag reorder, folders, group tabs, middle-click, undo delete, and Esc
- Replaced the application icon and three bundled default backgrounds with project-owned assets (Apache-2.0; stills and icon composition Created with Grok Imagine; SVG/PNGs hand-traced and rasterized). Saved Pexels preset paths migrate to the matching new images (or fall back to the Bing default) so existing installs do not 404.
- Search logic lives in `search.js`; OpenTab backup import/export lives in `import.js`; icon fetch/cache lives in `icons.js`; settings panel in `settings-nav.js` and grid layout in `layout.js`; `home.js` only wires them
- Localized `data:` icons stay in `chrome.storage.local` and backups; `chrome.storage.sync` strips them so another device re-resolves from the bundled library or the site
- New-tab first paint no longer loads third-party favicons (library tile, cached data URL, or letter placeholder only)

### Security

- Removed the `tabs` permission; the toolbar popup reads the current page with `activeTab`
- AC7: narrowed extension-page `connect-src` (dropped blanket `ws:` / `wss:`; keep Bing, wttr.in, and loopback WebSocket). Iter 8 adds `https:` so **更换图标 → 重新抓取** can `fetch()` a site icon; auto load uses `<img>` instead. No new `host_permissions`. `img-src` keeps `https:` (wallpaper) and `blob:` (Bing cache). Baidu, DuckDuckGo, and custom engines are navigations, not `connect-src` hosts. Chrome rejects `ws://[::1]:*` as a CSP source, so IPv6 loopback is not listed.
- SSH / SOCKS passwords and gateway tokens are stripped from backup export and browser sync, and encrypted at rest with a non-extractable IndexedDB `CryptoKey` instead of plaintext in `chrome.storage.local`

### Breaking

- **SSH gateway URLs are loopback-only.** After dropping blanket `ws:` / `wss:` from `connect-src`, the extension can no longer open a WebSocket to a non-loopback SSH gateway. Saved shortcuts that used another host (LAN IP, hostname, IPv6 `[::1]`, etc.) will fail to connect until the URL is changed to `127.0.0.1` or `localhost`. `SSH_GATEWAY_HOST` must bind loopback (`127.0.0.1` / `localhost`); a non-loopback bind is blocked by CSP.

### Removed

- `contextMenus` permission and the unused page context-menu item “Add Icon”
- Left workspace drawer and the 6px left-edge hover that auto-opened it

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

- SSH / SOCKS passwords and gateway tokens are omitted from backup export and browser sync, and are encrypted at rest instead of stored as plaintext in `chrome.storage.local`
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
