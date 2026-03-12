# syntax=docker/dockerfile:1.7
FROM node:20-alpine

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    tzdata \
    udev \
    dumb-init \
    libxml2-utils

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production
ENV PORT=8090
ENV BIND_PUBLIC=true

WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY app/ .
RUN mkdir -p /data/tenants && chown -R node:node /app /data/tenants

USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["dumb-init","--"]
CMD ["node", "services/billing-service/server.js"]
