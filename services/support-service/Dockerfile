FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
# auth-middleware depends on jsonwebtoken — without this install the image
# builds but the service crashes on its first authenticated request.
# tenant-context is dependency-free, so COPY alone covers it.
RUN cd /app/shared/auth-middleware && npm install
RUN cd /app/shared/crypto && npm install

WORKDIR /app/services/support-service
COPY services/support-service/package*.json ./
# `npm install`, not `npm ci`. This is an npm-workspaces repo: individual
# services have no package-lock.json of their own, so `npm ci` fails outright
# with "can only install with an existing package-lock.json". This Dockerfile
# had therefore NEVER built successfully — which went unnoticed precisely
# because the service was also missing from docker-compose.yml, so nothing
# ever tried.
RUN npm install --omit=dev
COPY services/support-service/ ./
RUN npx prisma generate
EXPOSE 4014
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/index.js"]
