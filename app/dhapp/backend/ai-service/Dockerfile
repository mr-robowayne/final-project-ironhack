# syntax=docker/dockerfile:1.7
FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=8088
ENV BIND_PUBLIC=true

WORKDIR /app
COPY app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY app/ .

EXPOSE 8088
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8088/health || exit 1

CMD ["node", "llm-gateway/server.js"]
