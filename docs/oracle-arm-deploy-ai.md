# Oracle ARM / Docker AI 部署说明

Oracle ARM 可以作为 FosuClass 的开发/运维服务器，用于 Docker 部署、缓存服务、后台管理和 Provider 联调。但它不等同于境内合规部署。比赛材料中涉及“数据不出境”时，应以服务器 region、模型服务 region、网络链路和备案情况为准。

如需完全满足比赛演示或生产场景的数据不出境要求，建议迁移到境内云、校内服务器或微信云托管，并完成必要备案。

## ARM64 Docker 部署

```bash
cd server
docker compose up -d --build
```

`server/Dockerfile` 基于 `node:20-alpine`，可在 ARM64 上构建运行。`docker-compose.yml` 会读取 `server/.env`。

## 配置 DeepSeek

推荐在服务器 shell 中通过环境变量注入，再运行脚本生成 `server/.env`：

```bash
FOSUCLASS_DEEPSEEK_API_KEY=your_local_key sh tools/configure-ai-provider-linux.sh
```

脚本会写入：

```bash
AI_AGENT_ENABLED=true
AI_PROVIDER=deepseek
AI_MODEL=deepseek-v4-flash
AI_REASONING_MODEL=deepseek-v4-pro
AI_BASE_URL=https://api.deepseek.com
AI_TIMEOUT_MS=15000
AI_MAX_TOKENS=1200
AI_TEMPERATURE=0.1
AI_THINKING_ENABLED=false
```

脚本不会打印 key，并会尝试 `chmod 600 server/.env`。

## 回退 mock

编辑 `server/.env`：

```bash
AI_AGENT_ENABLED=false
AI_PROVIDER=mock
```

然后重启容器：

```bash
cd server
docker compose up -d --build
```

## 验证

健康检查：

```bash
curl http://127.0.0.1:${HOST_API_PORT:-18318}/api/health
```

AI Agent 检查：

```bash
curl -X POST http://127.0.0.1:${HOST_API_PORT:-18318}/api/ai/agent/chat \
  -H "Content-Type: application/json" \
  --data '{"message":"C7 附近现在有空教室吗？","context":{"timezone":"Asia/Shanghai","currentScheduleSummary":{"enabled":false,"courses":[]}}}'
```

本地命令验证：

```bash
npm run verify:deploy-ai
```

输出只包含 provider、model、baseUrl、enabled、keyConfigured 和回答预览，不输出密钥或完整 prompt。

## 演示注意事项

- 不要在演示中输入真实学号、密码、Cookie、token 或身份证号。
- 个人课表建议使用 XLS 导入；AI 个人摘要默认关闭。
- Oracle ARM 仅作为开发/运维环境时，应在参赛文档中明确说明，避免写成境内合规部署。
- 比赛现场可使用 mock/local 模式演示核心功能，避免网络和 Provider 波动影响展示。
