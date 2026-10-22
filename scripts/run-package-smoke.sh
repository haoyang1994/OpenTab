#!/usr/bin/env bash
set -euo pipefail
export PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1
if [[ "${CI:-}" == "true" || ( "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ) ]]; then
  command -v xvfb-run >/dev/null || { echo 'Packaged MV3 smoke requires xvfb-run or a desktop display.' >&2; exit 1; }
  exec xvfb-run -a node tests/package-extension.test.mjs
fi
exec node tests/package-extension.test.mjs
