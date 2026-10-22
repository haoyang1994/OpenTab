# Interface languages

OpenTab's main interface supports English and Simplified Chinese. On first use,
it follows the browser language: Chinese language variants select Simplified
Chinese; other languages fall back to English. Settings → Language offers
Follow browser, 中文, and English. The preference is saved locally before the
page refreshes. It changes interface copy, not shortcut titles, group names,
to-do text, imported content, or custom search-engine names.

Chrome extension metadata uses `_locales/en` and `_locales/zh_CN`, with English
as the manifest fallback. Chrome chooses its own toolbar/extension metadata
language; the in-page preference controls OpenTab pages, not Chrome's UI.

## Covered in this iteration

- New-tab clock/date/calendar, search, shortcut add/edit, folders/groups and to-dos.
- Main settings, backup/import/sync controls, conflict and validation messages.
- Optional weather controls/status and the add-current-page popup.
- Main add/edit and Advanced navigation/form labels.

The separate SSH terminal and JSON tool pages are not yet fully localized.
Their existing behavior remains available through Advanced; this iteration does
not claim full bilingual coverage of those separate tools. Website titles,
provider weather descriptions and Bing attribution remain third-party content.
Chinese holiday/lunar annotations are shown only in the Chinese calendar.

## Implementation and safety

`i18n.js` owns language resolution, a local preference/mirror, plain-text
substitution and explicitly annotated static UI. `locales/*-en.js` centralize
English translations using original interface phrases as canonical keys. There
is no broad DOM text replacement or translation of stored data. Callers use
textContent/safe attributes or preserve existing HTML escaping for values.
Missing phrases fall back to their original text; tests reject missing core keys
and inconsistent shared keys/placeholders. Language selection adds no network
request, permission, telemetry, or account requirement.

New installations default to light appearance. Updates and existing workspaces
keep their explicit or implicit theme behavior. This is not an appearance reset.

## Verification

`tests/i18n-unit.test.mjs` covers language selection, unsupported-locale fallback,
explicit preference persistence, storage failures, user values, static/dynamic
catalog completeness, consistent shared phrases and substitution placeholders.
`tests/i18n.test.mjs` uses real Chromium MV3 pages and storage for browser locale,
preference changes/reload/new tabs, core English workflows, data preservation,
Chinese switching and narrow-layout screenshots. Existing regression suites run
with an explicit Chinese browser locale so their established assertions remain
meaningful. All remote test traffic is synthetic/intercepted.
