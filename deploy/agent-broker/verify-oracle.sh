#!/bin/sh
set -eu
echo "Local API checks use 127.0.0.1:18318. They do not print tokens."
if [ ! -f /root/fosu-route2-secrets.env ]; then
  echo "MISSING /root/fosu-route2-secrets.env"
  exit 2
fi
. /root/fosu-route2-secrets.env
python3 - <<'PY'
import hashlib, hmac, json, os, time, urllib.request
base = "http://127.0.0.1:18318"
token = os.environ["CAMPUS_AGENT_TOKEN"]
secret = os.environ["CAMPUS_AGENT_SIGNING_SECRET"]
agent = os.environ.get("CAMPUS_AGENT_ID", "wyz-campus-01")

def call(path, headers):
    req = urllib.request.Request(base + path, data=b"", method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status
    except Exception as exc:
        return getattr(exc, "code", 0)

def signed(path, token_value, agent_value, stamp, nonce):
    body = hashlib.sha256(b"").hexdigest()
    base_str = "\n".join(["GET", path, str(stamp), nonce, body])
    sig = hmac.new(secret.encode(), base_str.encode(), hashlib.sha256).hexdigest()
    return {
        "Authorization": "Bearer " + token_value,
        "X-Campus-Agent-ID": agent_value,
        "X-Campus-Timestamp": str(stamp),
        "X-Campus-Nonce": nonce,
        "X-Campus-Signature": sig,
    }

print("no-token", call("/api/campus-agent/v1/health", {}))
print("wrong-token", call("/api/campus-agent/v1/health", signed("/api/campus-agent/v1/health", "0"*64, agent, int(time.time()*1000), "n1")))
print("wrong-agent", call("/api/campus-agent/v1/health", signed("/api/campus-agent/v1/health", token, "other", int(time.time()*1000), "n2")))
print("valid", call("/api/campus-agent/v1/health", signed("/api/campus-agent/v1/health", token, agent, int(time.time()*1000), "n3")))
print("ordinary-api", call("/api/campus-sync/availability", {}))
PY
echo "If agent-broker nginx is installed, these public paths must be 404:"
echo "  curl -skI https://agent-broker.katelya.eu.org/"
echo "  curl -skI https://agent-broker.katelya.eu.org/admin"
echo "  curl -skI https://agent-broker.katelya.eu.org/api/campus-sync/jobs"
