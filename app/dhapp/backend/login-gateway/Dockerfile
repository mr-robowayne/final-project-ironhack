# syntax=docker/dockerfile:1.7
FROM node:20-alpine

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV LOGIN_PORT=8080
ENV PORT=8080
ENV BIND_PUBLIC=true

WORKDIR /app
COPY app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY app/ ./

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["dumb-init","--"]
CMD ["node", "server.js"]
