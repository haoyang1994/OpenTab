# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.1.x   | Yes       |
| < 1.1   | No        |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

**Preferred:** use GitHub's **Report a vulnerability** button on this repository (Security advisory / private vulnerability reporting).

Private vulnerability reporting has to be turned on by a repository owner in GitHub settings. This project cannot enable that setting from a pull request. If the button is not visible yet, use the backup contact below.

**Backup contact:** `[INSERT CONTACT EMAIL]`

Please include:

- OpenTab version (`manifest.json` `version`)
- Chrome version and operating system
- Impact (for example: credential exposure, unexpected network access, XSS on extension pages)
- Steps to reproduce, or a proof of concept that does not target third parties

## Response targets

- First response: within **7 days**
- We will confirm whether the report is in scope and share a planned next step when we have one

## Scope

In scope:

- The Chrome extension itself (`home.html`, service worker, popup, tool pages, SSH terminal page)
- `ssh-gateway.mjs` (the local WebSocket SSH gateway)

The local SSH gateway (`ssh-gateway.mjs`) requires `SSH_GATEWAY_EXTENSION_ID` (Origin allowlist pinned to this extension) and an access token (`SSH_GATEWAY_TOKEN` or a generated file). It does not load `~/.ssh/id_rsa` unless `SSH_PRIVATE_KEY_PATH` is set explicitly. See README for the full variable list.

Out of scope:

- Vulnerabilities in third-party sites that the user added as shortcuts
- Bing wallpaper images or wttr.in content
- Issues that only apply after the user has already granted extra OS/browser permissions unrelated to OpenTab

`connect-src` on extension pages includes `https:` so **更换图标 → 重新抓取** can `fetch()` a site icon when the user asks. Auto load / idle migration do not call `fetch` for those URLs; they either use the bundled library or a deferred `<img>` without `crossorigin`. There are no extra `host_permissions`. Weather still uses `https://wttr.in` and Bing wallpaper still uses `https://www.bing.com`.

Known limitations that are tracked as product work rather than vulnerability reports:

- SSH / SOCKS secrets are encrypted at rest with AES-GCM. The wrapping key is a non-extractable `CryptoKey` (`generateKey` / `importKey` with `extractable: false`) stored in IndexedDB, not as raw key bytes in `chrome.storage.local` next to the ciphertext. Secrets are never written to JSON backups or `chrome.storage.sync`.
- This is not a defense against a local attacker who can execute as the OpenTab extension, use Chrome’s debugger on this profile, or otherwise get Chrome to unwrap the IndexedDB key for this origin. It only stops the raw wrapping key from sitting beside the vault blob in `chrome.storage.local`.
