FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/auth-middleware && npm install
RUN cd /app/shared/crypto && npm install

WORKDIR /app/services/auth-service
COPY services/auth-service/package*.json ./
RUN npm install --omit=dev
COPY services/auth-service/ ./
RUN npx prisma generate
EXPOSE 4001
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npm run seed:rbac && npm run seed:admin && node src/index.js"]
