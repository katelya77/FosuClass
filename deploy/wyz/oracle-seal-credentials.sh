#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo ROOT_REQUIRED; exit 1; }
public=/root/collector-transfer.key.pub
output=/root/wyz-full-sync.encrypted.json
[[ -f $public && ! -L $public && ! -e $output ]] || { echo TRANSFER_FILE_STATE_REJECTED; exit 1; }
docker exec fosuclass-api test -f /app/storage/secure/collector-maintenance/seal-full-sync-credentials.js
docker cp "$public" fosuclass-api:/app/storage/secure/collector-transfer.key.pub
docker exec fosuclass-api chmod 600 /app/storage/secure/collector-transfer.key.pub
docker exec fosuclass-api node /app/storage/secure/collector-maintenance/seal-full-sync-credentials.js /app/storage/secure/collector-transfer.key.pub /app/storage/secure/wyz-full-sync.encrypted.json /app/storage/secure/collector-maintenance/credentials.js
docker cp fosuclass-api:/app/storage/secure/wyz-full-sync.encrypted.json "$output"
chown root:root "$output"
chmod 600 "$output"
docker exec fosuclass-api node -e 'const f=require("fs");for(const p of ["/app/storage/secure/collector-transfer.key.pub","/app/storage/secure/wyz-full-sync.encrypted.json"])f.unlinkSync(p);'
echo 'ENCRYPTED_TRANSFER_READY: /root/wyz-full-sync.encrypted.json (root:root 600; PAM transfer only)'
