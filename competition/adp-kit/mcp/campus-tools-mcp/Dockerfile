# 校园智序 · 小序 —— CampusTools MCP 服务
# 零依赖 Node 运行时，只读挂载匿名演示数据。
#
# 构建方式（构建上下文为 adp-kit 目录，即本文件的上一级）：
#   cd competition/adp-kit
#   docker build -f mcp/campus-tools-mcp/Dockerfile -t campus-tools-mcp .
#   docker run -p 8787:8787 campus-tools-mcp

FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8787

WORKDIR /app

# 服务代码
COPY mcp/campus-tools-mcp/package.json ./
COPY mcp/campus-tools-mcp/src ./src

# 匿名演示数据（data.js 强制守卫：仅允许 competition-demo-* 文件）
COPY mock-data/competition-demo-v1.json /mock-data/competition-demo-v1.json
ENV CAMPUS_DATA_PATH=/mock-data/competition-demo-v1.json

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "src/server.js"]
