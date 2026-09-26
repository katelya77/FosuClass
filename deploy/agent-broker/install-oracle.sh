#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
echo "agent-broker install inspects fosuclass-api and does not delete it."

if ! command -v docker >/dev/null 2>&1; then
  echo "STOP docker is not available on this host."
  exit 2
fi

if ! docker inspect fosuclass-api >/dev/null 2>&1; then
  echo "STOP container fosuclass-api was not found. Do not create a second API container."
  exit 2
fi

docker inspect fosuclass-api --format 'image={{.Config.Image}}
status={{.State.Status}}
restart={{.HostConfig.RestartPolicy.Name}}
ports={{json .NetworkSettings.Ports}}
networks={{json .NetworkSettings.Networks}}
binds={{json .HostConfig.Binds}}'

IMAGE=$(docker inspect fosuclass-api --format '{{.Config.Image}}')
PORT=$(docker inspect fosuclass-api --format '{{json .NetworkSettings.Ports}}')
echo "$PORT" | grep -q '18318' || {
  echo "STOP expected host port 127.0.0.1:18318. Current ports are printed above."
  echo "1Panel fields to check, without recreating the container:"
  echo "  site class.katelya.eu.org proxy http://127.0.0.1:18318"
  echo "  container fosuclass-api port 127.0.0.1:18318 -> 3000"
  exit 2
}

case "$IMAGE" in
  fosuclass-api:local) ;;
  *)
    echo "STOP image is $IMAGE, not fosuclass-api:local. Refusing to recreate the container."
    exit 2
    ;;
esac

ROUTE2_ENV_FILE=/root/fosu-route2-secrets.env
if [ ! -f "$ROUTE2_ENV_FILE" ]; then
  TOKEN=$(od -An -N 32 -tx1 /dev/urandom | tr -d ' \n')
  SIGN=$(od -An -N 32 -tx1 /dev/urandom | tr -d ' \n')
  umask 077
  cat > "$ROUTE2_ENV_FILE" <<EOF
CAMPUS_AGENT_ENABLED=true
CAMPUS_AGENT_ID=wyz-campus-01
CAMPUS_AGENT_TOKEN=$TOKEN
CAMPUS_AGENT_SIGNING_SECRET=$SIGN
CAMPUS_SYNC_JOB_TTL_SECONDS=120
EOF
  chmod 600 "$ROUTE2_ENV_FILE"
  echo "Wrote $ROUTE2_ENV_FILE mode 0600. Token values were not printed."
else
  echo "Kept existing $ROUTE2_ENV_FILE"
fi

echo "STOP automatic container upgrade is not safe for the 1Panel-managed container."
echo "Add these environment fields to fosuclass-api in 1Panel, then restart only that container:"
echo "  CAMPUS_AGENT_ENABLED=true"
echo "  CAMPUS_AGENT_ID=wyz-campus-01"
echo "  CAMPUS_AGENT_TOKEN from $ROUTE2_ENV_FILE"
echo "  CAMPUS_AGENT_SIGNING_SECRET from $ROUTE2_ENV_FILE"
echo "  CAMPUS_SYNC_JOB_TTL_SECONDS=120"
echo "Create a separate site agent-broker.katelya.eu.org with the vhost in:"
echo "  $ROOT/nginx.conf"
echo "Proxy target http://127.0.0.1:18318. Do not change class.katelya.eu.org."
echo "Do not put the token in the nginx file."
exit 10
