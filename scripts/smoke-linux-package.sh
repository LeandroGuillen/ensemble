#!/usr/bin/env bash
set -euo pipefail

# Usage: smoke-linux-package.sh /path/to/executable expected-version
app_binary=$1
expected_version=$2
log_file=$(mktemp)

Xvfb :99 -screen 0 1280x800x24 > /tmp/ensemble-xvfb.log 2>&1 &
xvfb_pid=$!
export DISPLAY=:99
export ELECTRON_DISABLE_SANDBOX=1

cleanup() {
  if [[ -n "${app_pid:-}" ]]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  kill "$xvfb_pid" 2>/dev/null || true
  wait "$xvfb_pid" 2>/dev/null || true
  rm -f "$log_file"
}
trap cleanup EXIT

for attempt in {1..20}; do
  if xdpyinfo -display :99 >/dev/null 2>&1; then break; fi
  sleep 0.5
done
xdpyinfo -display :99 >/dev/null

"$app_binary" --no-sandbox --disable-gpu > "$log_file" 2>&1 &
app_pid=$!

for attempt in {1..60}; do
  if xdotool search --onlyvisible --name "Ensemble v${expected_version}" >/dev/null 2>&1; then
    echo "Opened Ensemble v${expected_version} window"
    exit 0
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$log_file"
    echo 'Ensemble exited before opening a window' >&2
    exit 1
  fi
  sleep 1
done

cat "$log_file"
echo 'Timed out waiting for the Ensemble window' >&2
exit 1
