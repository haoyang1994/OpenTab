(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSceneWorkspace = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Hidden foundation: importing this module never reads or writes storage.
  const BACKUP_KEY = 'opentab.sceneMigrationBackup';
  const EPOCH_KEY = 'opentab.workspaceEpoch';
  const COLLECTIONS = ['scenes', 'sceneProfiles', 'folders', 'icons', 'todos'];
  const SECRET_FIELDS = ['sshPassword', 'sshGatewayToken', 'sshSocksPassword'];
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
  }
  const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  function error(code, message) { return Object.assign(new Error(message), { name: 'SceneWorkspaceError', code, recoverable: true }); }
  const conflict = () => error('SCENE_CONFLICT', 'The scene changed. Review it before trying again.');

  function create({ workspace, schema, stripSecrets, now = Date.now }) {
    if (!workspace?.transaction || !schema?.validate || typeof stripSecrets !== 'function') throw new TypeError('Scene workspace adapters are required.');
    const previews = new WeakMap(), receipts = new WeakMap();
    const keys = [schema.SCHEMA_KEY, ...COLLECTIONS];
    function changed(before, after) {
      return Object.fromEntries(keys.filter(key => !equal(before[key], after[key])).map(key => [key, clone(after[key])]));
    }
    function apply(state, command, args) {
      if (command !== 'patchProfile') {
        if (!['create', 'rename', 'archive', 'restore', 'moveGroup'].includes(command)) throw error('UNKNOWN_SCENE_COMMAND', 'Unsupported scene operation.');
        return schema[command](state, args);
      }
      schema.project(state, args.sceneId); // Requires an existing, active scene.
      if (!args.changes || typeof args.changes !== 'object' || Array.isArray(args.changes)
        || Object.keys(args.changes).some(key => !schema.PROFILE_KEYS.includes(key))) throw error('INVALID_PROFILE_PATCH', 'Unsupported scene appearance setting.');
      const result = clone(state), profile = result.sceneProfiles.find(item => item.id === args.sceneId);
      Object.assign(profile, clone(args.changes));
      schema.validate(result);
      return result;
    }
    function dependency(state, command, args) {
      const result = { epoch: state[EPOCH_KEY] || 0, version: state[schema.SCHEMA_KEY] };
      const scene = id => state.scenes.find(item => item.id === id) || null;
      if (command === 'create') return result;
      if (command === 'moveGroup') {
        const group = state.folders.find(item => item.id === args.groupId);
        const ids = new Set([args.groupId]);
        let previous;
        do { previous = ids.size; state.folders.forEach(item => { if (ids.has(item.parentId)) ids.add(item.id); }); } while (previous !== ids.size);
        result.groups = state.folders.filter(item => ids.has(item.id));
        result.source = scene(group?.sceneId); result.target = scene(args.targetSceneId);
        result.parent = args.targetParentId ? state.folders.find(item => item.id === args.targetParentId) || null : null;
      } else {
        result.scene = scene(args.sceneId);
        if (command === 'patchProfile') {
          const profile = state.sceneProfiles.find(item => item.id === args.sceneId);
          result.profile = Object.fromEntries(Object.keys(args.changes || {}).map(key => [key, profile?.[key]]));
        }
      }
      return clone(result);
    }
    async function migrate(options = {}, guard) {
      return workspace.transaction(async ({ read, write }) => {
        const before = await read(null);
        const after = schema.migrateLegacy(before, options);
        if (before[schema.SCHEMA_KEY] === schema.VERSION) return { state: before, migrated: false };
        if (Object.hasOwn(before, BACKUP_KEY)) throw error('SCENE_RECOVERY_PRESENT', 'An earlier scene recovery record exists. Recover it before migrating again.');
        // The normal storage wrapper may strip raw credentials before its vault
        // flush succeeds. Never feed it a migration that could lose those values.
        if ((before.icons || []).some(icon => SECRET_FIELDS.some(field => icon?.[field]))) throw error('SCENE_CREDENTIALS_UNPROTECTED', 'Protect the existing local credentials before migrating scenes. Data is unchanged.');
        const savedAt = now();
        if (!Number.isSafeInteger(savedAt) || savedAt < 0) throw error('INVALID_MIGRATION_TIME', 'Invalid recovery timestamp.');
        const backup = { version: 1, createdAt: savedAt, reason: 'before-scene-migration', data: stripSecrets(clone(before)) };
        // Bind explicit activation to the still-valid local draft/view only
        // after acquiring the shared lock. No async predicate may grant access.
        if (guard) {
          const allowed = guard(before);
          if (allowed && typeof allowed.then === 'function') Promise.resolve(allowed).catch(() => {});
          if (allowed !== true) throw conflict();
        }
        // One storage write owns both the intact recovery point and new graph.
        // Quota/write failure must not fall back to pruning assets or snapshots.
        const patch = { ...changed(before, after), [BACKUP_KEY]: backup, [EPOCH_KEY]: (Number(before[EPOCH_KEY]) || 0) + 1 };
        await write(patch);
        return { state: { ...before, ...patch }, migrated: true };
      });
    }
    function prepare(state, command, args = {}) {
      schema.validate(state);
      const chosen = clone(args);
      apply(state, command, chosen); // Validate without modifying the live state.
      const preview = Object.freeze({ command });
      previews.set(preview, { command, args: chosen, dependency: dependency(state, command, chosen) });
      return preview;
    }
    function inverse(before, after) {
      const edits = [];
      for (const key of COLLECTIONS) {
        const old = new Map((before[key] || []).map(item => [item.id, item]));
        const next = new Map((after[key] || []).map(item => [item.id, item]));
        if (old.size !== next.size || [...old.keys()].some(id => !next.has(id))) return null;
        for (const [id, item] of old) {
          const updated = next.get(id);
          for (const field of new Set([...Object.keys(item), ...Object.keys(updated)])) {
            if (!equal(item[field], updated[field])) edits.push({ key, id, field, before: clone(item[field]), after: clone(updated[field]) });
          }
        }
      }
      return edits;
    }
    async function execute(preview, guard) {
      const plan = previews.get(preview);
      if (!plan) throw conflict();
      // Consume before awaiting: duplicate activation must not repeat a command.
      previews.delete(preview);
      return workspace.transaction(async ({ read, write }) => {
        const before = await read(null);
        schema.validate(before);
        if (!equal(plan.dependency, dependency(before, plan.command, plan.args))) throw conflict();
        if (guard) {
          const allowed = guard(before);
          if (allowed && typeof allowed.then === 'function') Promise.resolve(allowed).catch(() => {});
          if (allowed !== true) throw conflict();
        }
        const after = apply(before, plan.command, plan.args), patch = changed(before, after);
        if (Object.keys(patch).length) await write(patch);
        const edits = inverse(before, after), receipt = Object.freeze({ undoable: !!edits?.length });
        if (edits?.length) receipts.set(receipt, { epoch: before[EPOCH_KEY] || 0, edits });
        return { state: { ...before, ...patch }, receipt };
      });
    }
    async function undo(receipt, guard) {
      const plan = receipts.get(receipt);
      if (!plan) throw conflict();
      return workspace.transaction(async ({ read, write }) => {
        // Another queued undo may already have consumed this receipt. Checking
        // only before the lock permits an ABA replay over a later valid edit.
        if (receipts.get(receipt) !== plan) throw conflict();
        const before = await read(null);
        schema.validate(before);
        if ((before[EPOCH_KEY] || 0) !== plan.epoch) throw conflict();
        const after = clone(before);
        for (const edit of plan.edits) {
          const item = after[edit.key].find(value => value.id === edit.id);
          if (!item || !equal(item[edit.field], edit.after)) throw conflict();
          if (edit.before === undefined) delete item[edit.field]; else item[edit.field] = clone(edit.before);
        }
        schema.validate(after);
        const patch = changed(before, after);
        if (guard) {
          const allowed = guard(before);
          if (allowed && typeof allowed.then === 'function') Promise.resolve(allowed).catch(() => {});
          if (allowed !== true) throw conflict();
        }
        if (Object.keys(patch).length) await write(patch);
        receipts.delete(receipt);
        return { ...before, ...patch };
      });
    }
    return { migrate, prepare, execute, undo };
  }
  return { create, BACKUP_KEY, EPOCH_KEY };
}));
