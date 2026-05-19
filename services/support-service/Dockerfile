FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/support-service/package*.json ./services/support-service/
WORKDIR /app/services/support-service
RUN npm ci --omit=dev
COPY services/support-service/prisma ./prisma
RUN npx prisma generate
COPY services/support-service/src ./src
EXPOSE 4014
CMD ["node", "src/index.js"]
