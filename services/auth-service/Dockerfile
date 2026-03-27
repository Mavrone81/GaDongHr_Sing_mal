FROM node:20-alpine

WORKDIR /app

# Copy shared libs
COPY shared/crypto /app/shared/crypto
COPY shared/auth-middleware /app/shared/auth-middleware

# Install shared deps
RUN cd /app/shared/auth-middleware && npm install

# Copy service
COPY services/auth-service/package*.json ./
RUN npm install --omit=dev

COPY services/auth-service/ ./

# Generate Prisma client
RUN npx prisma generate

EXPOSE 4001

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
