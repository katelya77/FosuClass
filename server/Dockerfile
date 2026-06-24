# 使用 Node.js 20 作为基础镜像
FROM node:20-alpine

# 安装基础网络诊断与 CA 证书依赖
RUN apk add --no-cache curl bind-tools ca-certificates chromium nss freetype harfbuzz ttf-freefont

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV FOSU_IMPORT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 设置工作目录
WORKDIR /app

# 确保持久化 storage 目录存在
RUN mkdir -p /app/storage

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装生产环境依赖
RUN npm ci --omit=dev

# 复制所有源代码
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY data/ ./data/
COPY assets/ ./assets/

# 暴露接口服务端口
EXPOSE 3000

# 启动命令
CMD ["node", "src/app.js"]
