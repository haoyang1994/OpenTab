#!/usr/bin/env bash
# Only the runner's fresh Xvfb display needs a WM. Never replace a developer's
# desktop WM. Chromium uses EWMH for maximize/fullscreen geometry and focus.
set -euo pipefail
if [[ "${OPENTAB_E2E_OWNED_DISPLAY:-}" != 1 || -z "${DISPLAY:-}" ]]; then
  echo 'Native desktop fixture requires the runner-owned Xvfb display.' >&2
  exit 2
fi
if ! command -v openbox >/dev/null 2>&1; then
  echo 'Native desktop fixture needs Openbox (install the Ubuntu openbox package).' >&2
  exit 1
fi
if (( $# == 0 )); then exit 2; fi
fixture=$(mktemp -d)
wm_pid='' suite_pid=''
stop_child() {
  local pid=$1 i
  [[ -n "$pid" ]] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  for ((i=0; i<40; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.05
  done
  if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  wait "$pid" 2>/dev/null || true
}
cleanup() {
  stop_child "$suite_pid"
  stop_child "$wm_pid"
  rm -rf -- "$fixture"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
export OPENTAB_WM_READY_FILE="$fixture/ready"
# --startup runs only after Openbox has acquired this fresh display. The marker
# is in our private temporary directory; no existing display/window is probed.
# Openbox tokenizes --startup as argv, not a shell program. Request the shell
# explicitly so the private marker path is expanded in the child environment.
openbox --sm-disable --startup "sh -c 'touch -- \"\$OPENTAB_WM_READY_FILE\"'" &
wm_pid=$!
for ((i=0; i<100; i++)); do
  if ! kill -0 "$wm_pid" 2>/dev/null; then
    echo 'Native desktop window manager exited before readiness.' >&2
    exit 1
  fi
  if [[ -f "$OPENTAB_WM_READY_FILE" ]]; then break; fi
  sleep 0.05
done
if [[ ! -f "$OPENTAB_WM_READY_FILE" ]]; then
  echo 'Native desktop window manager did not become ready within 5 seconds.' >&2
  exit 1
fi
echo 'E2E: disposable Openbox desktop ready'
"$@" &
suite_pid=$!
if wait "$suite_pid"; then status=0; else status=$?; fi
suite_pid=''
if ! kill -0 "$wm_pid" 2>/dev/null; then
  echo 'Native desktop window manager exited during the suite.' >&2
  if (( status == 0 )); then status=1; fi
fi
exit "$status"
