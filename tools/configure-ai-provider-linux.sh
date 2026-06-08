#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_PATH="$ROOT_DIR/server/.env"
EXAMPLE_PATH="$ROOT_DIR/server/.env.example"

set_env_value() {
  key="$1"
  value="$2"
  tmp="${ENV_PATH}.tmp"
  if [ -f "$ENV_PATH" ]; then
    awk -v k="$key" -v v="$value" '
      BEGIN { done=0 }
      $0 ~ "^[[:space:]]*" k "[[:space:]]*=" { print k "=" v; done=1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "$ENV_PATH" > "$tmp"
  else
    printf "%s=%s\n" "$key" "$value" > "$tmp"
  fi
  mv "$tmp" "$ENV_PATH"
  chmod 600 "$ENV_PATH" || true
}

ensure_gitignore_line() {
  line="$1"
  file="$ROOT_DIR/.gitignore"
  touch "$file"
  if ! grep -qxF "$line" "$file"; then
    printf "\n%s\n" "$line" >> "$file"
  fi
}

if [ ! -f "$ENV_PATH" ]; then
  if [ -f "$EXAMPLE_PATH" ]; then
    cp "$EXAMPLE_PATH" "$ENV_PATH"
  else
    : > "$ENV_PATH"
  fi
  chmod 600 "$ENV_PATH" || true
fi

ensure_gitignore_line ".env"
ensure_gitignore_line ".env.local"
ensure_gitignore_line "*.secret"
ensure_gitignore_line "server/.env"
ensure_gitignore_line "local.secrets.json"

KEY_VALUE="${FOSUCLASS_DEEPSEEK_API_KEY:-${DEEPSEEK_API_KEY:-${AI_API_KEY:-}}}"
if [ -n "$KEY_VALUE" ]; then
  set_env_value "AI_AGENT_ENABLED" "true"
  set_env_value "AI_PROVIDER" "deepseek"
  set_env_value "AI_API_KEY" "$KEY_VALUE"
else
  set_env_value "AI_AGENT_ENABLED" "false"
  set_env_value "AI_PROVIDER" "mock"
fi

set_env_value "AI_MODEL" "deepseek-v4-flash"
set_env_value "AI_REASONING_MODEL" "deepseek-v4-pro"
set_env_value "AI_BASE_URL" "https://api.deepseek.com"
set_env_value "AI_TIMEOUT_MS" "15000"
set_env_value "AI_MAX_TOKENS" "1200"
set_env_value "AI_TEMPERATURE" "0.1"
set_env_value "AI_THINKING_ENABLED" "false"
set_env_value "AI_REASONING_EFFORT" "medium"
set_env_value "AI_PROVIDER_JSON_REPAIR" "true"

cd "$ROOT_DIR/server"
docker compose up -d --build

PORT="${HOST_API_PORT:-18318}"
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null
curl -fsS -X POST "http://127.0.0.1:${PORT}/api/ai/agent/chat" \
  -H "Content-Type: application/json" \
  --data '{"message":"C7 附近现在有空教室吗？","context":{"timezone":"Asia/Shanghai","currentScheduleSummary":{"enabled":false,"courses":[]}}}' >/dev/null

if [ -n "$KEY_VALUE" ]; then
  echo "已启用 deepseek；如果 Provider 异常，服务端会 fallback mock。"
else
  echo "未读取到环境变量 key，已 fallback mock。"
fi
