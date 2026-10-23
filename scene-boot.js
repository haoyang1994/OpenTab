(function (g) {
  'use strict';
  const LEGACY_KEY = 'opentab.boot.v1';
  const valid = id => typeof id === 'string' && id.length > 0;

  // Reads only: choosing another tab's scene must never change this tab's view.
  // The scene controller alone writes the device default on explicit switches.
  function key(explicitSceneId) {
    let sceneId = valid(explicitSceneId) ? explicitSceneId : '';
    if (!sceneId) {
      try {
        const view = JSON.parse(g.sessionStorage.getItem('opentab.scene.view'));
        if (valid(view?.sceneId)) sceneId = view.sceneId;
      } catch (_) {}
    }
    if (!sceneId) {
      try {
        const last = g.localStorage.getItem('opentab.scene.last');
        if (valid(last)) sceneId = last;
      } catch (_) {}
    }
    return sceneId ? LEGACY_KEY + ':' + sceneId : LEGACY_KEY;
  }

  g.OpenTabSceneBoot = { key };
})(globalThis);
