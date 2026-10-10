#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo ROOT_REQUIRED; exit 1; }
bundle=${1:?bundle path required}
expected=${2:?SHA256 required}
[[ "$expected" =~ ^[a-f0-9]{64}$ && -f $bundle && ! -L $bundle ]] || exit 1
printf '%s  %s\n' "$expected" "$bundle" | sha256sum -c -
name=$(basename "$bundle")
[[ "$name" =~ ^wyz-schedule-collector-([a-f0-9]{40})\.tar\.gz$ ]] || exit 1
revision=${BASH_REMATCH[1]}
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
destination=$base/releases/$revision
command -v python3 >/dev/null || { echo PYTHON3_REQUIRED; exit 1; }
command -v flock >/dev/null || { echo FLOCK_REQUIRED; exit 1; }
[[ ! -L $base && ! -L $state ]] || { echo INSTALL_PATH_REJECTED; exit 1; }
install -d -m 700 "$base/releases" "$state" /etc/fosuclass
exec 9>"$state/install.lock"
flock -n 9 || { echo INSTALL_LOCKED; exit 1; }
if systemctl is-active --quiet wyz-schedule-collector.service; then echo COLLECTOR_MUST_BE_INACTIVE; exit 1; fi
if systemctl is-enabled --quiet wyz-schedule-collector.timer || systemctl is-active --quiet wyz-schedule-collector.timer; then echo TIMER_MUST_BE_DISABLED; exit 1; fi
[[ ! -e $base/current || -L $base/current ]] || { echo CURRENT_NOT_MANAGED_SYMLINK; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Validate all archive members and existing bytes before recovering missing files.
python3 "$script_dir/recover-release.py" "$bundle" "$destination"
receipt=$destination/.install-complete.json
if [[ -f $receipt ]]; then
  node -e 'const r=require(process.argv[1]);if(r.revision!==process.argv[2]||r.bundleSha256!==process.argv[3])process.exit(1)' "$receipt" "$revision" "$expected" || { echo INSTALL_RECEIPT_CONFLICT; exit 1; }
  echo SAME_REVISION_SOURCE=VERIFIED
fi
dependencies_ready=true
for package_dir in "$destination/tools/fosu-sync-client" "$destination/server"; do
  npm --prefix "$package_dir" ls --omit=dev --depth=0 >/dev/null 2>&1 || dependencies_ready=false
done
if [[ ! -f $receipt || $dependencies_ready != true ]]; then
  npm --prefix "$destination/tools/fosu-sync-client" ci --omit=dev --ignore-scripts
  npm --prefix "$destination/server" ci --omit=dev --ignore-scripts
fi
export PLAYWRIGHT_BROWSERS_PATH=$state/browsers
if [[ ! -f $state/browser-runtime.json ]] || ! node -e 'if(require(process.argv[1]).mode!=="container")process.exit(1)' "$state/browser-runtime.json"; then
  "$destination/tools/fosu-sync-client/node_modules/.bin/playwright" install chromium
fi
bash "$destination/deploy/wyz/repair-browser.sh" "$destination" --repair
[[ -f $destination/deploy/wyz/fosu-collector.sh && ! -L $destination/deploy/wyz/fosu-collector.sh ]] || { echo CLI_SOURCE_REQUIRED; exit 1; }
[[ ! -L /usr/local/bin/fosu-collector ]] || { echo CLI_TARGET_REJECTED; exit 1; }
[[ ! -e /usr/local/bin/fosu-collector ]] || cmp -s "$destination/deploy/wyz/fosu-collector.sh" /usr/local/bin/fosu-collector || { echo CLI_TARGET_CONFLICT; exit 1; }
install -m 700 "$destination/deploy/wyz/fosu-collector.sh" /usr/local/bin/fosu-collector
if [[ -L $base/current && $(readlink -f "$base/current") == "$destination" && -f $receipt ]] && cmp -s "$destination/deploy/wyz/wyz-schedule-collector.service" /etc/systemd/system/wyz-schedule-collector.service && cmp -s "$destination/deploy/wyz/wyz-schedule-collector.timer" /etc/systemd/system/wyz-schedule-collector.timer; then
  echo ALREADY_INSTALLED_COMPLETE
  exit 0
fi
install -m 644 "$destination/deploy/wyz/wyz-schedule-collector.service" /etc/systemd/system/wyz-schedule-collector.service
install -m 644 "$destination/deploy/wyz/wyz-schedule-collector.timer" /etc/systemd/system/wyz-schedule-collector.timer
systemctl daemon-reload
node -e 'const f=require("fs");f.writeFileSync(process.argv[1],JSON.stringify({revision:process.argv[2],bundleSha256:process.argv[3],runtimeVerified:true}),{mode:0o600})' "$receipt" "$revision" "$expected"
if [[ -L $base/current && $(readlink -f "$base/current") != "$destination" ]]; then
  readlink -f "$base/current" > "$state/previous-install.txt.next"
  mv -T "$state/previous-install.txt.next" "$state/previous-install.txt"
fi
if [[ -L $base/current.next && $(readlink "$base/current.next") == "$destination" ]]; then unlink "$base/current.next"; fi
[[ ! -e $base/current.next && ! -L $base/current.next ]] || { echo PENDING_LINK_CONFLICT; exit 1; }
ln -s "$destination" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
echo "INSTALL_COMPLETE revision=$revision service_started=NO timer_enabled=NO environment_overwritten=NO"
