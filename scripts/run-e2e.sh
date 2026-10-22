#!/usr/bin/env bash
# Canonical E2E entry for `npm test` / CI.
# Use headed Chromium for installed MV3 extension tests. On Linux without a
# display (CI and cloud VMs), wrap with xvfb so the same command still works.
# Local machines with a display keep the headed, visible-browser experience.
set -euo pipefail

export PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1

run_headed() {
  env HEADLESS=false node tests/accessibility.test.mjs
  env HEADLESS=false node tests/i18n.test.mjs
  env HEADLESS=false node tests/workspace.test.mjs
  env HEADLESS=false node tests/extension.test.mjs
  env HEADLESS=false node tests/search.test.mjs
  env HEADLESS=false node tests/first-run.test.mjs
  env HEADLESS=false node tests/settings-layout.test.mjs
  env HEADLESS=false node tests/weather.test.mjs
}

run_with_xvfb() {
  local reason=$1
  if ! command -v xvfb-run >/dev/null 2>&1; then
    echo "xvfb-run is not installed (or not on PATH)."
    echo "Headed Chromium needs a display. Install xvfb (e.g. sudo apt-get install xvfb),"
    echo "or run in a GUI environment (npm run test:e2e:headed)."
    exit 1
  fi
  echo "$reason"
  xvfb-run -a bash -c 'export PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 HEADLESS=false; node tests/accessibility.test.mjs && node tests/i18n.test.mjs && node tests/workspace.test.mjs && node tests/extension.test.mjs && node tests/search.test.mjs && node tests/first-run.test.mjs && node tests/settings-layout.test.mjs && node tests/weather.test.mjs'
}

if [[ "${CI:-}" == "true" ]]; then
  run_with_xvfb "E2E: CI=true, wrapping Chromium with xvfb-run"
elif [[ "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ]]; then
  run_with_xvfb "E2E: no DISPLAY, wrapping Chromium with xvfb-run"
else
  echo "E2E: headed Chromium (DISPLAY=${DISPLAY:-none})"
  run_headed
fi
