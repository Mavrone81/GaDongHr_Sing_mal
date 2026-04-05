FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/auth-middleware && npm install
RUN cd /app/shared/crypto && npm install

WORKDIR /app/services/api-gateway
COPY services/api-gateway/package*.json ./
RUN npm install --omit=dev
COPY services/api-gateway/ ./

EXPOSE 4000
CMD ["sh", "-c", " node src/index.js"]
