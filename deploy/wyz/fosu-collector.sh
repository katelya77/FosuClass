#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo ROOT_REQUIRED >&2; exit 1; }
base=/opt/fosuclass/schedule-collector/current
[[ -L $base && -f $base/tools/wyz-schedule-collector/cli.js ]] || { echo CLI_REVISION_REQUIRED >&2; exit 1; }
export PLAYWRIGHT_BROWSERS_PATH=/var/lib/fosuclass/schedule-collector/browsers
exec node "$base/tools/wyz-schedule-collector/cli.js" "$@"
