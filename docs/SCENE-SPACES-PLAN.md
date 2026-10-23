# Scene spaces: implementation and release contract

Status: integrated on the feature branch, pending final validation. This is no
longer an inert foundation-only plan. The home runtime, scene manager, projection
adapters, popup, search, backup, and sync paths are integrated. This status does
not claim a published version, Chrome Web Store release, complete browser
verification, or a passing full CI run for the final integrated commit.

User-facing behavior and limitations are documented in the bilingual
[scene guide](SCENE-SPACES.md) and both READMEs.

## Product boundary

A scene owns groups, their sites, tasks, its background/Bing index, and four
layout values: icon size, columns, name visibility, and maximum width. Switching
selects a view of the complete workspace; it never restores a snapshot or
replaces full data arrays with the visible subset. Existing IDs, order, uploaded
icons, and secret-vault references survive migration. Theme, accent, opacity,
blur, privacy, weather, search, history, timezone, and task-button visibility stay
global. The focus timer remains per tab and does not reset on a scene change.

Activation is lazy and explicit: loading a legacy workspace or opening the
introduction does not migrate it. **Enable scenes** follows a warning about the
format upgrade, unsafe same-profile downgrade, updating other devices, and
exporting a backup first. Enabling does not opt into sync, upload a backup, add
permissions, or create an account.

The integrated flow includes creating/naming scenes, selecting one, archiving and
restoring without deletion, and moving an existing non-Home group with its child
groups and sites. Tasks stay in the source scene. At least one unarchived scene
must remain. Scene selection is tab-local; a device default only initializes new
tabs. Search and the command palette label destinations across active scenes,
and the popup has an explicit scene/group destination.

## Integration boundaries

1. **Foundation, integrated:** deterministic schema migration, validation and
   entity operations. Original graph identities remain intact; implicit Home is
   materialized only when required.
2. **Persistence protection, integrated:** full-workspace merge/intent support,
   atomic secret-sanitized migration recovery, full scene backup/restore, and
   separate v2 sync protocol handling.
3. **Experience, integrated:** scoped rendering/background/layout, tab-local
   selection, switcher/management, popup and command-palette destinations. Drafts,
   pending saves, stale views, and late background results have guarded boundaries.
4. **Release validation, pending:** run the final integrated artifact through all
   acceptance checks below. Tests being present or a focused test passing is not
   evidence that every browser flow or the final release artifact passed. Publish
   one coherent feature PR only after validation; do not ship a data-changing
   foundation by itself.

## Data and compatibility invariants

- Persist all icons, groups, and tasks, including archived scenes. Groups and
  tasks carry `sceneId`; icons derive membership from the existing group ID.
- `scenes` and `sceneProfiles` are collections of ID-keyed records under the
  existing workspace lock. Profiles own only background, Bing index and four
  layout values; unrelated settings remain global.
- A missing legacy schema migrates once to the fixed default scene, preserving
  `folder-home`. A complete supported schema is idempotent. Malformed, partial,
  or unknown schemas fail closed without legacy normalization or mutation.
- Group parent relationships cannot cross scenes. Whole-group moves preserve
  descendants, site IDs and ordering instead of duplicating records. A scene's
  Home group cannot move.
- Archive undo changes archive state; group-move undo changes relevant ownership.
  Neither restores a stale whole-workspace snapshot over unrelated later edits.
- View-dependent intents capture scene identity and generation. Stale drag,
  selection, modal, import, popup, and background completions cannot target a
  different scene. Pending saves drain before navigation; unsaved drafts require
  completion/cancellation, or an explicit discard where recovery offers it.
- Each tab retains its own scene and per-scene group selection. Shared last-opened
  hints must not override an existing tab's view.
- Existing sync opt-in is preserved. v2 uses an independent namespace. The new
  scene-specific sync data is metadata, group ownership, sites, and four layout
  fields. The existing global-settings allowlist is unchanged. Tasks, backgrounds,
  Bing selection, uploaded/local icon data, history, tab selection and secrets
  are excluded. Local-only scenes omitted remotely are retained as archived
  recovery scenes, not silently removed.
- Once scene data is active, v1 payloads cannot replace the multi-scene graph.
  Old devices remain on v1, separate from v2. This isolation is not a guarantee
  that old application code is safe against the same local browser profile.

## Migration recovery and downgrade

Activation creates a full secret-sanitized local recovery record in the same
workspace transaction and storage write as the migration and epoch change.
Existing compact manual snapshots omit uploaded/local icon data and are not a
substitute. The migration recovery retains those assets without duplicating
plaintext credentials or replacing the secret vault. Quota/write failure must
preserve the legacy graph, not prune content to make room.

The migration recovery record is not exposed as a dedicated one-click restore
button. The user-facing recommendation is to download a full JSON backup before
enabling. Scene exports include active and archived scene graphs, profiles,
tasks and stored local assets; secrets are stripped and search history is
excluded by default. Weather preferences/cache and Bing cache metadata remain
outside JSON exports.

Explicit restore replaces the complete ownership graph and changes the workspace
epoch. A legacy backup restored into a scene-enabled app becomes one default
scene; it does not disable the schema or merge post-backup edits. Explicit
backup restores and **Use cloud copy** decisions retain full local recovery
snapshots rather than compact icon-stripped ones. Automatic sync does not create
a snapshot for every update. Do not automatically restore a migration backup
over newer work.

An unknown/newer schema blocks editing with a clear update-and-retry message;
malformed data remains preserved with a recovery error. Retrying is not a schema
converter. Return to a compatible build before an explicit user-selected restore.
The new app cannot retroactively make older builds enforce fail-closed behavior.
Therefore same-profile downgrade after activation is unsafe, even though sync
namespaces are separated; no safe old-app fallback or one-click disable is
promised.

## Size-budget scope correction

The approved correction changes what the added-files gate measures, not its
numeric threshold. The ceiling remains **300 KiB (300 × 1024 bytes)**, now applied
to newly added shipped runtime files in the reviewed release allowlist. Tests,
documentation, and developer helpers do not ship and are excluded from that
increment. Existing runtime files still participate in packaging validation;
this particular gate measures additions, not total package size.

Runtime classification matches the release packager, including dynamically used
assets and runtime directories. A newly added runtime file missing from the
allowlist is an error, not an excluded file. Missing/non-regular allowlisted
files also fail. The negative controls cover an oversized shipped file, summed
dynamic assets, an omitted runtime file, and missing allowlist entries; an
exactly-at-limit payload passes and equally large non-shipped docs/tests are
excluded. Duplicated Git paths are counted once.

All other numeric quality gates remain unchanged, including the existing
`home.js` baseline/no-growth check and browser performance ceilings. The correction
does not authorize increasing budgets, dropping regression suites, relaxing
assertions, or substituting a test inventory for a real release-validation run.

## Release validation still required

Run these checks against the final integrated commit, recording exact results
and blockers rather than marking them complete based on source inspection:

- Empty and legacy workspaces, implicit Home, nested groups, SSH references and
  uploaded icons migrate atomically/idempotently without ID or ordering loss.
  Merely opening/canceling the introduction does not migrate.
- Projection/switching preserve inactive records and global settings; independent
  backgrounds, layout and tasks survive switch/reload. Focus remains per tab.
- Two tabs keep different scenes. Disjoint edits merge; stale same-entity actions,
  replacement epochs, archived destinations and delayed draft operations reject.
- A delayed Bing response cannot paint or persist into a different selected
  scene. Popup saves, cross-scene search and palette group navigation revalidate
  their destinations.
- New backups round-trip all scenes and stored local assets. Old backups become
  one default scene only through explicit full restore. Secrets remain excluded;
  compact snapshots are not represented as full asset recovery.
- v1 apply, unknown schemas and failed migration writes preserve existing data.
  v2 payload/negative tests prove tasks, backgrounds, uploads and secrets are
  absent. Local-only scenes survive a remote omission as archived recovery data.
- Native keyboard/pointer flows, unsaved drafts, repeated/late actions,
  reduced-motion, long names and 360px English/Chinese layouts pass. Review
  screenshots rather than assuming DOM assertions establish visual quality.
- Run `npm test` / `npm run test:ci`, including packaging, unit/security and all
  canonical E2E suites, plus the existing audit. Run the unchanged size gates and
  their negative controls. No claim of full CI success until that exact run ends.
- Package the final allowlisted artifact and run the extracted-ZIP smoke test.
  Validate that runtime assets are included and that no development-only files
  or new permissions have entered the package. No store publication is implied.
