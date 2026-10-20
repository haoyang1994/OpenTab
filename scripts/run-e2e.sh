#!/usr/bin/env bash
# Canonical E2E entry for `npm test` / CI.
# Headed Chromium is required to load MV3 extensions. On Linux without a
# display (CI and cloud VMs), wrap with xvfb so the same command still works.
# Local machines with a display keep the headed, visible-browser experience.
set -euo pipefail

run_headed() {
  env HEADLESS=false node tests/extension.test.mjs
}

if [[ "${CI:-}" == "true" ]]; then
  echo "E2E: CI=true, wrapping Chromium with xvfb-run"
  xvfb-run -a env HEADLESS=false node tests/extension.test.mjs
elif [[ "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ]]; then
  if command -v xvfb-run >/dev/null 2>&1; then
    echo "E2E: no DISPLAY, wrapping Chromium with xvfb-run"
    xvfb-run -a env HEADLESS=false node tests/extension.test.mjs
  else
    echo "No DISPLAY found and xvfb-run is not installed."
    echo "Install xvfb, or run in a GUI environment (npm run test:e2e:headed)."
    exit 1
  fi
else
  echo "E2E: headed Chromium (DISPLAY=${DISPLAY:-none})"
  run_headed
fi
