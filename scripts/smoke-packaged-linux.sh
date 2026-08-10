#!/usr/bin/env bash

set -euo pipefail

executable="release/linux-unpacked/ai-browser"
if [[ ! -x "$executable" ]]; then
  echo "Packaged Linux executable is missing: $executable" >&2
  exit 1
fi

profile_dir=$(mktemp -d)
trap 'rm -rf -- "$profile_dir"' EXIT

set +e
output=$(env -u ELECTRON_RUN_AS_NODE \
  XDG_CONFIG_HOME="$profile_dir" \
  ELECTRON_DISABLE_SANDBOX=1 \
  timeout 15s xvfb-run -a "$executable" 2>&1)
status=$?
set -e

printf '%s\n' "$output"

if [[ $status -ne 124 ]]; then
  echo "Packaged app exited unexpectedly with status $status" >&2
  exit 1
fi

if [[ "$output" != *"[renderer] loaded"* ]]; then
  echo "Packaged app did not report a loaded renderer" >&2
  exit 1
fi

echo "Packaged app loaded its renderer and stayed alive for the smoke window."
