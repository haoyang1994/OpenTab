import path from 'node:path';

const layoutKeys = ['layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth'];
export const sceneDiagnosticGlobals = ['themeMode', 'searchEngine', 'searchHistoryEnabled', 'todoButtonVisible', 'browserSyncEnabled'];
const scalar = value => typeof value === 'string' ? value.slice(0, 160) : typeof value === 'boolean' || typeof value === 'number' ? value : null;
const pick = (source, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(source || {}, key)).map(key => [key, scalar(source[key])]));
export function diagnosticBackground(background) {
  if (!background) return null;
  // Never log wallpaper URLs, uploaded images, arbitrary metadata or secrets.
  return { ...pick(background, ['type', 'source']), value: /^linear-gradient\([#(),.%\s\w-]+\)$/.test(background.value || '') ? background.value.slice(0, 500) : '[omitted non-gradient background]' };
}
export function diagnosticProfile(profile) {
  if (!profile) return null;
  return { ...pick(profile, ['id', 'bingIndex', ...layoutKeys]), ...(profile.background ? { background: diagnosticBackground(profile.background) } : {}) };
}
export function diagnosticStorage(data) {
  return { ...pick(data, ['opentab.sceneSchemaVersion', ...sceneDiagnosticGlobals]), profiles: (Array.isArray(data?.sceneProfiles) ? data.sceneProfiles : []).slice(0, 8).map(diagnosticProfile) };
}
export async function boundedDiagnostic(read, timeout = 1500) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(read), new Promise(resolve => { timer = setTimeout(() => resolve({ unavailable: 'diagnostic deadline' }), timeout); })]);
  } catch (error) { return { unavailable: error?.name || 'diagnostic read failed' }; }
  finally { clearTimeout(timer); }
}

export function createSceneDiagnostics({ phase, page, storage, artifacts, log = message => console.error(message) }) {
  let lastAwait = null;
  return {
    reset() { lastAwait = null; },
    async wait(name, expected, run, readActual) {
      lastAwait = { name, status: 'pending', expected };
      try { const result = await run(); lastAwait.status = 'passed'; return result; }
      catch (error) {
        lastAwait.status = 'failed';
        try {
          const actual = await boundedDiagnostic(readActual);
          log(`Scenes: awaited condition failed ${JSON.stringify({ phase: phase(), ...lastAwait, actual })}`);
        } catch (_) { /* Even failed diagnostics must not replace the test error. */ }
        // Do not wrap or mutate the original error: retain identity, stack and cause.
        throw error;
      }
    },
    async failure() {
      const p = page();
      const screenshot = path.join(artifacts, 'scenes-failure.png');
      // Failure-only reads run concurrently and are independently bounded. None
      // retry an interaction, wait for success, or write application storage.
      const [persisted, rendered, image] = await Promise.all([
        boundedDiagnostic(async () => diagnosticStorage(await storage(['opentab.sceneSchemaVersion', 'sceneProfiles', ...sceneDiagnosticGlobals]))),
        boundedDiagnostic(() => p.evaluate(() => {
          const view = globalThis.OpenTabSceneNavigation?.getView(), layout = globalThis.OpenTabLayout?.get();
          const controls = {};
          for (const id of ['layout-icon-size', 'layout-columns', 'layout-show-names', 'layout-max-width', 'todo-button-visible']) {
            const node = document.getElementById(id);
            controls[id] = node ? { value: node.value, checked: node.checked, disabled: node.disabled } : null;
          }
          const bg = document.getElementById('background-layer'), background = bg ? getComputedStyle(bg).backgroundImage : '';
          return {
            view: view ? { sceneId: view.sceneId, currentFolderId: view.currentFolderId, homeGroupId: view.homeGroupId, generation: view.generation } : null,
            layout: layout ? Object.fromEntries(['layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth'].map(key => [key, layout[key]])) : null,
            controls, language: document.documentElement.lang, themeLight: document.body.classList.contains('theme-light'),
            todoHidden: document.body.classList.contains('hide-todo-entry'), homepageInert: document.getElementById('homepage')?.inert,
            settingsHidden: document.getElementById('settings-panel')?.classList.contains('hidden'),
            selectedSettings: document.querySelector('.settings-nav-btn.active')?.id || null,
            focused: { id: document.activeElement?.id, tag: document.activeElement?.tagName },
            searchEngine: globalThis.OpenTabSearch?.getState()?.searchEngine,
            background: /^linear-gradient\([#(),.%\s\w-]+\)$/.test(background) ? background.slice(0, 500) : '[omitted non-gradient background]'
          };
        })),
        boundedDiagnostic(async () => { await p.screenshot({ path: screenshot, fullPage: false, animations: 'disabled', timeout: 1500, mask: [p.locator('input[type="password"]')] }); return path.basename(screenshot); }, 2000)
      ]);
      log(`Scenes: failure state ${JSON.stringify({ phase: phase(), lastAwait, persisted, rendered, screenshot: image })}`);
    }
  };
}
