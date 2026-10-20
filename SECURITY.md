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

Out of scope:

- Vulnerabilities in third-party sites that the user added as shortcuts
- Bing wallpaper images or wttr.in content
- Issues that only apply after the user has already granted extra OS/browser permissions unrelated to OpenTab

Known limitations that are tracked as product work rather than vulnerability reports:

- SSH passwords currently stored in `chrome.storage.local` as plaintext
