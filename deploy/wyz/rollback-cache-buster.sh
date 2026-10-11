#!/usr/bin/env bash
# Independent approval; restore 915 code/units, retain current private data.
set -Eeuo pipefail
umask 077
stage=ROLLBACK_APPROVAL
trap 'rc=$?; printf "FAILED stage=%s child_exit=%s recovery=REVIEW_REQUIRED\n" "$stage" "$rc" >&2; exit "$rc"' ERR
[[ $EUID == 0 && $# == 1 && $1 == --approve-rollback ]]
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
previous=9153876458df7b1dd6b4fae698851638b31c702e
stage=ROLLBACK_SOURCE
[[ -f rollback-backup.path && ! -L rollback-backup.path ]]
backup=$(cat rollback-backup.path)
[[ $backup == "$state"/cas-mobile-backup-* && -d $backup && ! -L $backup ]]
[[ $(cat "$backup/current.txt") == "$base/releases/$previous" && -d $base/releases/$previous && ! -L $base/releases/$previous ]]
[[ ! -L $base && ! -L $state && -L $base/current ]]
target=$(python3 -c 'import json;print(json.load(open("upgrade-candidate.json"))["revision"])')
[[ $target =~ ^[a-f0-9]{40}$ ]]
[[ $(readlink -f "$base/current") == "$base/releases/$previous" || $(readlink -f "$base/current") == "$base/releases/$target" ]]
before_state=$(systemctl is-active wyz-schedule-collector.service 2>/dev/null || true)
[[ $before_state == active || $before_state == inactive ]]
python3 check-heartbeat-service.py --state "$before_state" --baseline "$backup/heartbeat-signatures.json"
stage=STOP_COLLECTOR
systemctl stop wyz-schedule-collector.service >/dev/null 2>&1
python3 check-heartbeat-service.py --state inactive --baseline "$backup/heartbeat-signatures.json"
stage=RESTORE_915_CODE
[[ ! -e $base/current.rollback && ! -L $base/current.rollback ]]
ln -s "$base/releases/$previous" "$base/current.rollback"
mv -Tf "$base/current.rollback" "$base/current"
for name in wyz-schedule-collector.service wyz-schedule-collector.timer; do
  [[ -f $backup/$name && ! -L $backup/$name ]]
  cp -a -- "$backup/$name" "/etc/systemd/system/$name"
done
# Upgrade preserves the existing drop-in directory; verify its baseline rather
# than deleting or replacing it. Any mismatch stops with Collector inactive.
systemctl daemon-reload
python3 check-heartbeat-service.py --state inactive --baseline "$backup/heartbeat-signatures.json"
stage=START_915_HEARTBEAT
systemctl start wyz-schedule-collector.service >/dev/null 2>&1
python3 check-heartbeat-service.py --state active --health --baseline "$backup/heartbeat-signatures.json"
[[ $(readlink -f "$base/current") == "$base/releases/$previous" ]]
printf 'ROLLBACK_PASS revision=%s session_preserved=YES auth_history_preserved=YES credentials_preserved=YES timer=DISABLED personal_agent=UNCHANGED\n' "$previous"
