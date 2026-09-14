FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-perms.sh scripts/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run typecheck && npm run build:server && npm run build && npm test
CMD ["npm", "run", "test:mvp"]
