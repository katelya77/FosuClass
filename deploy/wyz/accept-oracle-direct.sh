#!/usr/bin/env bash
# PAM-only operations. Never source/dump full-sync.env or touch the personal Agent.
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo ROOT_REQUIRED; exit 1; }
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
revision=b1bc12f96692768d53004e2573e78e6bd5a62d5d
digest=44b893f7bddbc0aa08580b610fffd760955f07312de4ac7a9110ca307cf5498b
handoff=/root/fosu-collector-install/$revision
unit=wyz-schedule-collector.service
timer=wyz-schedule-collector.timer
mode=${1:-status}
[[ ! -L $state && ! -L $base ]] || { echo PATH_REJECTED; exit 1; }
if [[ $mode == status ]]; then
  readlink -f "$base/current"
  stat -c '%U:%G %a %n' "$state" /etc/fosuclass/full-sync.env
  systemctl show "$unit" -p ActiveState -p SubState -p NRestarts -p MainPID
  systemctl show "$timer" -p ActiveState -p UnitFileState
  systemctl is-active wyz-campus-agent.service
  [[ ! -e $state/oracle-transport.json ]] || stat -c '%U:%G %a %n' "$state/oracle-transport.json"
  exit 0
fi
if [[ $mode == install ]]; then
  [[ $(node --version) == v20.20.2 ]] || { echo NODE_VERSION_REJECTED; exit 1; }
  [[ $(systemctl is-enabled "$timer" || true) == disabled ]] || { echo TIMER_NOT_DISABLED; exit 1; }
  ! systemctl is-active --quiet "$timer" || { echo TIMER_IS_ACTIVE; exit 1; }
  systemctl is-active --quiet wyz-campus-agent.service || { echo PERSONAL_AGENT_NOT_ACTIVE; exit 1; }
  [[ -L $base/current ]] || { echo CURRENT_NOT_MANAGED; exit 1; }
  previous=$(readlink -f "$base/current")
  [[ $previous =~ ^/opt/fosuclass/schedule-collector/releases/[a-f0-9]{40}$ && -d $previous && ! -L $previous ]] || exit 1
  [[ -f /etc/fosuclass/full-sync.env && ! -L /etc/fosuclass/full-sync.env && $(stat -c '%u:%g:%a' /etc/fosuclass/full-sync.env) == 0:0:600 ]] || { echo BROKER_FILE_PERMISSIONS_REJECTED; exit 1; }
  bundle=$handoff/wyz-schedule-collector-$revision.tar.gz
  printf '%s  %s\n' "$digest" "$bundle" | sha256sum -c -
  [[ -f $handoff/install-schedule-collector.sh && -f $handoff/recover-release.py ]] || { echo INSTALL_HELPERS_MISSING; exit 1; }
  [[ ! -L $state/acceptance && ! -L /etc/systemd/system/$unit.d ]] || { echo ACCEPTANCE_PATH_REJECTED; exit 1; }
  install -d -o root -g root -m 700 "$state" "$state/acceptance" /etc/systemd/system/$unit.d
  checkpoint_bytes=$(du -sb "$state" | awk '{print $1}')
  available=$(df -PB1 "$state" | awk 'NR==2 {print $4}')
  (( available > checkpoint_bytes * 2 + 104857600 )) || { echo BACKUP_DISK_SPACE_REQUIRED; exit 1; }
  backup=$state/acceptance/$(date -u +%Y%m%dT%H%M%SZ)-$$
  install -d -o root -g root -m 700 "$backup"
  printf '%s\n' "$previous" > "$backup/previous-code"
  cp -a /etc/systemd/system/$unit "$backup/service"
  cp -a /etc/systemd/system/$timer "$backup/timer"
  [[ ! -e $state/oracle-transport.json ]] || { [[ -f $state/oracle-transport.json && ! -L $state/oracle-transport.json ]] || exit 1; cp -a "$state/oracle-transport.json" "$backup/transport"; }
  [[ ! -e /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf ]] || cp -a /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf "$backup/dropin"
  printf '%s\n' "$backup" > "$state/acceptance/last-backup.next"
  mv -T "$state/acceptance/last-backup.next" "$state/acceptance/last-backup"
  systemctl stop "$unit"
  # No credentials/session/browser binaries enter this checkpoint archive.
  items=()
  for item in runs catalog latest last-success.json previous-install.txt; do [[ ! -e $state/$item ]] || items+=("$item"); done
  if (( ${#items[@]} )); then tar -czf "$backup/checkpoints.tar.gz" -C "$state" -- "${items[@]}"; fi
  bash "$handoff/install-schedule-collector.sh" "$bundle" "$digest"
  [[ $(readlink -f "$base/current") == "$base/releases/$revision" ]] || exit 1
  cat > "$state/acceptance/heartbeat-only-runner.js.next" <<'JS'
"use strict";
process.env.FOSU_COLLECTOR_EXECUTE = "0";
const root = "/opt/fosuclass/schedule-collector/current/tools/wyz-schedule-collector/";
const collector = require(root + "collector"), transport = require(root + "oracleTransport");
const cfg = collector.config();
if (cfg.execute || cfg.transport.mode !== "oracle-direct") throw Error("ACCEPTANCE_POLICY_REJECTED");
const fetcher = transport.createFetcher(cfg.transport, { onConnection: c => console.log(JSON.stringify({ acceptanceConnection: c })) });
collector.main({ fetcher }).catch(e => { console.error(JSON.stringify({ status: "failed", code: e.code || "ACCEPTANCE_FAILED" })); process.exitCode = require(root + "heartbeatRecovery").exitCode(e); });
JS
  chown root:root "$state/acceptance/heartbeat-only-runner.js.next"
  chmod 600 "$state/acceptance/heartbeat-only-runner.js.next"
  mv -T "$state/acceptance/heartbeat-only-runner.js.next" "$state/acceptance/heartbeat-only-runner.js"
  printf '%s\n' '{"schema":1,"mode":"oracle-direct","originIpv4":"146.235.201.244"}' > "$state/oracle-transport.json.next"
  chown root:root "$state/oracle-transport.json.next"
  chmod 600 "$state/oracle-transport.json.next"
  mv -T "$state/oracle-transport.json.next" "$state/oracle-transport.json"
  node -e 'require(process.argv[1]).load(process.argv[2]); console.log("TRANSPORT_SCHEMA_PASS")' "$base/current/tools/wyz-schedule-collector/oracleTransport.js" "$state"
  # ExecStart env wins over EnvironmentFile without reading or rewriting secrets.
  printf '%s\n' '[Service]' 'ExecStart=' "ExecStart=/usr/bin/env FOSU_COLLECTOR_EXECUTE=0 /usr/bin/node $state/acceptance/heartbeat-only-runner.js" > /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf.next
  chmod 600 /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf.next
  mv -T /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf.next /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf
  systemctl daemon-reload
  systemctl start "$unit"
  echo 'ORACLE_DIRECT_STARTED execute=0 timer=disabled schoolRequests=0 acceptance=PENDING'
  echo "ROLLBACK_SNAPSHOT=$backup"
  exit 0
fi
if [[ $mode == transport-rollback || $mode == code-rollback ]]; then
  backup=$(cat "$state/acceptance/last-backup")
  [[ $backup =~ ^/var/lib/fosuclass/schedule-collector/acceptance/[0-9TZ-]+$ && -d $backup && ! -L $backup ]] || { echo BACKUP_REJECTED; exit 1; }
  systemctl stop "$unit"
  if [[ $mode == code-rollback ]]; then
    previous=$(cat "$backup/previous-code")
    [[ $previous =~ ^/opt/fosuclass/schedule-collector/releases/[a-f0-9]{40}$ && -d $previous && ! -L $previous ]] || exit 1
    [[ ! -e $base/current.rollback && ! -L $base/current.rollback ]] || exit 1
    ln -s "$previous" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    install -o root -g root -m 644 "$backup/service" /etc/systemd/system/$unit
    install -o root -g root -m 644 "$backup/timer" /etc/systemd/system/$timer
  fi
  printf '%s\n' '{"schema":1,"mode":"cloudflare-default"}' > "$state/oracle-transport.json.next"
  chmod 600 "$state/oracle-transport.json.next"
  chown root:root "$state/oracle-transport.json.next"
  mv -T "$state/oracle-transport.json.next" "$state/oracle-transport.json"
  # Keep the heartbeat-only safety gate even after rollback.
  printf '%s\n' '[Service]' 'ExecStart=' 'ExecStart=/usr/bin/env FOSU_COLLECTOR_EXECUTE=0 /usr/bin/node tools/wyz-schedule-collector/collector.js' > /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf.next
  chmod 600 /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf.next
  mv -T /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf.next /etc/systemd/system/$unit.d/90-heartbeat-acceptance.conf
  systemctl daemon-reload
  systemctl start "$unit"
  echo 'ROLLBACK_COMPLETE execute=0 timer=unchanged checkpoints=preserved personalAgent=unchanged'
  exit 0
fi
echo UNKNOWN_MODE
exit 1
