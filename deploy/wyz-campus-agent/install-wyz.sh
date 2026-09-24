#!/bin/sh
set -eu
SRC=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=$(CDPATH= cd -- "$SRC/../.." && pwd)
DEST=/opt/wyz-campus-agent
install -d -m 755 "$DEST/src" "$DEST/vendor"
cp "$SRC/package.json" "$SRC/package-lock.json" "$SRC/verify-wyz.sh" "$DEST/"
cp "$SRC/src/index.js" "$SRC/src/signature.js" "$DEST/src/"
cp "$REPO/miniprogram/services/fosuDirectClient.js" \
  "$REPO/miniprogram/services/fosuDirectConfig.js" \
  "$REPO/miniprogram/services/fosuDirectCookieJar.js" \
  "$REPO/miniprogram/services/fosuDirectDiagnostics.js" \
  "$REPO/miniprogram/services/fosuDirectHtml.js" \
  "$REPO/miniprogram/services/fosuDirectPasswordCrypto.js" \
  "$REPO/miniprogram/services/fosuDirectRedirect.js" \
  "$REPO/miniprogram/services/fosuDirectUrl.js" \
  "$DEST/vendor/"
install -m 644 "$SRC/wyz-campus-agent.service" /etc/systemd/system/wyz-campus-agent.service
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
systemctl daemon-reload
echo "Fill CAMPUS_AGENT_TOKEN and CAMPUS_AGENT_SIGNING_SECRET in /etc/fosu-campus-agent.env from the Oracle secrets file."
echo "Then: systemctl enable --now wyz-campus-agent.service"
echo "This install does not change wyz-campus-api.service or the WYZ web UI."
