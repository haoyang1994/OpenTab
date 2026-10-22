# OpenTab product roadmap

This is a prioritized plan, not a claim of popularity or completed release validation.
Baseline inspected: `master` at `16c9b9e`, version 1.1.0.

## Product principles

- A calm new tab: fast local first paint, readable light and dark themes, useful defaults, no setup wall.
- User control before features: explicit optional network features, no analytics, no unnecessary permissions.
- Reliability before growth: preserve shortcuts and settings, recover from failures, test real Chrome extension behavior.
- Keep advanced developer tools out of the everyday path.

## This iteration: weather privacy and usefulness

Implemented locally, pending real Chrome extension acceptance and release approval:

- Replace unconditional device geolocation and wttr.in requests with an off-by-default weather setting and manually entered city.
- Remove the now-unused geolocation permission. Do not widen host permissions or CSP.
- Add temperature units, manual refresh, bounded cache, stale-data fallback, request timeout and cancellation.
- Preserve explicitly stored weather preferences; existing installations have no prior weather toggle/city preference to migrate. Other settings and shortcuts are untouched.
- Replace weather/settings development-placeholder prose with user-facing controls and copy.
- Add unit and mocked-network extension regression tests. Weather preferences/cache are local-only, not backed up or synced in this iteration.

Default weather-off does **not** mean the entire extension has zero network traffic. Remote favicons may load after the shortcut grid is ready; explicitly selected Bing wallpaper, searches, and opened shortcuts also use the network.

## Next: trust and everyday usability

1. Complete actual MV3 Chrome acceptance on a supported test machine, including fresh install and upgrade, keyboard/IME, narrow layouts and both themes. Run the full existing and new test suite before release.
2. Audit bookmark import, folder/group editing, backup/restore, sync conflicts and undo end to end with representative data. Make destructive/recovery paths understandable.
3. Polish the first-use path: immediate useful page, concise opt-in customization and clear import entry. Measure local startup behavior, not invasive analytics.
4. Audit accessible labels, focus return/traps, contrast and reduced motion with real keyboard and browser checks.

## Then: release and reach

- Introduce runtime Chinese/English localization rather than mixing hardcoded Chinese UI with English documentation. Keep proper names and search-engine names intact.
- Prepare a reproducible store package excluding development artifacts and gateway-only dependencies. Confirm permissions, privacy disclosure, screenshots and license attribution against the shipped package.
- Resolve the placeholder security-report contact with the repository owner. Do not invent a mailbox or promise an unstaffed response SLA.
- Chrome Web Store publication remains pending according to the baseline README. Packaging, listing and submission need owner review; none are performed by this iteration.
- Use opt-in feedback and reproducible public bug reports to prioritize subsequent work. Popularity is an outcome, not a promise.
