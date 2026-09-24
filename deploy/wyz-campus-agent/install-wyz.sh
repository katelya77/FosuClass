#!/bin/sh
set -eu
SRC=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
if [ ! -f "$SRC/vendor/fosuDirectClient.js" ]; then
  echo "vendor/fosuDirectClient.js is missing. Install from the built wyz-campus-agent bundle."
  exit 1
fi
DEST=/opt/wyz-campus-agent
install -d -m 755 "$DEST/src" "$DEST/vendor"
cp "$SRC/package.json" "$SRC/package-lock.json" "$DEST/"
cp "$SRC/src/index.js" "$SRC/src/signature.js" "$DEST/src/"
cp "$SRC/vendor/"*.js "$DEST/vendor/"
install -m 644 "$SRC/wyz-campus-agent.service" /etc/systemd/system/wyz-campus-agent.service
if [ -f "$SRC/verify-wyz.sh" ]; then
  install -m 755 "$SRC/verify-wyz.sh" "$DEST/verify-wyz.sh"
fi
if [ ! -f /etc/fosu-campus-agent.env ]; then
  umask 077
  cat > /etc/fosu-campus-agent.env <<'EOF'
CAMPUS_AGENT_ENABLED=true
CAMPUS_AGENT_BROKER_URL=https://agent-broker.katelya.eu.org
CAMPUS_AGENT_ID=wyz-campus-01
CAMPUS_AGENT_TOKEN=
CAMPUS_AGENT_SIGNING_SECRET=
EOF
fi
chown root:root /etc/fosu-campus-agent.env
chmod 600 /etc/fosu-campus-agent.env
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
fi
echo "Fill CAMPUS_AGENT_TOKEN and CAMPUS_AGENT_SIGNING_SECRET in /etc/fosu-campus-agent.env."
echo "Then: systemctl enable --now wyz-campus-agent.service"
echo "This install does not change wyz-campus-api.service or the WYZ web UI."
