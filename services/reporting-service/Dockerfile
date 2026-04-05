FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/auth-middleware && npm install
RUN cd /app/shared/crypto && npm install

WORKDIR /app/services/reporting-service
COPY services/reporting-service/package*.json ./
RUN npm install --omit=dev
COPY services/reporting-service/ ./

EXPOSE 4010
CMD ["sh", "-c", " node src/index.js"]
