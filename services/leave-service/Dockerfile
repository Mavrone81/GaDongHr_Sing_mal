FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/auth-middleware && npm install
RUN cd /app/shared/crypto && npm install

WORKDIR /app/services/leave-service
COPY services/leave-service/package*.json ./
RUN npm install --omit=dev
COPY services/leave-service/ ./
RUN npx prisma generate
EXPOSE 4004
CMD ["sh", "-c", "npx prisma db push --accept-data-loss &&  node src/index.js"]
