# Vendored browser runtime libraries

OpenTab is loaded from the repository root as an unpacked Chrome extension.
`node_modules/` is gitignored, so the new-tab page cannot depend on files that
only appear after `npm install`.

This directory holds the **minimum browser files** referenced by `home.html`
and `ssh_terminal.html`. It is not a copy of `node_modules`.

| Package | Version | License | Files used at runtime |
|---|---|---|---|
| [flatpickr](https://www.npmjs.com/package/flatpickr) | 4.6.13 | MIT (`flatpickr/LICENSE.md`) | `flatpickr.min.css`, `flatpickr.min.js`, `l10n/zh.js` |
| [xterm](https://www.npmjs.com/package/xterm) | 5.3.0 | MIT (`xterm/LICENSE`) | `xterm.css`, `xterm.js` |
| [xterm-addon-fit](https://www.npmjs.com/package/xterm-addon-fit) | 0.8.0 | MIT (`xterm-addon-fit/LICENSE`) | `xterm-addon-fit.js` |

**The versions in this table (and the LICENSE files next to each copy) are the
source of truth** for what the unpacked extension actually loads. `package.json`
may list the same packages for SSH-gateway / test tooling, but bumping npm
without recopying into `vendor/` does not change runtime files.

Source map files (`*.js.map`) are intentionally not vendored.

SSH gateway / tests still need `npm install` (`ssh2`, `ws`, `socks`, Playwright).
Loading the extension does not.

## Updating a vendored copy

1. Install the desired package version (for example via `npm install`).
2. Copy only the files listed above from `node_modules/<package>/` into this tree.
3. Refresh the matching `LICENSE` file from that package, and update the version
   in the table above — that table is canonical.
4. Do not vendor source maps (`*.js.map`), TypeScript sources, extra locales, or
   the rest of `node_modules`.
