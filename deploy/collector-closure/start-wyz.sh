#!/usr/bin/env bash
# One explicitly approved task, surviving terminal/SSH disconnect; never auto-restarted.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { printf 'CLOSURE_LINUX_ROOT_REQUIRED\n' >&2; exit 2; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
command -v systemd-run >/dev/null
command -v node >/dev/null
prepared=$(node "$script_dir/wyz-sample.js" prepare "$@")
approval=$(node -e 'const v=JSON.parse(process.argv[1]);if(v.status!=="READY_TO_START_APPROVED_ONE_SHOT"||!/^sc-[A-Za-z0-9-]{1,100}$/.test(v.runId)||v.approvalFile!=="/root/fosu-collector-closure/"+v.runId+"/approval.json")process.exit(2);process.stdout.write(v.approvalFile)' "$prepared")
run_id=$(basename -- "$(dirname -- "$approval")")
unit="fosu-collector-sample-${run_id#sc-}"
evidence_dir=$(dirname -- "$approval")
systemd-run --quiet --unit="$unit" --property=Type=exec --property=Restart=no \
  --property=RuntimeMaxSec=900 --property=TimeoutStopSec=35 --property=KillMode=control-group \
  --property=UMask=0077 --property=Nice=10 --property=NoNewPrivileges=yes \
  --property="WorkingDirectory=$script_dir" \
  --property="StandardOutput=append:$evidence_dir/executor.log" \
  --property="StandardError=append:$evidence_dir/executor.log" \
  /usr/bin/node "$script_dir/wyz-sample.js" run "$approval"
printf 'WYZ_SAMPLE_STARTED unit=%s run=%s evidence=%s restart=NO timer=UNCHANGED\n' "$unit" "$run_id" "$evidence_dir"
