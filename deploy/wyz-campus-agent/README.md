# WYZ campus agent

Outbound-only process for `agent-broker.katelya.eu.org`. It does not open an inbound port and it does not replace `wyz-campus-api.service`.

```sh
sudo sh deploy/wyz-campus-agent/install-wyz.sh
sudoedit /etc/fosu-campus-agent.env
sudo systemctl enable --now wyz-campus-agent.service
sudo sh /opt/wyz-campus-agent/verify-wyz.sh
```

Copy `CAMPUS_AGENT_TOKEN` and `CAMPUS_AGENT_SIGNING_SECRET` from the Oracle file `/root/fosu-route2-secrets.env`. The two values must be different. The env file stays `root:root` mode `0600`.

`X-Campus-Timestamp` is Unix time in milliseconds. Each request also sends a one-time nonce and an HMAC over method, path, timestamp, nonce, and the SHA256 of the raw body.
