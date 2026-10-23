#!/usr/bin/env bash
# Canonical E2E entry for `npm test` / CI.
# Use headed Chromium for installed MV3 extension tests. On Linux without a
# display (CI and cloud VMs), wrap with xvfb so the same command still works.
# Local machines with a display keep the headed, visible-browser experience.
set -euo pipefail

export PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1

# CI runs these exhaustive, disjoint groups on independent runners so native
# performance checks do not compete for CPU. Local/default validation stays full.
export OPENTAB_E2E_GROUP="${OPENTAB_E2E_GROUP-all}"
case "$OPENTAB_E2E_GROUP" in
  all|scenes|core) ;;
  *)
    echo "E2E: invalid OPENTAB_E2E_GROUP '$OPENTAB_E2E_GROUP' (expected all, scenes, or core)" >&2
    exit 2
    ;;
esac

run_command() {
  local child_pid='' status
  # Separate process groups let cancellation reach xvfb, Chromium, and any
  # descendants, not just the shell waiting for them. Never start another suite
  # after a cancellation, even if the interrupted command happens to exit zero.
  # Use TERM for cleanup because background descendants can inherit ignored INT.
  trap '[[ -z "${child_pid:-}" ]] || kill -TERM -- "-$child_pid" 2>/dev/null || true; exit 129' HUP
  trap '[[ -z "${child_pid:-}" ]] || kill -TERM -- "-$child_pid" 2>/dev/null || true; exit 130' INT
  trap '[[ -z "${child_pid:-}" ]] || kill -TERM -- "-$child_pid" 2>/dev/null || true; exit 143' TERM
  set -m
  "$@" &
  child_pid=$!
  if wait "$child_pid"; then status=0; else status=$?; fi
  child_pid=''
  set +m
  return "$status"
}

run_headed() {
  local suites=(
    tests/scenes.test.mjs
    tests/clock-deck.test.mjs
    tests/zen-mode.test.mjs
    tests/group-icon-motion.test.mjs
    tests/group-launch.test.mjs
    tests/site-selection.test.mjs
    tests/paste-sites.test.mjs
    tests/command-palette.test.mjs
    tests/accessibility.test.mjs
    tests/i18n.test.mjs
    tests/workspace.test.mjs
    tests/extension.test.mjs
    tests/search.test.mjs
    tests/first-run.test.mjs
    tests/settings-layout.test.mjs
    tests/weather.test.mjs
  )
  # Keep one canonical suite list. The scenes fixture is its first, independent
  # suite; runner unit tests enforce the exact ordered partition and full union.
  if [[ "$OPENTAB_E2E_GROUP" == "scenes" ]]; then
    suites=("${suites[0]}")
  elif [[ "$OPENTAB_E2E_GROUP" == "core" ]]; then
    suites=("${suites[@]:1}")
  fi
  echo "E2E: group $OPENTAB_E2E_GROUP (${#suites[@]} suites)"
  local failures=() suite status
  for suite in "${suites[@]}"; do
    echo "E2E: running $suite"
    if run_command env HEADLESS=false node "$suite"; then status=0; else status=$?; fi
    echo "E2E: $suite exited $status"
    if (( status >= 128 )); then
      echo "E2E: interrupted; stopping remaining suites ($suite exited $status)" >&2
      return "$status"
    elif (( status != 0 )); then
      failures+=("$suite (exit $status)")
    fi
  done
  if (( ${#failures[@]} > 0 )); then
    printf 'E2E: %s suite(s) failed:\n' "${#failures[@]}" >&2
    printf '  %s\n' "${failures[@]}" >&2
    return 1
  fi
  echo "E2E: all ${#suites[@]} suites passed"
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
  # xvfb-run uses /bin/sh, which may strip exported Bash functions. Re-enter
  # this script instead, keeping the suite list and signal handling shared.
  run_command xvfb-run -a bash "${BASH_SOURCE[0]}" --internal-headed
}

if [[ "${1:-}" == "--internal-headed" ]]; then
  run_headed
elif [[ "${CI:-}" == "true" ]]; then
  run_with_xvfb "E2E: CI=true, wrapping Chromium with xvfb-run"
elif [[ "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ]]; then
  run_with_xvfb "E2E: no DISPLAY, wrapping Chromium with xvfb-run"
else
  echo "E2E: headed Chromium (DISPLAY=${DISPLAY:-none})"
  run_headed
fi
