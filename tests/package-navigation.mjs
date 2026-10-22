import assert from 'node:assert/strict';

// A committed navigation can have no main-resource Response. Null is not proof
// of either success or failure: require the actual loaded extension document.
export function assertPackagedNavigation(response, document, expectedUrl, expectedId) {
  if (response !== null) assert.equal(response.status(), 200, expectedUrl);
  assert.equal(document.url, expectedUrl, 'packaged document URL');
  assert.equal(document.runtimeId, expectedId, 'packaged extension identity');
  assert.equal(document.readyState, 'complete', 'packaged document load completed');
}
