#!/bin/sh
set -eu
echo "WYZ egress IPv4, not used to change any firewall:"
WYZ_EGRESS_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
echo "WYZ_EGRESS_IP=${WYZ_EGRESS_IP:-unknown}"
if [ -f /etc/fosu-campus-agent.env ]; then
  stat -c '%U:%G %a' /etc/fosu-campus-agent.env
else
  echo "MISSING /etc/fosu-campus-agent.env"
fi
systemctl is-active wyz-campus-agent.service || true
echo "Secret values are not printed."
