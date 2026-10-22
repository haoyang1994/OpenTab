# Workspace persistence and conflicts

OpenTab is a single-browser-profile workspace, not a real-time collaborative editor.

## Saving in more than one tab

A tab saves its changes relative to the workspace it loaded, rather than writing its entire in-memory copy over storage. Core home settings (such as clock and theme) are changed by key; shortcuts, groups and todos are changed by stable item ID. Unchanged fields and unrelated items added or edited elsewhere are retained.

Workspace read/merge/write operations use one same-origin [Web Lock](https://www.w3.org/TR/web-locks/). Home-page edits, popup additions, imports, restores and incoming sync workspace writes use that path. The lock is released after the operation, including on failure or when its owning document closes. This is not a persistent local-storage lease. Independently scoped layout preferences, search settings/history and weather state keep their existing storage behavior; they are not included in this workspace transaction or its conflict guarantees.

## Conflict policy

- Different item IDs can be changed in different tabs without dropping each other's changes.
- Two incompatible edits to the same workspace item’s metadata are rejected rather than silently choosing an older copy. The page reports the conflict; refresh and retry against the current content.
- An old edit cannot resurrect an item deleted in another tab.
- Edit dialogs and undo actions retain their original item/generation intent. Saving an unrelated setting does not make an older draft valid again. If a merged-view refresh rebuilds an active inline group rename, it is cancelled with a notice rather than silently committed.
- Explicit backup or cloud replacement establishes a new workspace generation. A still-open tab cannot replay an old shortcut edit into it. An unrelated setting can still be saved without restoring the old shortcuts.
- Undo applies the inverse of its own changes, not an old full-workspace snapshot. Unrelated later additions are retained; incompatible changes to the affected content cause undo to be refused. A pre-upgrade import-undo record without the matching after-state cannot be safely replayed: it is retained in storage but refused instead of overwriting newer data.

The shortcut add/edit dialog waits for its storage commit before closing. Shortcut deletion and icon-change success notices also follow successful saves. This is not a crash-safe write queue: closing a document while a save is still pending can cancel that uncommitted operation.

No new extension permission or remote service is required. Existing storage data remains readable. The existing SSH-secret vault/storage wrapper remains responsible for encrypting secrets and excluding them from sync and exported backups. SSH passwords and gateway/proxy secrets are separate from the workspace metadata comparison: concurrent secret-only edits retain the vault’s existing last-successful-save behavior. This change does not add collaborative credential editing.

## Regression coverage

`tests/workspace-persistence.test.mjs` exercises merge rules and failure behavior without a browser. `tests/workspace.test.mjs` uses real extension pages and persistent Chromium storage: concurrent additions/renames, stale settings, deletion, same-item conflicts, explicit restore, stale dialogs and undo after an intermediate setting save, explicit inline-rename cancellation, delete/import/sync undo, popup/home additions and closing a lock owner. Assertions check persisted data and reload, not only optimistic UI state. All URLs and data in these tests are synthetic.

These tests do not certify simultaneous multi-device editing or recovery after arbitrary external modification of extension storage. Chrome sync continues to have its separately documented device-level conflict policy.
