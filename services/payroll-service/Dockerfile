FROM node:20-alpine
WORKDIR /app
COPY shared/crypto /app/shared/crypto
COPY shared/auth-middleware /app/shared/auth-middleware
RUN cd /app/shared/auth-middleware && npm install
COPY services/payroll-service/package*.json ./
RUN npm install --omit=dev
COPY services/payroll-service/ ./
RUN npx prisma generate 2>/dev/null || true
EXPOSE 4003
CMD ["sh", "-c", "npx prisma migrate deploy 2>/dev/null || true && node src/index.js"]
