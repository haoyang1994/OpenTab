#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" == "true" ]]; then
  xvfb-run -a env HEADLESS=false node tests/extension.test.mjs
else
  if [[ "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ]]; then
    if command -v xvfb-run >/dev/null 2>&1; then
      xvfb-run -a env HEADLESS=false node tests/extension.test.mjs
    else
      echo "No DISPLAY found and xvfb-run is not installed."
      echo "Install xvfb, or run in a GUI environment."
      exit 1
    fi
  else
    HEADLESS=false node tests/extension.test.mjs
  fi
fi
