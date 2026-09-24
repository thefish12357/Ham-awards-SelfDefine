# syntax=docker/dockerfile:1

# ------------------------------------------------------------------
# 阶段 1：构建前端（Vite 需要 devDependencies）
# ------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

# Tailwind 已从外网 CDN 切到本地构建，这两个配置文件必须在构建阶段可见
COPY index.html vite.config.js tailwind.config.cjs postcss.config.cjs ./
COPY src ./src
COPY public ./public
RUN npm run build

# ------------------------------------------------------------------
# 阶段 2：运行时（仅生产依赖 + dist + 后端单体 server.js）
# ------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=9993 \
    CONFIG_FILE=/data/config.json

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY server.js ./
# 后端单体由 server.js + server/ 下各路由/服务组成，运行时必须整目录拷入
COPY server ./server
COPY docker ./docker

# /data 用于持久化 config.json（由 compose 挂载命名卷）
# /app/uploads 是 multer 的临时目录
RUN mkdir -p /data /app/uploads

EXPOSE 9993

# 只需 Node 自带能力即可探活，无需额外安装 curl
HEALTHCHECK --interval=15s --timeout=4s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9993)+'/api/system-status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
