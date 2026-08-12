#!/usr/bin/env bash
set -euo pipefail

install_dir="${ENSEMBLE_INSTALL_DIR:-$HOME/bin/ensemble}"

latest_appimage="$({
  find "$install_dir" -maxdepth 1 -type f -name 'Ensemble-*.AppImage' -printf '%f\n'
} | sort -V | tail -n 1)"

if [[ -z "$latest_appimage" ]]; then
  echo "No versioned Ensemble AppImage found in $install_dir" >&2
  exit 1
fi

exec "$install_dir/$latest_appimage" "$@"
