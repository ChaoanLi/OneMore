# 算我一个 · OneMore —— 生产镜像（API + H5 页面同一个端口）
FROM node:24-bookworm-slim

WORKDIR /app

# 先只拷依赖清单，利用 Docker 缓存
COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --legacy-peer-deps

# 再拷源码并构建（core + H5）
COPY . .
RUN npm run build

ENV PORT=8787 \
    DB_PATH=/data/couju.db
EXPOSE 8787

# 直接启动服务（根目录的 npm start 会先重新构建，这里已经构建过）
CMD ["npm", "run", "start", "-w", "@couju/server"]
