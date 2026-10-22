(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSceneSchema = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Pure, deliberately unregistered foundation. Callers own persistence, locks,
  // localized labels, IDs and timestamps. Nothing here reads or writes storage.
  const SCHEMA_KEY = 'opentab.sceneSchemaVersion';
  const VERSION = 2;
  const DEFAULT_SCENE_ID = 'scene-default';
  const HOME_GROUP_ID = 'folder-home';
  const PROFILE_KEYS = Object.freeze(['background', 'bingIndex', 'layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth']);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.prototype.toString.call(value) === '[object Object]'
    && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(Object.getPrototypeOf(value)) === null);

  class SceneSchemaError extends Error {
    constructor(code, path, message) {
      super(message);
      this.name = 'SceneSchemaError';
      this.code = code;
      this.path = path;
      this.recoverable = true;
    }
  }
  function fail(code, path, message) { throw new SceneSchemaError(code, path, message); }
  function object(value, path) {
    if (!record(value)) fail('INVALID_RECORD', path, 'Expected a record.');
  }
  function string(value, path) {
    if (typeof value !== 'string' || !value.trim()) fail('INVALID_STRING', path, 'Expected a nonempty string.');
  }
  function parent(value, path) {
    if (value !== undefined && value !== null && value !== '') string(value, path);
  }
  function timestamp(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_TIMESTAMP', path, 'Expected a nonnegative integer timestamp in milliseconds.');
  }
  function version(state) {
    object(state, 'state');
    if (!own(state, SCHEMA_KEY)) fail('SCHEMA_REQUIRED', SCHEMA_KEY, 'Migrate the legacy state before using scene operations.');
    const value = state[SCHEMA_KEY];
    if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_SCHEMA_VERSION', SCHEMA_KEY, 'The scene schema version is malformed.');
    if (value !== VERSION) fail('UNSUPPORTED_SCHEMA', SCHEMA_KEY, 'The scene schema version is not supported; keep the original data.');
  }

  // Preserve unknown properties, including undefined values and own __proto__
  // keys, rather than lossy JSON serialization. Reject unsupported/cyclic data
  // instead of returning a partial copy. Chrome storage records are plain data.
  function clone(value, path = 'state', ancestors = new Set()) {
    if (value === null || ['undefined', 'string', 'boolean', 'number'].includes(typeof value)) return value;
    if (!Array.isArray(value) && !record(value)) fail('UNSUPPORTED_VALUE', path, 'Expected plain stored data.');
    if (ancestors.has(value)) fail('CYCLIC_DATA', path, 'Stored data must not contain object cycles.');
    ancestors.add(value);
    const result = Array.isArray(value) ? new Array(value.length) : {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(result, key, { value: clone(value[key], `${path}.${key}`, ancestors), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(value);
    return result;
  }
  function records(list, path) {
    if (!Array.isArray(list)) fail('INVALID_LIST', path, 'Expected an array of records.');
    const result = new Map();
    for (let i = 0; i < list.length; i++) {
      const item = list[i], at = `${path}[${i}]`;
      object(item, at); string(item.id, `${at}.id`);
      if (result.has(item.id)) fail('DUPLICATE_ID', `${at}.id`, 'Record IDs must be unique within each collection.');
      result.set(item.id, item);
    }
    return result;
  }
  function profile(value, path) {
    object(value, path); string(value.id, `${path}.id`);
    for (const key of Object.keys(value)) {
      if (key !== 'id' && !PROFILE_KEYS.includes(key)) fail('INVALID_PROFILE_FIELD', `${path}.${key}`, 'Only scene-local appearance fields belong in a scene profile.');
    }
    object(value.background, `${path}.background`);
    string(value.background.type, `${path}.background.type`);
    if (!Number.isSafeInteger(value.bingIndex) || value.bingIndex < 0) fail('INVALID_PROFILE_VALUE', `${path}.bingIndex`, 'Bing index must be a nonnegative integer.');
    for (const [key, min, max] of [['layoutIconSize', 48, 96], ['layoutMaxWidth', 640, 1600]]) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) fail('INVALID_PROFILE_VALUE', `${path}.${key}`, 'Layout value is outside the supported range.');
    }
    if (!Number.isInteger(value.layoutColumns) || (value.layoutColumns !== 0 && (value.layoutColumns < 4 || value.layoutColumns > 12))) fail('INVALID_PROFILE_VALUE', `${path}.layoutColumns`, 'Columns must be zero (auto), or an integer from 4 to 12.');
    if (typeof value.layoutShowNames !== 'boolean') fail('INVALID_PROFILE_VALUE', `${path}.layoutShowNames`, 'Show names must be a boolean.');
  }
  function defaultProfile(id, source = {}, background = { type: 'image', value: 'assets/default_background/default.webp', source: 'preset' }) {
    const defaults = { background, bingIndex: 0, layoutIconSize: 56, layoutColumns: 0, layoutShowNames: true, layoutMaxWidth: 900 };
    return { id, ...Object.fromEntries(PROFILE_KEYS.map(key => [key, clone(own(source, key) ? source[key] : defaults[key], `profile.${key}`)])) };
  }
  function checkCycles(map, path) {
    const visited = new Set();
    for (const item of map.values()) {
      const trail = new Set();
      let current = item;
      while (current && !visited.has(current.id)) {
        if (trail.has(current.id)) fail('PARENT_CYCLE', path, 'Parent links must not form a cycle.');
        trail.add(current.id);
        current = current.parentId ? map.get(current.parentId) : null;
      }
      for (const id of trail) visited.add(id);
    }
  }
  function index(state) {
    version(state);
    const scenes = records(state.scenes, 'scenes');
    const profiles = records(state.sceneProfiles, 'sceneProfiles');
    const folders = records(state.folders, 'folders');
    const icons = records(state.icons, 'icons');
    const todos = records(state.todos, 'todos');
    if (!scenes.has(DEFAULT_SCENE_ID)) fail('DEFAULT_SCENE_REQUIRED', 'scenes', 'The default scene must be retained.');
    const homes = new Set();
    let active = 0;
    for (const [i, scene] of state.scenes.entries()) {
      const at = `scenes[${i}]`;
      if (folders.has(scene.id)) fail('ID_COLLISION', `${at}.id`, 'Scene IDs and group IDs must be distinct.');
      string(scene.name, `${at}.name`); string(scene.iconKey, `${at}.iconKey`); string(scene.homeGroupId, `${at}.homeGroupId`);
      if (scene.archivedAt !== null) timestamp(scene.archivedAt, `${at}.archivedAt`); else active++;
      if (homes.has(scene.homeGroupId)) fail('DUPLICATE_HOME', `${at}.homeGroupId`, 'Each scene must have a distinct home group.');
      homes.add(scene.homeGroupId);
      const home = folders.get(scene.homeGroupId);
      if (!home || home.sceneId !== scene.id) fail('INVALID_HOME', `${at}.homeGroupId`, 'The scene home must be a group in that scene.');
      if (home.parentId) fail('HOME_HAS_PARENT', `${at}.homeGroupId`, 'A scene home must remain at the group root.');
      if (scene.id === DEFAULT_SCENE_ID && scene.homeGroupId !== HOME_GROUP_ID) fail('INVALID_DEFAULT_HOME', `${at}.homeGroupId`, 'The default scene must retain the original Home group ID.');
      if (!profiles.has(scene.id)) fail('PROFILE_REQUIRED', 'sceneProfiles', 'Every scene must have a profile.');
    }
    if (!active) fail('ACTIVE_SCENE_REQUIRED', 'scenes', 'At least one scene must remain active.');
    for (const [i, value] of state.sceneProfiles.entries()) {
      profile(value, `sceneProfiles[${i}]`);
      if (!scenes.has(value.id)) fail('ORPHAN_PROFILE', `sceneProfiles[${i}].id`, 'A profile must belong to an existing scene.');
    }
    for (const [i, group] of state.folders.entries()) {
      const at = `folders[${i}]`;
      string(group.name, `${at}.name`); string(group.sceneId, `${at}.sceneId`); parent(group.parentId, `${at}.parentId`);
      if (!scenes.has(group.sceneId)) fail('SCENE_NOT_FOUND', `${at}.sceneId`, 'The group scene does not exist.');
      if (group.parentId) {
        const above = folders.get(group.parentId);
        if (!above) fail('PARENT_NOT_FOUND', `${at}.parentId`, 'The parent group does not exist.');
        if (above.sceneId !== group.sceneId) fail('CROSS_SCENE_PARENT', `${at}.parentId`, 'Parent and child groups must belong to the same scene.');
      }
    }
    checkCycles(folders, 'folders');
    for (const [i, icon] of state.icons.entries()) {
      const at = `icons[${i}]`;
      if (own(icon, 'sceneId')) fail('ICON_SCENE_FORBIDDEN', `${at}.sceneId`, 'Icons derive their scene through their group.');
      string(icon.folderId, `${at}.folderId`); parent(icon.parentId, `${at}.parentId`);
      if (!folders.has(icon.folderId)) fail('GROUP_NOT_FOUND', `${at}.folderId`, 'The icon group does not exist.');
      // Other icon fields (including upload data and vault references) are opaque.
      if (icon.parentId) {
        if (icon.type === 'folder') fail('NESTED_ICON_FOLDER', `${at}.parentId`, 'Icon folders cannot be nested; group trees remain supported.');
        const above = icons.get(icon.parentId);
        if (!above || above.type !== 'folder') fail('INVALID_ICON_PARENT', `${at}.parentId`, 'The icon parent must be an existing icon folder.');
        if (above.folderId !== icon.folderId) fail('CROSS_GROUP_ICON_PARENT', `${at}.parentId`, 'An icon and its parent must have the same group.');
      }
    }
    checkCycles(icons, 'icons');
    for (const [i, todo] of state.todos.entries()) {
      const at = `todos[${i}]`;
      string(todo.sceneId, `${at}.sceneId`);
      if (!scenes.has(todo.sceneId)) fail('SCENE_NOT_FOUND', `${at}.sceneId`, 'The todo scene does not exist.');
      if (typeof todo.text !== 'string') fail('INVALID_TODO', `${at}.text`, 'Todo text must be a string.');
      if (own(todo, 'done') && typeof todo.done !== 'boolean') fail('INVALID_TODO', `${at}.done`, 'Todo completion must be a boolean when present.');
    }
    return { scenes, profiles, folders, icons, todos };
  }

  function validate(state) { version(state); clone(state); index(state); return true; }

  // The only permitted legacy graph changes are materializing implicit Home and
  // its implicit icon memberships, plus adding scene ownership to groups/todos.
  // Preserve the original top-level appearance keys for a non-destructive bridge;
  // integration must use sceneProfiles as the new appearance source of truth.
  function migrateLegacy(raw, options = {}) {
    object(raw, 'state');
    if (own(raw, SCHEMA_KEY)) { validate(raw); return clone(raw); }
    object(options, 'options');
    if (own(raw, 'scenes') || own(raw, 'sceneProfiles')) fail('PARTIAL_SCHEMA', 'state', 'Scene metadata without a version must be recovered explicitly.');
    const next = clone(raw);
    for (const key of ['folders', 'icons', 'todos']) {
      if (!own(next, key)) next[key] = [];
      records(next[key], key);
      for (const [i, value] of next[key].entries()) {
        if (own(value, 'sceneId')) fail('PARTIAL_SCHEMA', `${key}[${i}].sceneId`, 'Scene ownership without a version must be recovered explicitly.');
      }
    }
    const defaultName = own(options, 'defaultName') ? options.defaultName : 'Default';
    const homeName = own(options, 'homeName') ? options.homeName : 'Home';
    string(defaultName, 'options.defaultName');
    if (!next.folders.some(group => group.id === HOME_GROUP_ID)) {
      string(homeName, 'options.homeName');
      next.folders.unshift({ id: HOME_GROUP_ID, name: homeName });
    }
    for (const group of next.folders) group.sceneId = DEFAULT_SCENE_ID;
    for (const todo of next.todos) todo.sceneId = DEFAULT_SCENE_ID;
    for (const icon of next.icons) {
      if (!own(icon, 'folderId') || icon.folderId === undefined || icon.folderId === null || icon.folderId === '') icon.folderId = HOME_GROUP_ID;
    }
    next.scenes = [{ id: DEFAULT_SCENE_ID, name: defaultName, iconKey: 'home', homeGroupId: HOME_GROUP_ID, archivedAt: null }];
    // Absent legacy storage used home.js's implicit daily Bing background.
    // New scenes instead use the bundled preset, without starting network work.
    next.sceneProfiles = [defaultProfile(DEFAULT_SCENE_ID, next, { type: 'bing', value: '', source: '' })];
    next[SCHEMA_KEY] = VERSION;
    validate(next);
    return next;
  }

  function activeScene(maps, sceneId, path = 'sceneId') {
    string(sceneId, path);
    const scene = maps.scenes.get(sceneId);
    if (!scene) fail('SCENE_NOT_FOUND', path, 'The scene does not exist.');
    if (scene.archivedAt !== null) fail('SCENE_ARCHIVED', path, 'Restore the archived scene before using it.');
    return scene;
  }
  function project(state, sceneId) {
    validate(state);
    const maps = index(state), scene = activeScene(maps, sceneId);
    const folders = state.folders.filter(group => group.sceneId === scene.id), ids = new Set(folders.map(group => group.id));
    return clone({ scene, profile: maps.profiles.get(scene.id), folders, icons: state.icons.filter(icon => ids.has(icon.folderId)), todos: state.todos.filter(todo => todo.sceneId === scene.id) });
  }
  function transform(state, command, apply) {
    validate(state); object(command, 'command');
    const next = clone(state);
    apply(next, index(next));
    validate(next);
    return next;
  }

  // create(state, { id, name, iconKey, homeGroupId, homeName, profile? })
  // profile is a partial set of the six appearance fields, without an id.
  function create(state, command) {
    return transform(state, command, (next, maps) => {
      for (const key of ['id', 'name', 'iconKey', 'homeGroupId', 'homeName']) string(command[key], `command.${key}`);
      if (maps.scenes.has(command.id) || maps.folders.has(command.id)) fail('DUPLICATE_ID', 'command.id', 'The scene ID is already used by a scene or group.');
      if (maps.folders.has(command.homeGroupId) || maps.scenes.has(command.homeGroupId)) fail('DUPLICATE_ID', 'command.homeGroupId', 'The home group ID is already used by a scene or group.');
      if (command.id === command.homeGroupId) fail('ID_COLLISION', 'command.homeGroupId', 'The new scene and its home group need distinct IDs.');
      const appearance = own(command, 'profile') ? command.profile : {};
      object(appearance, 'command.profile');
      for (const key of Object.keys(appearance)) {
        if (!PROFILE_KEYS.includes(key)) fail('INVALID_PROFILE_FIELD', `command.profile.${key}`, 'Only scene-local appearance fields belong in a scene profile.');
      }
      next.scenes.push({ id: command.id, name: command.name, iconKey: command.iconKey, homeGroupId: command.homeGroupId, archivedAt: null });
      next.sceneProfiles.push(defaultProfile(command.id, appearance));
      next.folders.push({ id: command.homeGroupId, name: command.homeName, sceneId: command.id });
    });
  }
  // rename(state, { sceneId, name }); the Home group's existing name stays intact.
  function rename(state, command) {
    return transform(state, command, (_next, maps) => {
      const scene = activeScene(maps, command.sceneId); string(command.name, 'command.name'); scene.name = command.name;
    });
  }
  // archive(state, { sceneId, archivedAt }); caller supplies Unix milliseconds.
  function archive(state, command) {
    return transform(state, command, (next, maps) => {
      const scene = activeScene(maps, command.sceneId); timestamp(command.archivedAt, 'command.archivedAt');
      if (next.scenes.filter(value => value.archivedAt === null).length === 1) fail('LAST_ACTIVE_SCENE', 'command.sceneId', 'The last active scene cannot be archived.');
      scene.archivedAt = command.archivedAt;
    });
  }
  function restore(state, command) {
    return transform(state, command, (_next, maps) => {
      string(command.sceneId, 'command.sceneId');
      const scene = maps.scenes.get(command.sceneId);
      if (!scene) fail('SCENE_NOT_FOUND', 'command.sceneId', 'The scene does not exist.');
      scene.archivedAt = null; // Restoring an active scene is an idempotent no-op.
    });
  }
  // moveGroup(state, { groupId, targetSceneId, targetParentId? })
  // Omitted/null/empty targetParentId means root. IDs and array order stay stable.
  // Todos belong to scenes, not groups, and are deliberately not moved.
  function moveGroup(state, command) {
    return transform(state, command, (next, maps) => {
      string(command.groupId, 'command.groupId');
      const group = maps.folders.get(command.groupId);
      if (!group) fail('GROUP_NOT_FOUND', 'command.groupId', 'The group does not exist.');
      const source = activeScene(maps, group.sceneId), target = activeScene(maps, command.targetSceneId, 'command.targetSceneId');
      if (group.id === source.homeGroupId) fail('HOME_MOVE_FORBIDDEN', 'command.groupId', 'A scene home group cannot be moved.');
      parent(command.targetParentId, 'command.targetParentId');
      const targetParentId = command.targetParentId || null;
      if (targetParentId) {
        const above = maps.folders.get(targetParentId);
        if (!above) fail('PARENT_NOT_FOUND', 'command.targetParentId', 'The target parent group does not exist.');
        if (above.sceneId !== target.id) fail('CROSS_SCENE_PARENT', 'command.targetParentId', 'The target parent must belong to the target scene.');
      }
      const children = new Map();
      for (const item of next.folders) {
        if (!children.has(item.parentId)) children.set(item.parentId, []);
        children.get(item.parentId).push(item.id);
      }
      const moving = new Set([group.id]), queue = [group.id];
      for (let i = 0; i < queue.length; i++) {
        for (const id of children.get(queue[i]) || []) { moving.add(id); queue.push(id); }
      }
      if (moving.has(targetParentId)) fail('PARENT_CYCLE', 'command.targetParentId', 'A group cannot move under itself or a descendant.');
      for (const item of next.folders) if (moving.has(item.id)) item.sceneId = target.id;
      if (targetParentId) group.parentId = targetParentId;
      else if (group.parentId) group.parentId = '';
    });
  }

  return Object.freeze({ SCHEMA_KEY, VERSION, DEFAULT_SCENE_ID, HOME_GROUP_ID, PROFILE_KEYS, SceneSchemaError, migrateLegacy, validate, project, create, rename, archive, restore, moveGroup });
}));
