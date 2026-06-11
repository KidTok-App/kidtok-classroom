# KidTok Classroom agent service — node:22-slim multi-stage build.
# Build:  docker build -t kidtok-agent-service ./agent-service
# Run:    docker run -p 8080:8080 --env-file .env kidtok-agent-service

# ---------- build stage ----------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Production deps only. @arizeai/phoenix-mcp is a runtime dependency on
# purpose: the MCP server is spawned from node_modules (hermetic image, no
# network npx fetch at runtime).
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

# Cloud Run-style contract: listen on $PORT (defaults to 8080 in config.ts).
EXPOSE 8080
CMD ["node", "dist/index.js"]
