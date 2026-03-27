FROM node:20-alpine
WORKDIR /app
COPY shared/crypto /app/shared/crypto
COPY shared/auth-middleware /app/shared/auth-middleware
RUN cd /app/shared/auth-middleware && npm install
COPY services/api-gateway/package*.json ./
RUN npm install --omit=dev
COPY services/api-gateway/ ./
EXPOSE 4000
CMD ["node", "src/index.js"]
