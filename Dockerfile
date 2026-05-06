FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY server/ ./server/
COPY src/ ./src/
COPY client/ ./client/

RUN mkdir -p /app/data/logs && \
    addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app/data

USER appuser

EXPOSE 3721

CMD ["node", "server/index.js"]