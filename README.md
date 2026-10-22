<div align="center">

# OpenTab

A Chrome Manifest V3 new tab page with an iPad-style glass UI. Open source and auditable.

**English** | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/haoyang1994/OpenTab/actions/workflows/ci.yml/badge.svg)](https://github.com/haoyang1994/OpenTab/actions/workflows/ci.yml)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-brightgreen.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-1.1.0-orange.svg)](manifest.json)

</div>

---

## Introduction

OpenTab replaces `chrome://newtab` with a local, customizable homepage: clock, shortcuts, search, weather, and a few developer tools. Settings stay on your machine.

First paint applies the saved theme, clock, and wallpaper from a local boot mirror so placeholder copy never flashes. First install uses a bundled `default.webp` and does not call Bing until you choose Bing wallpaper.

## Features

### Clock and calendar

- Glass clock card with 12-hour / 24-hour formats
- 23 common time zones
- Optional seconds
- Calendar popover with holidays and Chinese solar terms

### Theme

- Dark, light, or follow the system
- Six accent presets (aurora blue, dream purple, sunset orange, mint, sakura, starry blue)
- Optional particle overlay and slow gradient motion
- Minimal mode (double-click the clock)
- Adjustable panel opacity, blur, and shortcut frames

### Backgrounds

- Bundled default wallpaper (`default.webp`) that works offline; first install does not call Bing
- Bing daily wallpaper that refreshes once per day and caches locally (recent history via the refresh button)
- Preset gradients
- Three original bundled stills (mountain dawn, golden forest, night coast) plus `default.webp`
- Custom image or video URL, or a local file upload

### Shortcuts

- **Add with +**: a persistent + tile at the end of the current group grid (or right-click empty space)
- **Drag to reorder**: mouse drag on the desktop grid, or Alt+←/→ when a shortcut is focused
- **Folders**: hover one shortcut on another for about 500ms to make a folder named 文件夹 (undoable). Drop onto an existing folder to add. Click a folder to open an overlay where you can reorder, drag out, and rename. Middle-click or **Open all** opens every link (confirms in-page above 10). A folder with one leftover icon dissolves.
- **Groups**: tabs above the grid (click, mouse wheel, Alt+1–9). Create, rename, and delete groups in-page; deleting asks whether to move icons to the default group or delete them too (undoable). The old left drawer and 6px edge hover are gone.
- **Icons**: bundled HD tiles for 40+ common sites; other sites get a letter placeholder (color from the domain). Right-click **更换图标** to re-fetch, upload a picture, or change the placeholder. Cached as local data URLs so a new tab does not contact those sites
- **Real links**: middle-click / Ctrl / Cmd opens a new tab; hover shows the URL
- **Undo delete**: deleting a shortcut shows a toast with Undo for 6 seconds
- **Esc**: closes menus, dialogs, folder overlay, settings, and calendar one layer at a time and restores focus
- Built-in SSH terminal (needs the local gateway described below)
- Local JSON formatter and FIX parser
- Toolbar popup to save the current tab as a shortcut (choose a group)

### Search, weather, todos, backup

- Search engines: Google, Bing, Baidu, DuckDuckGo, GitHub, plus custom `%s` engines
- Type a URL or domain to open it; Enter on an exact shortcut name opens that shortcut
- Tab / Shift+Tab cycles engines; `/` or typing focuses search when nothing else is focused
- Local search history (up to 20 items, can be disabled or cleared)
- Option to open search results in a new tab (also Ctrl/Cmd+Enter and middle-click)
- Optional weather: off by default. Enable it and save a city in Settings → Weather; choose °C / °F or refresh manually. No device location is read. Fresh weather is cached for 30 minutes, with up to 24-hour-old data retained during an outage. Weather preferences and cache stay local, outside sync and JSON backups.
- Side-drawer todos with a progress bar
- JSON backup export/import and a local snapshot
- Import Chrome bookmarks, most-visited sites, and Infinity / WeTab / iTab backups (bookmark/topSites permissions are optional and requested only when you click)
- Optional Chrome sync for shortcuts, folders, and settings (not wallpapers, history, or the open folder); turning it on when another device already has data asks 用云端 / 用本机. Settings shows local storage usage

### Settings and layout

- Section nav: appearance, wallpaper, shortcuts and layout, search, weather, import/sync, advanced, about. Click a section to jump; the highlight follows scroll. Below 720px the nav becomes a top tab row
- Search box at the top of the panel filters by labels and help text (Chinese or English, case-insensitive). Empty state: 「没有找到」. Esc clears the query, then closes the panel
- Layout: icon size (small/medium/large, or 48–96px), columns (auto or 4–12), show/hide names, grid max width. Changes preview live, survive reload, and join the existing sync keys
- Each section and the footer have 「恢复默认」 (in-page confirm + the same undo toast). Shortcuts are not reset
- SSH / JSON / FIX add-icon entries stay hidden until Advanced is on. Installs that already have SSH or tool shortcuts keep the toggle on

## Screenshots

The frames contain Google / GitHub marks, which remain trademarks of their owners. See [NOTICE](NOTICE).

### Dark theme

![Dark theme preview](screenshots/preview-dark.png)

### Light theme

![Light theme preview](screenshots/preview-light.png)

### Settings panel

![Settings panel](screenshots/settings-panel.png)

## Privacy

- Preferences, shortcuts, todos, snapshots, and search history are stored in `chrome.storage.local` on this browser profile. Optional Chrome sync copies shortcuts, folders, and settings only (not wallpapers, todos, search history, the current folder, or SSH secrets). Bing wallpaper cache metadata stays in `chrome.storage.local` (it is not synced and is omitted from JSON backups). If this device already has shortcuts, enabling sync asks whether to keep local or cloud data and snapshots local before a cloud overwrite. Downloaded JSON backups omit search history by default.
- The search box does not fetch suggestions or typeahead from any engine.
- Bookmarks and most-visited sites are `optional_permissions`: Chrome does not prompt for them at install. OpenTab requests each one when you click the matching import button.
- OpenTab does not include analytics, ads, or account login.
- OpenTab does not rewrite or intercept links you open.
- The extension does request a small set of hosts for optional features:

| Service | Purpose | Data |
| --- | --- | --- |
| Bing homepage image API (`www.bing.com`) | Daily wallpaper, **only if you choose Bing wallpaper** | Image URL/metadata. Photo copyright stays with the original authors; OpenTab only displays the image. First install uses a local wallpaper and does not contact Bing. |
| [wttr.in](https://wttr.in) | Weather pill, only after enabling and saving a city | The city you enter and your network IP. No device coordinates or automatic IP-location fallback. Turning weather off aborts pending requests and stops refreshes. No geolocation permission is requested. |
| Favicons of sites you add | Shortcut icons | First paint stays local (library tile, cached data URL, or letter). After the grid is ready a normal `<img>` may load that site’s icon (no `fetch`, no CORS). `fetch()` happens only if you click 重新抓取. `connect-src` includes `https:` for that explicit refresh, without extra `host_permissions`. |

SSH connections go through a **local** WebSocket gateway you start yourself (`ssh-gateway.mjs`). They are not proxied by an OpenTab cloud service.

## Install

### Load an unpacked extension (current supported method)

Clone the repository and load it. **`npm install` is not required** to use the new tab page. Calendar (flatpickr) and the SSH terminal (xterm) load from [`vendor/`](vendor/README.md), which is committed with each library's LICENSE file.

1. Clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repository root.
5. Open a new tab.

`npm install` / `npm ci` is only needed to run automated tests or to start the local SSH WebSocket gateway.

### Chrome Web Store

Not published yet.

## Development

```bash
npm ci
npm run pw:install
npm test
npm run test:ssh-gateway
npm run test:e2e:headed
npm run test:e2e:headless
npm run test:ci
```

`npm test` runs `tests/repo-hygiene.test.mjs`, then `tests/import-sync.test.mjs`, then `tests/first-screen-unit.test.mjs`, then `tests/layout.test.mjs`, then SSH gateway security tests (`npm run test:ssh-gateway`), then the Playwright E2E suite (`scripts/run-e2e.sh`: `extension`, `search`, `first-run`, and `settings-layout`). On Linux without a display, that script wraps headed Chromium with `xvfb` (install the `xvfb` package). `npm run test:ci` is the same command. Details: [docs/TESTING.md](docs/TESTING.md).

After you change extension files, click **Reload** on the extension card in `chrome://extensions/`.

## SSH gateway

SSH needs a local WebSocket gateway. The gateway **only accepts this extension** (`chrome-extension://<extension-id>`) and requires an access token. It does **not** load `~/.ssh/id_rsa` unless you set `SSH_PRIVATE_KEY_PATH`.

1. Open `chrome://extensions`, enable Developer mode, and copy the OpenTab extension ID.
2. Start the gateway:

```bash
npm install

# Required: pin the Origin allowlist to this extension, or the gateway will refuse to start
export SSH_GATEWAY_EXTENSION_ID='your-extension-id'

# Optional: explicit private key. If unset, only the password on the SSH shortcut is used.
# export SSH_PRIVATE_KEY_PATH="$HOME/.ssh/id_ed25519"
# export SSH_PRIVATE_KEY_PASSPHRASE='if any'

npm run ssh:gateway
```

3. The first start prints an **access token** (later starts only print the token file path). Put it in the OpenTab SSH shortcut field “网关访问令牌”.
4. Use gateway URL `ws://127.0.0.1:8787/ssh` (or `ws://localhost:8787/ssh`). **Loopback only (`127.0.0.1` / `localhost`):** the extension CSP allows WebSocket only to those hosts. A saved non-loopback gateway URL (including `[::1]`) will be blocked.

The gateway will not start without an extension ID. Arbitrary websites (and clients without an Origin header) cannot connect. A missing or wrong token is rejected at handshake.

Environment variables:

- `SSH_GATEWAY_HOST` — bind host (default `127.0.0.1`). **Loopback only:** `127.0.0.1` or `localhost`. The extension cannot connect to a non-loopback bind.
- `SSH_GATEWAY_PORT` — bind port (default `8787`)
- `SSH_GATEWAY_PATH` — WebSocket path (default `/ssh`)
- `SSH_GATEWAY_EXTENSION_ID` — this extension ID (**required**; Origin allowlist; refuses to start if unset)
- `SSH_GATEWAY_ALLOWED_ORIGINS` — optional comma-separated `chrome-extension://...` list
- `SSH_GATEWAY_TOKEN` — fixed access token; if unset, one is generated and written to `~/.config/opentab/ssh-gateway.token`
- `SSH_GATEWAY_TOKEN_FILE` — token file path
- `SSH_PRIVATE_KEY_PATH` — **explicit** private-key path; omitting it does **not** fall back to `~/.ssh/id_rsa`
- `SSH_PRIVATE_KEY_PASSPHRASE` — key passphrase, if any

SOCKS5 proxies are supported from the shortcut editor. SSH / SOCKS passwords and gateway tokens are encrypted with AES-GCM. The wrapping `CryptoKey` is generated with `extractable: false` and stored in IndexedDB (not exported as raw bytes next to the ciphertext). Remaining risk: anyone who can run code as this extension (or read this profile’s IndexedDB and storage while Chrome will still unwrap the key for the extension) can still decrypt secrets. Backups and `chrome.storage.sync` never include those secrets.

Upgrading existing SSH shortcuts:

- **Breaking:** Gateway URLs must be `127.0.0.1` or `localhost`. Non-loopback hosts (including `[::1]`) are blocked by CSP.
- Each old SSH shortcut needs a gateway access token, or it cannot connect to the new gateway.
- The gateway no longer defaults to `~/.ssh/id_rsa`. Set `SSH_PRIVATE_KEY_PATH` if you still log in with a key.
- You must set `SSH_GATEWAY_EXTENSION_ID` (OpenTab’s ID on `chrome://extensions`).

## Project structure

```
OpenTab/
├── LICENSE / NOTICE / CHANGELOG.md
├── README.md / README.zh-CN.md
├── CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md
├── manifest.json
├── package.json
├── background.js              # service worker
├── home.html / home.css / home.js
├── boot.js                    # first-paint boot mirror (theme, clock, wallpaper, layout)
├── bing-cache.js / lib/bing-daily.js
├── search.js                  # new-tab search box (engines, history, URL jump)
├── folders.js                 # desktop folders and group tabs
├── import.js / sync.js        # backup import and chrome.storage.sync
├── icons.js                   # shortcut icon library, cache, 更换图标
├── layout.js / settings-nav.js
├── specs/                     # iteration acceptance criteria
├── popup.html / popup.css / popup.js
├── tool.html / tool.css / tool.js
├── fixparser.html / fixparser.js
├── ssh_terminal.html / ssh_terminal.css / ssh_terminal.js
├── ssh-gateway.mjs            # local SSH WebSocket gateway
├── vendor/                    # vendored flatpickr / xterm (with LICENSE files)
├── icons/                     # PNG icons + SVG source
├── assets/default_background/ # original bundled stills
├── screenshots/
├── tests/
├── docs/                      # SPEC (historical), testing, releases
└── .github/                   # issue/PR templates and CI
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). By submitting a change you agree it is licensed under Apache-2.0 (inbound = outbound). There is no CLA.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

Third-party software, photos, trademarks, and other materials are listed in [NOTICE](NOTICE). Some of those items are **not** licensed under Apache-2.0.
