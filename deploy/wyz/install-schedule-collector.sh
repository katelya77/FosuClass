#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root"; exit 1; }
bundle=${1:?bundle path required}
expected=${2:?SHA256 required}
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || exit 1
printf '%s  %s\n' "$expected" "$bundle" | sha256sum -c -
name=$(basename "$bundle")
[[ "$name" =~ ^wyz-schedule-collector-([a-f0-9]{40})\.tar\.gz$ ]] || exit 1
revision=${BASH_REMATCH[1]}
destination=/opt/fosuclass/schedule-collector/releases/$revision
[[ ! -e "$destination" ]] || { echo "Revision already installed; inspect current symlink before changing it"; exit 1; }
tar -tzf "$bundle" | awk '/(^\/|(^|\/)\.\.($|\/))/ {bad=1} END {exit bad}'
install -d -m 700 "$destination" /var/lib/fosuclass/schedule-collector /etc/fosuclass
tar --no-same-owner -xzf "$bundle" -C "$destination"
npm --prefix "$destination/tools/fosu-sync-client" ci --omit=dev
npm --prefix "$destination/server" ci --omit=dev
PLAYWRIGHT_BROWSERS_PATH=/var/lib/fosuclass/schedule-collector/browsers "$destination/tools/fosu-sync-client/node_modules/.bin/playwright" install --with-deps chromium
install -m 644 "$destination/deploy/wyz/wyz-schedule-collector.service" /etc/systemd/system/wyz-schedule-collector.service
install -m 644 "$destination/deploy/wyz/wyz-schedule-collector.timer" /etc/systemd/system/wyz-schedule-collector.timer
if [[ -L /opt/fosuclass/schedule-collector/current ]]; then
  readlink -f /opt/fosuclass/schedule-collector/current > /var/lib/fosuclass/schedule-collector/previous-install.txt
elif [[ -e /opt/fosuclass/schedule-collector/current ]]; then
  echo "current is not a managed symlink; stop and inspect"; exit 1
fi
ln -s "$destination" /opt/fosuclass/schedule-collector/current.next
mv -Tf /opt/fosuclass/schedule-collector/current.next /opt/fosuclass/schedule-collector/current
systemctl daemon-reload
echo "Installed. Service and timer have not been started or enabled. Prepare root-only full-sync.env and session lease before manual MVP."
