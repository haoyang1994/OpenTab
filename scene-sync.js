(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSceneSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  // Pure compatibility seam. No storage, migration, UI activation or network.
  const SCHEMA_KEY = 'opentab.sceneSchemaVersion';
  const LAYOUT_KEYS = Object.freeze(['layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth']);
  const SCENE_KEYS = Object.freeze(['id', 'name', 'iconKey', 'homeGroupId', 'archivedAt']);
  const GROUP_KEYS = Object.freeze(['id', 'name', 'parentId', 'type', 'sceneId']);
  // New fields are local by default. In particular do not transport vault refs,
  // resolved/uploaded icons, opaque iconSource objects or future secret fields.
  const SITE_KEYS = Object.freeze(['id', 'name', 'url', 'type', 'folderId', 'parentId', 'customIconUrl', 'emoji', 'toolSubtype', 'sshGatewayUrl', 'sshHost', 'sshPort', 'sshUsername', 'sshSocksHost', 'sshSocksPort', 'sshSocksUsername', 'iconSource', 'librarySlug', 'placeholderLetter', 'placeholderColor', 'iconCandidates']);
  const SECRET_KEYS = ['sshPassword', 'sshGatewayToken', 'sshSocksPassword'];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value;
  const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  const localUrl = value => typeof value === 'string' && /^(?:data|blob|chrome-extension|file):/i.test(value.trim());
  function fail(code = 'INVALID_SCENE_SYNC') { const error = new Error(code); error.code = code; error.recoverable = true; throw error; }
  function schema() {
    const value = typeof module === 'object' && module.exports ? require('./scene-schema.js') : root.OpenTabSceneSchema;
    if (!value) fail('SCENE_SYNC_UNAVAILABLE');
    return value;
  }
  function record(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.toString.call(value) === '[object Object]'; }
  function keys(value, allowed) { if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(); }
  function pick(value, fields) { return Object.fromEntries(fields.filter(key => own(value, key) && value[key] !== undefined).map(key => [key, clone(value[key])])); }
  function protocol(local) {
    if (!record(local)) fail();
    if (own(local, SCHEMA_KEY)) {
      if (local[SCHEMA_KEY] !== 2) fail('UNSUPPORTED_SCENE_SCHEMA');
      schema().validate(local);
      return 2;
    }
    if (own(local, 'scenes') || own(local, 'sceneProfiles') || ['icons', 'folders', 'todos'].some(key => Array.isArray(local[key]) && local[key].some(item => item && own(item, 'sceneId')))) fail('UNSUPPORTED_SCENE_SCHEMA');
    return 1;
  }
  function globalKeys(allowed) { return allowed.filter(key => !LAYOUT_KEYS.includes(key)); }
  function projectSettings(local, allowed) {
    const settings = pick(local, globalKeys(allowed));
    if (own(settings, 'customSearchEngines')) {
      if (!Array.isArray(settings.customSearchEngines)) fail();
      settings.customSearchEngines = settings.customSearchEngines.map(item => pick(item, ['id', 'name', 'template']));
    }
    return settings;
  }
  function projectSite(icon) {
    const next = pick(icon, SITE_KEYS);
    for (const key of Object.keys(next)) {
      if (key === 'iconCandidates') {
        if (!Array.isArray(next[key])) { delete next[key]; continue; }
        next[key] = next[key].filter(value => typeof value === 'string' && /^https:\/\//i.test(value));
      } else if (key === 'iconSource' && typeof next[key] !== 'string') delete next[key];
      else if (['url', 'customIconUrl', 'sshGatewayUrl'].includes(key) && localUrl(next[key])) next[key] = '';
    }
    return next;
  }
  function project(local, allowed, updatedAt = Date.now()) {
    if (protocol(local) !== 2) fail('SCENE_SCHEMA_REQUIRED');
    const payload = {
      v: 2, [SCHEMA_KEY]: 2, updatedAt,
      scenes: local.scenes.map(item => pick(item, SCENE_KEYS)),
      sceneLayouts: local.sceneProfiles.map(item => pick(item, ['id'].concat(LAYOUT_KEYS))),
      folders: local.folders.map(item => pick(item, GROUP_KEYS)),
      icons: local.icons.map(projectSite), settings: projectSettings(local, allowed)
    };
    validatePayload(payload, allowed);
    return payload;
  }
  function defaultProfile(id, layout) {
    const baseline = schema().migrateLegacy({ background: { type: 'image', value: 'assets/default_background/default.webp', source: 'preset' } }).sceneProfiles[0];
    return { ...baseline, id, ...pick(layout, LAYOUT_KEYS) };
  }
  function validatePayload(payload, allowed) {
    keys(payload, ['v', SCHEMA_KEY, 'updatedAt', 'deviceId', 'hash', 'scenes', 'sceneLayouts', 'folders', 'icons', 'settings']);
    if (payload.v !== 2 || payload[SCHEMA_KEY] !== 2) fail('UNSUPPORTED_SCENE_SCHEMA');
    if (!Number.isSafeInteger(payload.updatedAt) || payload.updatedAt < 0) fail();
    for (const key of ['scenes', 'sceneLayouts', 'folders', 'icons']) if (!Array.isArray(payload[key])) fail();
    payload.scenes.forEach(item => keys(item, SCENE_KEYS));
    payload.sceneLayouts.forEach(item => keys(item, ['id'].concat(LAYOUT_KEYS)));
    payload.folders.forEach(item => { keys(item, GROUP_KEYS); if (own(item, 'type') && typeof item.type !== 'string') fail(); });
    payload.icons.forEach(item => {
      keys(item, SITE_KEYS);
      for (const [key, value] of Object.entries(item)) {
        if (key === 'iconCandidates') { if (!Array.isArray(value) || value.some(url => typeof url !== 'string' || !/^https:\/\//i.test(url))) fail(); }
        else if (['sshPort', 'sshSocksPort'].includes(key)) { if (!Number.isInteger(value) || value < 1 || value > 65535) fail(); }
        else if (typeof value !== 'string') fail();
        if (['url', 'customIconUrl', 'sshGatewayUrl'].includes(key) && localUrl(value)) fail();
      }
    });
    keys(payload.settings, globalKeys(allowed));
    for (const [key, value] of Object.entries(payload.settings)) {
      if (key === 'customSearchEngines') {
        if (!Array.isArray(value)) fail();
        value.forEach(item => { keys(item, ['id', 'name', 'template']); if (Object.values(item).some(field => typeof field !== 'string')) fail(); });
      } else if (!['string', 'boolean', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) fail();
    }
    // Layout records are complete, not defaults masquerading as omitted fields.
    payload.sceneLayouts.forEach(item => { if (['id'].concat(LAYOUT_KEYS).some(key => !own(item, key))) fail(); });
    schema().validate({ [SCHEMA_KEY]: 2, scenes: payload.scenes, sceneProfiles: payload.sceneLayouts.map(item => defaultProfile(item.id, item)), folders: payload.folders, icons: payload.icons, todos: [] });
    return true;
  }
  function mergeRecord(remote, local, fields) {
    const next = clone(local || {});
    fields.forEach(key => { delete next[key]; });
    return Object.assign(next, clone(remote));
  }
  function mergeSite(remote, local) {
    const next = mergeRecord(remote, local, SITE_KEYS);
    if (local && localUrl(local.customIconUrl)) next.customIconUrl = local.customIconUrl;
    // Projection redaction is not a user deletion. Retain device-only values
    // unless the remote supplies an actual permissible public replacement.
    if (local) {
      for (const key of ['url', 'sshGatewayUrl']) if (localUrl(local[key]) && !remote[key]) next[key] = local[key];
      if (local.iconSource && typeof local.iconSource === 'object' && !own(remote, 'iconSource')) next.iconSource = clone(local.iconSource);
      if (Array.isArray(local.iconCandidates)) {
        const publicCandidates = local.iconCandidates.filter(value => typeof value === 'string' && /^https:\/\//i.test(value));
        const privateCandidates = local.iconCandidates.filter(value => typeof value !== 'string' || !/^https:\/\//i.test(value));
        if (!own(remote, 'iconCandidates') || equal(remote.iconCandidates, publicCandidates)) next.iconCandidates = clone(local.iconCandidates);
        else if (privateCandidates.length) next.iconCandidates = clone(remote.iconCandidates).concat(clone(privateCandidates));
      }
    }
    if (local && (local.uploadedIconDataUrl || localUrl(local.customIconUrl))) {
      for (const key of ['iconSource', 'librarySlug', 'placeholderLetter', 'placeholderColor']) if (own(local, key)) next[key] = clone(local[key]);
    }
    // Remote secrets are forbidden. Existing local vault references and values
    // remain local; the normal persistence wrapper protects plaintext if present.
    return next;
  }
  function planRemote(local, payload, allowed, archivedAt = Date.now()) {
    if (protocol(local) !== 2) fail('SCENE_SCHEMA_REQUIRED');
    validatePayload(payload, allowed);
    if (!Number.isSafeInteger(archivedAt) || archivedAt < 0) fail();
    const byId = list => new Map(list.map(item => [item.id, item]));
    const localScenes = byId(local.scenes), profiles = byId(local.sceneProfiles), groups = byId(local.folders), icons = byId(local.icons);
    const remoteSceneIds = new Set(payload.scenes.map(item => item.id));
    const recovered = local.scenes.filter(item => !remoteSceneIds.has(item.id));
    const recoveryIds = new Set(recovered.map(item => item.id));
    const recoveryGroups = local.folders.filter(item => recoveryIds.has(item.sceneId));
    const recoveryGroupIds = new Set(recoveryGroups.map(item => item.id));
    const recoveryIcons = local.icons.filter(item => recoveryGroupIds.has(item.folderId));
    if (payload.folders.some(item => recoveryGroupIds.has(item.id)) || payload.icons.some(item => recoveryIcons.some(old => old.id === item.id))) fail('SCENE_RECOVERY_COLLISION');
    const next = clone(local);
    next.scenes = payload.scenes.map(item => mergeRecord(item, localScenes.get(item.id), SCENE_KEYS)).concat(recovered.map(item => ({ ...clone(item), archivedAt: item.archivedAt === null ? archivedAt : item.archivedAt })));
    next.sceneProfiles = payload.sceneLayouts.map(item => ({ ...(clone(profiles.get(item.id)) || defaultProfile(item.id, item)), ...pick(item, LAYOUT_KEYS) })).concat(recovered.map(item => clone(profiles.get(item.id))));
    next.folders = payload.folders.map(item => mergeRecord(item, groups.get(item.id), GROUP_KEYS)).concat(clone(recoveryGroups));
    next.icons = payload.icons.map(item => mergeSite(item, icons.get(item.id))).concat(clone(recoveryIcons));
    Object.assign(next, clone(payload.settings));
    schema().validate(next);
    return { patch: pick(next, ['scenes', 'sceneProfiles', 'folders', 'icons'].concat(Object.keys(payload.settings))), recoveredSceneIds: recovered.map(item => item.id) };
  }
  function inverse(before, after, patch, epochKey) {
    const fields = Object.keys(patch);
    const clean = state => {
      const value = pick(state, fields);
      // Explicit absence is required to undo a newly introduced setting safely.
      fields.forEach(key => { if (!own(value, key)) value[key] = undefined; });
      if (value.icons) value.icons.forEach(item => SECRET_KEYS.forEach(key => delete item[key]));
      value[epochKey] = after[epochKey];
      return value;
    };
    const undoable = fields.every(key => ['scenes', 'sceneProfiles', 'folders', 'icons'].includes(key) || own(before, key) || equal(before[key], after[key]));
    return { v: 2, undoable, reason: undoable ? null : 'SETTING_ABSENCE', before: clean(before), after: clean(after) };
  }
  function undoEntities(after, before, latest, fields, profile = false) {
    const map = list => new Map(list.map(item => [item.id, item]));
    const old = map(after), chosen = map(before), current = map(latest);
    for (const id of new Set([...old.keys(), ...chosen.keys()])) {
      const a = old.get(id), b = chosen.get(id), live = current.get(id);
      if (equal(a, b)) continue;
      if (!a || !b) {
        if (!equal(live, a) && !equal(live, b)) fail('WORKSPACE_CONFLICT');
        if (b) current.set(id, clone(b)); else current.delete(id);
        continue;
      }
      if (!live) fail('WORKSPACE_CONFLICT');
      const value = clone(live);
      for (const key of fields) {
        if (fields === SITE_KEYS && ((key === 'customIconUrl' && localUrl(live.customIconUrl)) || (['iconSource', 'librarySlug', 'placeholderLetter', 'placeholderColor'].includes(key) && (live.uploadedIconDataUrl || localUrl(live.customIconUrl))))) continue;
        if (equal(a[key], b[key])) continue;
        if (!equal(live[key], a[key]) && !equal(live[key], b[key])) fail('WORKSPACE_CONFLICT');
        if (own(b, key)) value[key] = clone(b[key]); else delete value[key];
      }
      current.set(id, value);
    }
    const shared = after.filter(item => chosen.has(item.id)).map(item => item.id);
    const desired = before.filter(item => old.has(item.id)).map(item => item.id);
    const liveShared = latest.filter(item => old.has(item.id) && chosen.has(item.id)).map(item => item.id);
    let order = latest.map(item => item.id).filter(id => current.has(id));
    if (!equal(shared, desired)) {
      if (!equal(liveShared, shared) && !equal(liveShared, desired)) fail('WORKSPACE_CONFLICT');
      order = before.map(item => item.id).filter(id => current.has(id)).concat(order.filter(id => !chosen.has(id)));
    }
    for (const item of before) if (current.has(item.id) && !order.includes(item.id)) {
      const anchor = before.slice(before.indexOf(item) + 1).find(next => order.includes(next.id));
      if (anchor) order.splice(order.indexOf(anchor.id), 0, item.id); else order.push(item.id);
    }
    return order.map(id => current.get(id));
  }
  function planUndo(local, undo, epochKey, allowed) {
    if (protocol(local) !== 2 || !undo || undo.v !== 2 || undo.undoable === false || !undo.before || !undo.after || local[epochKey] !== undo.after[epochKey]) fail('WORKSPACE_CONFLICT');
    const next = clone(local), a = undo.after, b = undo.before;
    const entities = { scenes: SCENE_KEYS, sceneProfiles: LAYOUT_KEYS, folders: GROUP_KEYS, icons: SITE_KEYS };
    for (const [key, fields] of Object.entries(entities)) next[key] = undoEntities(a[key], b[key], local[key], fields, key === 'sceneProfiles');
    for (const key of globalKeys(allowed)) if (own(b, key) && !equal(a[key], b[key])) {
      if (!equal(local[key], a[key]) && !equal(local[key], b[key])) fail('WORKSPACE_CONFLICT');
      next[key] = clone(b[key]);
    }
    try { schema().validate(next); } catch (_) { fail('WORKSPACE_CONFLICT'); }
    return Object.fromEntries(Object.keys(next).filter(key => !equal(next[key], local[key])).map(key => [key, next[key]]));
  }
  return { SCHEMA_KEY, LAYOUT_KEYS, SITE_KEYS, protocol, project, validatePayload, planRemote, inverse, planUndo };
}));
