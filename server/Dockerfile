# 使用 Node.js 18 作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 确保持久化 storage 目录存在
RUN mkdir -p /app/storage

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装生产环境依赖
RUN npm ci --only=production

# 复制所有源代码
COPY src/ ./src/
COPY scripts/ ./scripts/

# 暴露接口服务端口
EXPOSE 3000

# 启动命令
CMD ["node", "src/app.js"]
