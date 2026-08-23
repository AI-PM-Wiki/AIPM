# AI-PM Agent Server 部署镜像(fly.io / 任意支持 Docker 的主机)。
# 两阶段:构建阶段 npm ci + tsc 出 dist;运行阶段只带生产依赖与产物。
# 基础镜像选 node:22-slim(Debian/glibc)——Agent SDK 的 CLI 原生二进制
# 按平台走 optionalDependencies,glibc 环境兼容性最稳,勿换 alpine。
#
# 运行所需环境变量(部署时注入,见 README「部署」):
#   ANTHROPIC_API_KEY(必填) / SEARCH_INDEX_URL / ALLOWED_ORIGINS / TRUST_PROXY ...

# ---- 构建 ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- 运行 ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "dist/server.js"]
