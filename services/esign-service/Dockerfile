FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/auth-middleware && npm install
RUN cd /app/shared/crypto && npm install
# tenant-context is dependency-free — COPY above is enough, no install needed.

WORKDIR /app/services/esign-service
COPY services/esign-service/package*.json ./
RUN npm install --omit=dev
COPY services/esign-service/ ./
RUN npx prisma generate
EXPOSE 4015
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/index.js"]
