// Synthetic-only data shared by the real MV3 suite and its Node preflight.
export const SCHEMA_KEY = 'opentab.sceneSchemaVersion';
export const BACKUP_KEY = 'opentab.sceneMigrationBackup';
export const EPOCH_KEY = 'opentab.workspaceEpoch';
export const DEFAULT_SCENE = 'scene-default';
export const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const GRADIENT = 'linear-gradient(135deg, #09203f 0%, #537895 100%)';
export const SECOND_GRADIENT = 'linear-gradient(135deg, #f4fff7 0%, #dcf8e8 52%, #bfeccc 100%)';
export const graphKeys = [SCHEMA_KEY, 'scenes', 'sceneProfiles', 'folders', 'icons', 'todos'];
const site = (id, name, folderId, extra = {}) => ({ id, name, url: `https://${id}.example.com/`, type: 'shortcut', parentId: '', ...(folderId ? { folderId } : {}), ...extra });
export function legacyFixture() {
  return {
    // Home and the first icon's membership are deliberately implicit. Migration
    // may materialize them, but must not replace IDs, order, assets or metadata.
    folders: [{ id: 'research', name: 'Research', custom: { retain: 'group' } }, { id: 'research-child', name: 'Reference', parentId: 'research' }],
    icons: [site('daily-docs', 'Daily Docs', null, { custom: { retain: 'site' }, uploadedIconDataUrl: `data:image/png;base64,${PIXEL}` }),
      site('research-docs', 'Research Docs', 'research'),
      { id: 'reference-folder', name: 'Reference folder', type: 'folder', folderId: 'research', parentId: '' },
      site('nested-docs', 'Nested Docs', 'research', { parentId: 'reference-folder' }),
      site('child-docs', 'Child Docs', 'research-child')],
    todos: [{ id: 'daily-task', text: 'Read the synthetic brief', done: false, custom: { retain: 'todo' } }, { id: 'daily-done', text: 'Previously completed task', done: true }],
    currentFolderId: 'folder-home', background: { type: 'gradient', value: GRADIENT, source: 'gradient' }, bingIndex: 3,
    layoutIconSize: 56, layoutColumns: 0, layoutShowNames: true, layoutMaxWidth: 900,
    themeMode: 'light', languagePreference: 'en', searchEngine: 'google', searchHistory: [], searchHistoryEnabled: false,
    searchSuggestionsEnabled: false, searchOpenInNewTab: false, weatherEnabled: false, particlesEnabled: false,
    developerToolsEnabled: false, browserSyncEnabled: false, minimalMode: false, gradientFlow: false, todoButtonVisible: true, todoPanelOpen: false,
    customLegacyRecord: { retain: ['complete', 'original', 'record'], sshPassword: 'SYNTHETIC_ONLY_NEVER_TRANSMIT' }
  };
}
