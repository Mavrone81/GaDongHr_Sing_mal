FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/auth-middleware && npm install
RUN cd /app/shared/crypto && npm install

WORKDIR /app/services/offboarding-service
COPY services/offboarding-service/package*.json ./
RUN npm install --omit=dev
COPY services/offboarding-service/ ./
RUN npx prisma generate
EXPOSE 4008
CMD ["sh", "-c", "npx prisma db push --accept-data-loss &&  node src/index.js"]
