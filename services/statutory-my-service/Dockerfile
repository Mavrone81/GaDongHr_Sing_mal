FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

# No shared/ copy and no auth-middleware install: this service is
# service-to-service only, gated by INTERNAL_SERVICE_KEY rather than a JWT, and
# it owns global tables with no tenantId so it needs no tenant-context either.
# Keeping it dependency-free from shared/ is what lets the Malaysian sibling be
# an independent deploy.

WORKDIR /app/services/statutory-my-service
COPY services/statutory-my-service/package*.json ./
# `npm install`, not `npm ci` — this is an npm-workspaces repo and individual
# services have no lockfile of their own (the mistake that meant
# support-service's Dockerfile had never built).
RUN npm install --omit=dev
COPY services/statutory-my-service/ ./
RUN npx prisma generate
EXPOSE 4022
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/index.js"]
