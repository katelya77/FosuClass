#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
systemctl is-active --quiet wyz-schedule-collector.service && { echo COLLECTOR_MUST_BE_INACTIVE; exit 1; }
previous=$(cat "$state/previous-install.txt")
[[ $previous =~ ^/opt/fosuclass/schedule-collector/releases/[a-f0-9]{40}$ && -d $previous && ! -L $previous ]] || { echo PREVIOUS_INSTALL_REJECTED; exit 1; }
[[ ! -e $base/current || -L $base/current ]] || exit 1
ln -s "$previous" "$base/current.rollback"
mv -Tf "$base/current.rollback" "$base/current"
systemctl daemon-reload
echo "ROLLBACK_COMPLETE service_started=NO timer_enabled=NO credentials_changed=NO"
