# assistant-service — AI chat assistant. No database: it only calls existing
# services through the gateway, forwarding the caller's JWT so the platform's
# RBAC scopes every data read/write. Hence no prisma layer.
FROM node:20-alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/auth-middleware && npm install

WORKDIR /app/services/assistant-service
COPY services/assistant-service/package*.json ./
RUN npm install --omit=dev
COPY services/assistant-service/ ./
EXPOSE 4020
CMD ["node", "src/index.js"]
