FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/crypto && npm install

WORKDIR /app/services/admin-service
COPY services/admin-service/package*.json ./
RUN npm install --omit=dev
COPY services/admin-service/ ./
RUN npx prisma generate
EXPOSE 4016
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npm run seed:platform && node src/index.js"]
